import { useState, useRef, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Track } from "../types/track";
import { buildDeckSyncPlan } from "../modules/audio/syncEngine";
import { getAudioTime, resumeSharedAudioContext } from "../modules/audio/audioContext";

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

    const minutes = Math.floor(seconds / 60);
    const restSeconds = Math.floor(seconds % 60);

    return `${String(minutes).padStart(2, "0")}:${String(restSeconds).padStart(2, "0")}`;
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
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isScrubbing, setIsScrubbing] = useState(false);
    const [pitchPercent, setPitchPercent] = useState(0);
    const [lastSyncDebug, setLastSyncDebug] = useState<string>("");

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const waveformRef = useRef<HTMLDivElement | null>(null);

    const waveform = track?.analysis?.waveform ?? [];
    const cuePoints = track?.analysis?.cuePoints ?? [];
    const originalBpm = track?.bpm ?? 0;
    const pitchedBpm = originalBpm > 0 ? originalBpm * (1 + pitchPercent / 100) : 0;
    const bpm = pitchedBpm;
    const beatDuration = bpm > 0 ? 60 / bpm : 0;

    // Fallback Beatgrid wenn keine echten Beats vorhanden
        const beatGridStart =
        track?.analysis?.beatGridStartSeconds ??
        cuePoints.find((cuePoint) => cuePoint.type === "drum" || cuePoint.type === "start")?.timeSeconds ??
        0;

    const visibleSeconds = 24;
    const visibleStart =
        duration > visibleSeconds
            ? Math.min(Math.max(0, currentTime - visibleSeconds * 0.25), duration - visibleSeconds)
            : 0;
    const visibleEnd = duration > 0 ? Math.min(duration, visibleStart + visibleSeconds) : 0;
    const visibleDuration = Math.max(1, visibleEnd - visibleStart);

    const visibleWaveformRaw =
        duration > 0 && waveform.length > 0
            ? waveform.slice(
                  Math.max(0, Math.floor((visibleStart / duration) * waveform.length)),
                  Math.min(waveform.length, Math.ceil((visibleEnd / duration) * waveform.length)),
              )
            : waveform;

    const maxVisibleBars = 180;
    const visibleWaveform =
        visibleWaveformRaw.length > maxVisibleBars
            ? Array.from({ length: maxVisibleBars }, (_, index) => {
                  const start = Math.floor((index / maxVisibleBars) * visibleWaveformRaw.length);
                  const end = Math.max(
                      start + 1,
                      Math.floor(((index + 1) / maxVisibleBars) * visibleWaveformRaw.length),
                  );
                  const values = visibleWaveformRaw.slice(start, end);
                  return Math.max(...values);
              })
            : visibleWaveformRaw;

    const beatMarkers = [];
    if (beatDuration > 0 && visibleEnd > visibleStart) {
        const firstBeatIndex = Math.ceil((visibleStart - beatGridStart) / beatDuration);

        for (let index = firstBeatIndex; beatGridStart + index * beatDuration <= visibleEnd; index++) {
            const time = beatGridStart + index * beatDuration;
            if (time < visibleStart) continue;

            beatMarkers.push({
                time,
                percent: ((time - visibleStart) / visibleDuration) * 100,
                beat: (((index % 4) + 4) % 4) + 1,
            });
        }
    }

    const progressPercent =
        visibleDuration > 0
            ? Math.min(100, Math.max(0, ((currentTime - visibleStart) / visibleDuration) * 100))
            : 0;

    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.volume = volume;
        }
    }, [volume]);

    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.playbackRate = 1 + pitchPercent / 100;
        }
    }, [pitchPercent]);

    useEffect(() => {
        if (!isPlaying) return;

        const interval = window.setInterval(() => {
            if (!audioRef.current) return;

            const t = audioRef.current.currentTime;
            const d = audioRef.current.duration || duration || 0;

            setCurrentTime(t);
            onTimeUpdateGlobal?.(t, d);
        }, 25);

        return () => window.clearInterval(interval);
    }, [isPlaying, duration, onTimeUpdateGlobal]);


    useEffect(() => {
        if (!audioRef.current || seekToTime === null || seekToTime === undefined) return;

        const nextTime = Math.max(0, Math.min(seekToTime, duration || seekToTime));
        audioRef.current.currentTime = nextTime;
        setCurrentTime(nextTime);
    }, [seekToTime, duration]);


    useEffect(() => {
        if (!audioRef.current) return;

        if (!track?.url) {
            audioRef.current.removeAttribute("src");
            audioRef.current.load();
            setIsPlaying(false);
            setCurrentTime(0);
            setDuration(0);
            return;
        }

        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current.src = convertFileSrc(track.url);
        audioRef.current.load();
        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(0);
    }, [track]);

    async function handlePlayPause() {
        if (!audioRef.current || !track) return;

        if (isPlaying) {
            audioRef.current.pause();
            setIsPlaying(false);
            return;
        }

        try {
            await resumeSharedAudioContext();
            await audioRef.current.play();
            setIsPlaying(true);
            onPlay?.();
        } catch (error) {
            console.error("Audio konnte nicht abgespielt werden:", error);
            alert("Audio konnte nicht abgespielt werden: " + String(error));
        }
    }

    function handleTempoSync() {
        if (!audioRef.current || !track || !syncMasterTrack) return;

        const masterBpm = syncMasterBpm ?? 0;
        const slaveBpm = track.bpm ?? 0;

        const plan = buildDeckSyncPlan({
            masterTime: syncMasterTime,
            masterBpm,
            masterGridStart: syncMasterTrack.analysis?.beatGridStartSeconds ?? 0,
            slaveTime: audioRef.current.currentTime,
            slaveBpm,
            slaveGridStart: beatGridStart,
        });

        if (!plan) return;

        const limitedPitch = Math.max(-8, Math.min(8, plan.pitchPercent));
        const limitedPlaybackRate = 1 + limitedPitch / 100;

        setPitchPercent(limitedPitch);
        audioRef.current.playbackRate = limitedPlaybackRate;
        audioRef.current.currentTime = Math.max(0, plan.targetTime);

        setCurrentTime(audioRef.current.currentTime);
        onTimeUpdateGlobal?.(audioRef.current.currentTime, duration);

        const debugText =
            `master ${syncMasterTime.toFixed(3)} | slave ${(audioRef.current.currentTime).toFixed(3)} | target ${plan.targetTime.toFixed(3)} | rate ${limitedPlaybackRate.toFixed(4)}`;

        setLastSyncDebug(debugText);
        console.log("SYNC ENGINE PLAN", {
            plan,
            masterTime: syncMasterTime,
            slaveAfter: audioRef.current.currentTime,
            audioClockTime: getAudioTime(),
            debugText,
        });
    }

    function handleStop() {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
        }

        setIsPlaying(false);
        setCurrentTime(0);
    }

    function seekToPosition(clientX: number) {
        if (!audioRef.current || !track || duration <= 0 || !waveformRef.current) return;

        const rect = waveformRef.current.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        const nextTime = Math.min(duration, Math.max(0, visibleStart + ratio * visibleDuration));

        audioRef.current.currentTime = nextTime;
        setCurrentTime(nextTime);
    }

    return (
        <div className={`deck ${isActive ? "active-deck" : ""}`} style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative", paddingRight: "44px" }}>
            <div className="deck-pitch-control" onDoubleClick={() => setPitchPercent(0)} title="Doppelklick setzt Pitch auf 0">
                <span>Pitch</span>
                <input
                    type="range"
                    min="-8"
                    max="8"
                    step="0.1"
                    value={pitchPercent}
                    onChange={(event) => setPitchPercent(Number(event.target.value))}
                />
                <strong>{pitchPercent > 0 ? "+" : ""}{pitchPercent.toFixed(1)}%</strong>
            </div>

            <div className="deck-header">
                <h2>{title}</h2>

                <div className="deck-header-right">
                    {isActive && <span className="live-badge">LIVE</span>}

                    {track && (
                        <button className="activate-btn" onClick={onEject} title="Track auswerfen">
                            Auswerfen
                        </button>
                    )}

                    <button className="activate-btn" onClick={onActivate}>
                        Aktiv
                    </button>
                </div>
            </div>

            <div className="waveform">
                {track ? (
                    <>
                        <div className="deck-waveform-container">
                            <div className="deck-beat-grid">
                                {beatMarkers.map((marker) => (
                                    <div
                                        key={`beat-${marker.time}`}
                                        className={`deck-beat-marker beat-${marker.beat}`}
                                        style={{ left: `${marker.percent}%` }}
                                        title={`Beat ${marker.beat} · ${formatTime(marker.time)}`}
                                    >
                                        {marker.beat === 1 ? "1" : ""}
                                    </div>
                                ))}
                            </div>

                            <div
                                ref={waveformRef}
                                className="deck-beatgrid-stage"
                                onMouseDown={(event) => {
                                    setIsScrubbing(true);
                                    seekToPosition(event.clientX);
                                }}
                                onMouseMove={(event) => {
                                    if (isScrubbing) seekToPosition(event.clientX);
                                }}
                                onMouseUp={() => setIsScrubbing(false)}
                                onMouseLeave={() => setIsScrubbing(false)}
                            >
                                <div className="deck-mini-waveform">
                                {visibleWaveform.length > 0 ? (
                                    visibleWaveform.map((value, index) => (
                                        <div
                                            key={`${track.id}-wave-${index}`}
                                            className={
                                                "deck-waveform-bar " +
                                                (value > 0.22
                                                    ? "wave-hot"
                                                    : value > 0.12
                                                        ? "wave-mid"
                                                        : "wave-low")
                                            }
                                            style={{
                                                height: `${Math.max(10, Math.min(100, value * 420))}%`,
                                            }}
                                        />
                                    ))
                                ) : (
                                    <div className="deck-waveform-empty">
                                        Waveform noch nicht analysiert
                                    </div>
                                )}
                                </div>

                                {cuePoints.map((cuePoint) => {
                                    const markerLeft =
                                        cuePoint.timeSeconds >= visibleStart &&
                                        cuePoint.timeSeconds <= visibleEnd
                                            ? Math.min(
                                                  100,
                                                  Math.max(
                                                      0,
                                                      ((cuePoint.timeSeconds - visibleStart) / visibleDuration) * 100,
                                                  ),
                                              )
                                            : -1;

                                    if (markerLeft < 0) return null;

                                    return (
                                        <div
                                            key={cuePoint.id}
                                            className={`deck-cue-marker deck-cue-${cuePoint.type}`}
                                            style={{ left: `${markerLeft}%` }}
                                            title={`${cuePoint.name} · ${formatTime(cuePoint.timeSeconds)}`}
                                        />
                                    );
                                })}

                                <div
                                    className="deck-waveform-playhead"
                                    style={{ left: `${progressPercent}%` }}
                                />
                            </div>
                        </div>

                        <div className="deck-time">
                            <span>{formatTime(currentTime)}</span>
                            <span>Zoom {formatTime(visibleStart)} - {formatTime(visibleEnd)}</span>
                            <span>-{formatTime(Math.max(0, duration - currentTime))}</span>
                        </div>



                        {cuePoints.length > 0 && (
                            <div className="deck-cue-list">
                                {cuePoints.map((cuePoint) => (
                                    <span
                                        key={`${cuePoint.id}-label`}
                                        className={`deck-cue-label deck-cue-${cuePoint.type}`}
                                    >
                                        {cuePoint.name} · {formatTime(cuePoint.timeSeconds)}
                                    </span>
                                ))}
                            </div>
                        )}
                    </>
                ) : (
                    <span>Kein Track</span>
                )}
            </div>

            {track && (
                <input
                    type="range"
                    className="deck-song-position"
                    min="0"
                    max={duration || 0}
                    step="0.1"
                    value={currentTime}
                    onChange={(event) => {
                        const nextTime = Number(event.target.value);
                        if (audioRef.current) {
                            audioRef.current.currentTime = nextTime;
                        }
                        setCurrentTime(nextTime);
                    }}
                />
            )}


            <div style={{ fontSize: "10px", color: "#94a3b8", marginTop: "4px" }}>
                Beats: {track?.analysis?.beats?.length ?? 0} |
                GridStart: {track?.analysis?.beatGridStartSeconds ?? "-"}
                {lastSyncDebug && (
                    <>
                        <br />
                        Sync: {lastSyncDebug}
                    </>
                )}
            </div>

            <div className="deck-info">
                <div>
                    BPM: {track ? pitchedBpm.toFixed(1) : "-"}
                    {track && pitchPercent !== 0 ? ` (${originalBpm} / ${pitchPercent > 0 ? "+" : ""}${pitchPercent.toFixed(1)}%)` : ""}
                </div>
                <div>Key: {track ? track.key : "-"}</div>
                <div>Energy: {track ? track.energy : "-"}</div>
            </div>

            

            {track && (
                <div className="deck-track-title">
                    {track.title} · Waveform: {waveform.length}
                </div>
            )}

            <div className="deck-controls" style={{ marginTop: "auto" }}>
                <button className="load-btn" onClick={onLoad}>
                    Load
                </button>

                <button onClick={handlePlayPause} disabled={!track}>
                    {isPlaying ? "Pause" : "Play"}
                </button>

                <button onClick={handleStop} disabled={!track}>
                    Stop
                </button>

                <button disabled={!track}>Cue</button>
                <button onClick={handleTempoSync} disabled={!track || !syncMasterBpm}>
                    Sync
                </button>
            </div>

<audio
                ref={audioRef}
                onTimeUpdate={(event) => {
                    const t = event.currentTarget.currentTime;
                    const d = event.currentTarget.duration || 0;
                    setCurrentTime(t);
                    onTimeUpdateGlobal?.(t, d);
                }}
                onLoadedMetadata={(event) => {
                    const d = event.currentTarget.duration || 0;
                    setDuration(d);
                    onTimeUpdateGlobal?.(0, d);
                }}
                onEnded={() => setIsPlaying(false)}
            />
        </div>
    );
}
