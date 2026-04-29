import type { MixState } from "../modules/audio/mixEngine";
import type { MixTransitionPlan } from "../modules/transition/autoMixPlanner";
import DeckWaveform from "./DeckWaveform";

// ── Waveform-Hilfstypen ───────────────────────────────────────────────────────

const VISIBLE_SECONDS = 14;
const MAX_BARS = 320;

type BeatMarker = { time: number; percent: number; beat: number };

type WaveDisplay = {
    visibleWaveform: number[];
    beatMarkers: BeatMarker[];
    visibleStart: number;
    visibleDuration: number;
    progressPercent: number;
};

function downsample(arr: number[], maxBars: number): number[] {
    if (arr.length <= maxBars) return arr;
    return Array.from({ length: maxBars }, (_, i) => {
        const s = Math.floor((i / maxBars) * arr.length);
        const e = Math.max(s + 1, Math.floor(((i + 1) / maxBars) * arr.length));
        return Math.max(...arr.slice(s, e));
    });
}

function buildBeatMarkers(
    visibleStart: number,
    visibleEnd: number,
    visibleDuration: number,
    bpm: number,
    gridStart: number,
    onlyDownbeats = false,
): BeatMarker[] {
    const markers: BeatMarker[] = [];
    const beatDur = bpm > 0 ? 60 / bpm : 0;
    if (!beatDur) return markers;
    const first = Math.ceil((visibleStart - gridStart) / beatDur);
    for (let i = first; gridStart + i * beatDur <= visibleEnd; i++) {
        const t = gridStart + i * beatDur;
        if (t < visibleStart) continue;
        const beat = (((i % 4) + 4) % 4) + 1;
        if (onlyDownbeats && beat !== 1) continue;
        markers.push({ time: t, percent: ((t - visibleStart) / visibleDuration) * 100, beat });
    }
    return markers;
}

/** Scrollendes Fenster um currentTime herum (für den laufenden Track) */
function scrollingDisplay(
    waveform: number[],
    currentTime: number,
    duration: number,
    bpm: number,
    gridStart: number,
): WaveDisplay {
    const vs = duration > VISIBLE_SECONDS
        ? Math.min(Math.max(0, currentTime - VISIBLE_SECONDS * 0.35), duration - VISIBLE_SECONDS)
        : 0;
    const ve = duration > 0 ? Math.min(duration, vs + VISIBLE_SECONDS) : 0;
    const vd = Math.max(1, ve - vs);

    const raw = duration > 0 && waveform.length > 0
        ? waveform.slice(
            Math.floor((vs / duration) * waveform.length),
            Math.ceil((ve / duration) * waveform.length),
        )
        : waveform;

    return {
        visibleWaveform: downsample(raw, MAX_BARS),
        beatMarkers: buildBeatMarkers(vs, ve, vd, bpm, gridStart),
        visibleStart: vs,
        visibleDuration: vd,
        progressPercent: vd > 0 ? Math.min(100, Math.max(0, ((currentTime - vs) / vd) * 100)) : 0,
    };
}

/** Übersicht über den gesamten Track (für den nächsten Track) */
function overviewDisplay(
    waveform: number[],
    duration: number,
    bpm: number,
    gridStart: number,
    markedTime: number,
): WaveDisplay {
    const vd = Math.max(1, duration);
    return {
        visibleWaveform: downsample(waveform, MAX_BARS),
        beatMarkers: buildBeatMarkers(0, duration, vd, bpm, gridStart, true),
        visibleStart: 0,
        visibleDuration: vd,
        progressPercent: vd > 0 ? Math.min(100, Math.max(0, (markedTime / vd) * 100)) : 0,
    };
}

// ── Hilfs-Utils ───────────────────────────────────────────────────────────────

