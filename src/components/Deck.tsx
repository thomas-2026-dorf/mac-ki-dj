import { useState, useRef, useEffect } from "react";
import type { Track } from "../types/track";
import { buildDeckSyncPlan } from "../modules/audio/syncEngine";
import { getPhaseInBar, getBarDuration } from "../modules/audio/beatGrid";
import { createDeckAudio, type DeckAudio } from "../modules/audio/deckAudio";
import { ensureWavCache } from "../modules/audio/timeStretchEngine";
import DeckWaveform from "./DeckWaveform";

type DeckProps = {
    syncMasterBpm?: number | null;
    syncMasterTrack?: Track;
    syncMasterTime?: number;
    onTimeUpdateGlobal?: (time: number, duration: number) => void;
    seekToTime?: number | null;
    title: string;
    track?: Track;
    isActive?: boolean;
    onActivate?: () => void;
    onPlay?: () => void;
    volume: number;
    onLoad?: () => void;
    onEject?: () => void;
};

function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function Deck({
    title,
    track,
    isActive,
    onActivate,
    onPlay,
    volume,
    onLoad,
    onEject,
    syncMasterBpm,
    syncMasterTrack,
    syncMasterTime = 0,
    onTimeUpdateGlobal,
    seekToTime,
}: DeckProps) {
    const [isPlaying, setIsPlaying] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [pitchPercent, setPitchPercent] = useState(0);
    const [syncActive, setSyncActive] = useState(true);

    const deckRef = useRef<DeckAudio | null>(null);
    const lastSyncSeekRef = useRef<number>(0);

    // DeckAudio einmalig erstellen und beim Unmount zerstören
    useEffect(() => {
        deckRef.current = createDeckAudio();
        return () => {
            deckRef.current?.destroy();
            deckRef.current = null;
        };
    }, []);

    // Waveform / Beat-Grid Berechnungen
    const waveform = track?.analysis?.waveform ?? [];
    const cuePoints = track?.analysis?.cuePoints ?? [];
    const originalBpm = track?.analysis?.detectedBpm ?? track?.bpm ?? 0;
    const pitchedBpm = originalBpm > 0 ? originalBpm * (1 + pitchPercent / 100) : 0;
    const beatDuration = pitchedBpm > 0 ? 60 / pitchedBpm : 0;
    const beatGridStart = track?.analysis?.beatGridStartSeconds ?? 0;

    const visibleSeconds = 16;
    const visibleStart = duration > visibleSeconds
        ? Math.min(Math.max(0, currentTime - visibleSeconds * 0.35), duration - visibleSeconds)
        : 0;
    const visibleEnd = duration > 0 ? Math.min(duration, visibleStart + visibleSeconds) : 0;
    const visibleDuration = Math.max(1, visibleEnd - visibleStart);

    const visibleWaveformRaw = duration > 0 && waveform.length > 0
        ? waveform.slice(
            Math.max(0, Math.floor((visibleStart / duration) * waveform.length)),
            Math.min(waveform.length, Math.ceil((visibleEnd / duration) * waveform.length)),
        )
        : waveform;

    const maxVisibleBars = 400;
    const visibleWaveform = visibleWaveformRaw.length > maxVisibleBars
        ? Array.from({ length: maxVisibleBars }, (_, i) => {
            const start = Math.floor((i / maxVisibleBars) * visibleWaveformRaw.length);
            const end = Math.max(start + 1, Math.floor(((i + 1) / maxVisibleBars) * visibleWaveformRaw.length));
            return Math.max(...visibleWaveformRaw.slice(start, end));
        })
        : visibleWaveformRaw;

    const beatMarkers: { time: number; percent: number; beat: number }[] = [];
    if (beatDuration > 0 && visibleEnd > visibleStart) {
        const firstIndex = Math.ceil((visibleStart - beatGridStart) / beatDuration);
        for (let i = firstIndex; beatGridStart + i * beatDuration <= visibleEnd; i++) {
            const t = beatGridStart + i * beatDuration;
            if (t < visibleStart) continue;
            beatMarkers.push({
                time: t,
                percent: ((t - visibleStart) / visibleDuration) * 100,
                beat: (((i % 4) + 4) % 4) + 1,
            });
        }
    }

    const progressPercent = visibleDuration > 0
        ? Math.min(100, Math.max(0, ((currentTime - visibleStart) / visibleDuration) * 100))
        : 0;

    // Lautstärke
    useEffect(() => {
        deckRef.current?.setGain(volume);
    }, [volume]);

    // Pitch-Slider → Rate setzen
    useEffect(() => {
        deckRef.current?.setRate(1 + pitchPercent / 100);
    }, [pitchPercent]);

    // Zeit-Update-Intervall (nur wenn spielend)
    useEffect(() => {
        if (!isPlaying) return;
        const interval = window.setInterval(() => {
            const deck = deckRef.current;
            if (!deck) return;
            const t = deck.getTime();
            const d = deck.getDuration();
            setCurrentTime(t);
            onTimeUpdateGlobal?.(t, d);
        }, 25);
        return () => window.clearInterval(interval);
    }, [isPlaying, onTimeUpdateGlobal]);

    // Seek von außen (SyncWavePanel etc.)
    useEffect(() => {
        if (seekToTime === null || seekToTime === undefined) return;
        deckRef.current?.seek(seekToTime);
        setCurrentTime(seekToTime);
    }, [seekToTime]);

    // Track wechselt → WAV laden
    useEffect(() => {
        setSyncActive(true);
        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(0);

        if (!track?.url) return;

        setIsLoading(true);
        ensureWavCache(track.url)
            .then((wavPath) => deckRef.current?.load(wavPath))
            .then(() => {
                const d = deckRef.current?.getDuration() ?? 0;
                setDuration(d);
                onTimeUpdateGlobal?.(0, d);
                deckRef.current?.onEnded(() => setIsPlaying(false));
            })
            .catch((err) => console.error("Track laden fehlgeschlagen:", err))
            .finally(() => setIsLoading(false));
    }, [track]);

    // BPM-Lock wenn Sync aktiv — präziser Float-BPM
    useEffect(() => {
        if (!syncActive || !track || !syncMasterBpm) return;
        const slaveBpm = track.analysis?.detectedBpm ?? track.bpm ?? 0;
        if (slaveBpm <= 0) return;
        const rate = syncMasterBpm / slaveBpm;
        const limited = Math.max(0.92, Math.min(1.08, rate));
        setPitchPercent((limited - 1) * 100);
        deckRef.current?.setRate(limited);
    }, [syncActive, syncMasterBpm]);

    // Drift-Korrektur via präzisem AudioContext-Takt
    useEffect(() => {
        if (!syncActive || !track || !syncMasterBpm || !isPlaying) return;
        const slaveBpm = track.analysis?.detectedBpm ?? track.bpm ?? 0;
        if (slaveBpm <= 0) return;

        const masterBarDur = getBarDuration(syncMasterBpm);
        const slaveBarDur = getBarDuration(slaveBpm);
        const masterGridStart = syncMasterTrack?.analysis?.beatGridStartSeconds ?? 0;

        const masterPhase = getPhaseInBar({ time: syncMasterTime, gridStart: masterGridStart, bpm: syncMasterBpm });
        const slaveTime = deckRef.current?.getTime() ?? 0;
        const slavePhase = getPhaseInBar({ time: slaveTime, gridStart: beatGridStart, bpm: slaveBpm });

        // Bruchteil-Vergleich [0,1) — funktioniert korrekt auch bei unterschiedlichen BPMs
        let phaseError = masterPhase / masterBarDur - slavePhase / slaveBarDur;
        if (phaseError > 0.5) phaseError -= 1;
        if (phaseError < -0.5) phaseError += 1;

        const baseRate = Math.max(0.92, Math.min(1.08, syncMasterBpm / slaveBpm));
        const now = Date.now();

        if (Math.abs(phaseError) > 0.125 && now - lastSyncSeekRef.current > 500) {
            // Großer Versatz: hart seeken
            lastSyncSeekRef.current = now;
            const plan = buildDeckSyncPlan({
                masterTime: syncMasterTime,
                masterBpm: syncMasterBpm,
                masterGridStart,
                slaveTime,
                slaveBpm,
                slaveGridStart: beatGridStart,
            });
            if (plan) {
                deckRef.current?.seek(Math.max(0, plan.targetTime));
                setCurrentTime(Math.max(0, plan.targetTime));
            }
            deckRef.current?.setRate(baseRate);
        } else {
            // Kleiner Drift: Rate proportional nachregeln (wie CDJ pitch bend)
            // phaseError > 0 → Slave ist hinter Master → schneller drehen
            const nudge = Math.max(-0.04, Math.min(0.04, phaseError * 0.3));
            deckRef.current?.setRate(Math.max(0.92, Math.min(1.08, baseRate + nudge)));
        }
    }, [syncMasterTime, syncActive, isPlaying]);

    // --- Handler ---

    function handlePlayPause() {
        const deck = deckRef.current;
        if (!deck || !track) return;
        if (isPlaying) {
            deck.pause();
            setIsPlaying(false);
        } else {
            if (syncActive && syncMasterBpm) {
                handleTempoSync();
            }
            deck.play();
            setIsPlaying(true);
            onPlay?.();
        }
    }

    function handleStop() {
        deckRef.current?.pause();
        deckRef.current?.seek(0);
        setIsPlaying(false);
        setCurrentTime(0);
    }

    function handleTempoSync() {
        const deck = deckRef.current;
        if (!deck || !track || !syncMasterTrack || !syncMasterBpm) return;
        const slaveBpm = track.analysis?.detectedBpm ?? track.bpm ?? 0;
        const plan = buildDeckSyncPlan({
            masterTime: syncMasterTime,
            masterBpm: syncMasterBpm,
            masterGridStart: syncMasterTrack.analysis?.beatGridStartSeconds ?? 0,
            slaveTime: deck.getTime(),
            slaveBpm,
            slaveGridStart: beatGridStart,
        });
        if (!plan) return;
        const limited = Math.max(0.92, Math.min(1.08, plan.playbackRate));
        setPitchPercent((limited - 1) * 100);
        deck.setRate(limited);
        deck.seek(Math.max(0, plan.targetTime));
        setCurrentTime(Math.max(0, plan.targetTime));
    }

    function handleSyncToggle() {
        if (syncActive) {
            setSyncActive(false);
            return;
        }
        handleTempoSync();
        setSyncActive(true);
    }

    function seekToPosition(clientX: number, rect: DOMRect) {
        if (!track || duration <= 0) return;
        const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        const t = Math.min(duration, Math.max(0, visibleStart + ratio * visibleDuration));
        deckRef.current?.seek(t);
        setCurrentTime(t);
    }

    return (
        <div className={`deck ${isActive ? "active-deck" : ""}`} style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative", paddingRight: "44px" }}>
            <div className="deck-pitch-control" onDoubleClick={() => setPitchPercent(0)} title="Doppelklick = Reset">
                <span>Pitch</span>
                <input
                    type="range" min="-8" max="8" step="0.1"
                    value={pitchPercent}
                    onChange={(e) => setPitchPercent(Number(e.target.value))}
                />
                <strong>{pitchPercent > 0 ? "+" : ""}{pitchPercent.toFixed(1)}%</strong>
            </div>

            <div className="deck-header">
                <h2>{title}</h2>
                <div className="deck-header-right">
                    {isActive && <span className="live-badge">LIVE</span>}
                    {isLoading && <span className="live-badge" style={{ background: "#f59e0b" }}>LADEN...</span>}
                    {track && <button className="activate-btn" onClick={onEject}>Auswerfen</button>}
                    <button className="activate-btn" onClick={onActivate}>Aktiv</button>
                </div>
            </div>

            <div className="waveform">
                <DeckWaveform
                    waveform={visibleWaveform}
                    beatMarkers={beatMarkers}
                    cuePoints={cuePoints}
                    currentTime={currentTime}
                    visibleStart={visibleStart}
                    visibleDuration={visibleDuration}
                    progressPercent={progressPercent}
                    onSeek={seekToPosition}
                />
                <div className="deck-time">
                    <span>{formatTime(currentTime)}</span>
                    <span>-{formatTime(Math.max(0, duration - currentTime))}</span>
                </div>
            </div>

            <div className="deck-info">
                <div className="deck-bpm">
                    {track ? pitchedBpm.toFixed(1) : "---"}
                    <span className="deck-bpm-label">BPM{pitchPercent !== 0 ? ` ${pitchPercent > 0 ? "+" : ""}${pitchPercent.toFixed(1)}%` : ""}</span>
                </div>
                <div className="deck-key">{track?.key || "-"}</div>
                <div className="deck-energy">
                    {track?.energy || "-"}
                    <span className="deck-bpm-label">NRG</span>
                </div>
            </div>

            {track && <div className="deck-track-title">{track.title}</div>}

            <div className="deck-controls" style={{ marginTop: "auto" }}>
                <button className="load-btn" onClick={onLoad}>Load</button>
                <button onClick={handlePlayPause} disabled={!track || isLoading}>
                    {isPlaying ? "Pause" : "Play"}
                </button>
                <button onClick={handleStop} disabled={!track}>Stop</button>
                <button disabled={!track}>Cue</button>
                <button
                    onClick={handleSyncToggle}
                    disabled={!track || !syncMasterBpm}
                    className={syncActive ? "sync-btn sync-active" : "sync-btn"}
                >
                    {syncActive ? "SYNC ●" : "SYNC"}
                </button>
            </div>
        </div>
    );
}