function formatTime(s: number): string {
    if (!Number.isFinite(s) || s < 0) return "0:00";
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function transitionLabel(plan: MixTransitionPlan): string {
    return plan.type === "blend" ? `Blend ${Math.round(plan.blendDurationSeconds)}s` : "Cut";
}

// ── Props & Komponente ────────────────────────────────────────────────────────

type MixPlayerProps = {
    state: MixState | null;
    onPlay: () => void;
    onPause: () => void;
    onSkip: () => void;
    onStartAutomix: () => void;
    onSeek: (time: number) => void;
};

export default function MixPlayer({
    state,
    onPlay,
    onPause,
    onSkip,
    onStartAutomix,
    onSeek,
}: MixPlayerProps) {
    const status = state?.status ?? "idle";
    const isPlaying = status === "playing" || status === "transitioning";

    const current = state?.currentTrack ?? null;
    const next = state?.nextTrack ?? null;
    const plan = state?.transitionPlan ?? null;

    const curTime = state?.currentTime ?? 0;
    const curDur = state?.currentDuration ?? 0;
    const nxtDur = state?.nextDuration ?? 0;

    const waveA = current?.analysis?.waveform ?? [];
    const cuesA = current?.analysis?.cuePoints ?? [];
    const bpmA = current?.bpm ?? 0;
    const gridA = current?.analysis?.beatGridStartSeconds ?? 0;

    const waveB = next?.analysis?.waveform ?? [];
    const cuesB = next?.analysis?.cuePoints ?? [];
    const bpmB = next?.bpm ?? 0;
    const gridB = next?.analysis?.beatGridStartSeconds ?? 0;
    const blendInTime = plan?.nextTrackOffset ?? 0;

    const dispA = current ? scrollingDisplay(waveA, curTime, curDur, bpmA, gridA) : null;
    const dispB = next ? overviewDisplay(waveB, nxtDur, bpmB, gridB, blendInTime) : null;

    // Blend-Out-Marker auf Track A
    const blendOutCue = plan
        ? [{ id: "__blend-out__", timeSeconds: plan.outroStartSeconds, name: "Blend Out" }]
        : [];

    // Blend-In-Marker auf Track B
    const blendInCue = plan
        ? [{ id: "__blend-in__", timeSeconds: blendInTime, name: "Blend In" }]
        : [];

    function handleSeekA(clientX: number, rect: DOMRect) {
        if (!dispA) return;
        const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        onSeek(dispA.visibleStart + ratio * dispA.visibleDuration);
    }

    const statusLabel =
        status === "transitioning" ? "ÜBERGANG" :
        status === "playing" ? "NOW PLAYING" :
        status === "loading" ? "LADEN…" :
        status === "paused" ? "PAUSIERT" :
        "TK-DJ AUTOMIX";

    return (
        <div className="mix-player">

            {/* ── Track A: aktuell ────────────────────────────── */}
            <div className="mix-track-row">
                <div className="mix-track-info">
                    <span className="mix-status-label">{statusLabel}</span>
                    {current ? (
                        <>
                            <span className="mix-track-title">{current.title}</span>
                            <span className="mix-track-meta">
                                {current.artist} · {current.bpm} BPM · {current.key} · NRG {current.energy}
                                <span className="mix-timecode">{formatTime(curTime)} / {formatTime(curDur)}</span>
                            </span>
                        </>
                    ) : (
                        <span className="mix-track-empty">Songs in die Queue laden, dann Automix starten</span>
                    )}
                </div>

                <div className="mix-controls">
                    {status === "idle" && (
                        <button className="mix-btn mix-btn-start" onClick={onStartAutomix}>▶ Start</button>
                    )}
                    {status === "paused" && (
                        <button className="mix-btn mix-btn-play" onClick={onPlay}>▶ Weiter</button>
                    )}
                    {isPlaying && (
                        <button className="mix-btn mix-btn-pause" onClick={onPause}>⏸</button>
                    )}
                    {(isPlaying || status === "paused") && next && (
                        <button className="mix-btn mix-btn-skip" onClick={onSkip} title="Sofort zum nächsten Track">⏭</button>
                    )}
                </div>
            </div>

            {dispA && (
                <div className="mix-waveform-wrap">
                    <DeckWaveform
                        waveform={dispA.visibleWaveform}
                        beatMarkers={dispA.beatMarkers}
                        cuePoints={[...cuesA, ...blendOutCue]}
                        currentTime={curTime}
                        visibleStart={dispA.visibleStart}
                        visibleDuration={dispA.visibleDuration}
                        progressPercent={dispA.progressPercent}
                        onSeek={handleSeekA}
                    />
                </div>
            )}

            {/* ── Track B: nächster ───────────────────────────── */}
            <div className="mix-track-row mix-track-row-next">
                <div className="mix-track-info">
                    <span className="mix-status-label">
                        UP NEXT
                        {plan && <span className="mix-transition-badge">{transitionLabel(plan)}</span>}
                        {state?.timeToTransition != null && (
                            <span className="mix-countdown"> in {formatTime(state.timeToTransition)}</span>
                        )}
                    </span>
                    {next ? (
                        <>
                            <span className="mix-track-title mix-track-title-sm">{next.title}</span>
                            <span className="mix-track-meta">{next.artist} · {next.bpm} BPM · {next.key} · NRG {next.energy}</span>
                        </>
                    ) : (
                        <span className="mix-track-empty">Kein nächster Track bereit</span>
                    )}
                </div>
            </div>

            {dispB && next && (
                <div className="mix-waveform-wrap mix-waveform-wrap-next">
                    <DeckWaveform
                        waveform={dispB.visibleWaveform}
                        beatMarkers={dispB.beatMarkers}
                        cuePoints={[...cuesB, ...blendInCue]}
                        currentTime={blendInTime}
                        visibleStart={0}
                        visibleDuration={dispB.visibleDuration}
                        progressPercent={dispB.progressPercent}
                        onSeek={() => {}}
                    />
                </div>
            )}
        </div>
    );
}
