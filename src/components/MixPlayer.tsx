import { useState } from "react";
import type { MixState } from "../modules/audio/mixEngine";
import type { MixTransitionPlan } from "../modules/transition/autoMixPlanner";
import type { TransitionPoint } from "../types/track";
import { ROLE_COLORS } from "../modules/transition/transitionPointPlanner";
import DeckWaveform from "./DeckWaveform";
import PlayerWaveform from "./PlayerWaveform";

const TYPE_OPTIONS: {
    key: string;
    label: string;
    role: TransitionPoint["role"];
    bars: TransitionPoint["bars"];
}[] = [
    { key: "loop-out-32", label: "Loop-Out 32b", role: "loop-out", bars: 32 },
    { key: "loop-out-16", label: "Loop-Out 16b", role: "loop-out", bars: 16 },
    { key: "loop-out-8",  label: "Loop-Out 8b",  role: "loop-out", bars: 8  },
    { key: "cut-out",     label: "Cut-Out",       role: "cut-out",  bars: null },
    { key: "passage-out", label: "Passage-Out",   role: "passage-out", bars: null },
    { key: "loop-in-8",   label: "Loop-In 8b",   role: "loop-in",  bars: 8  },
    { key: "loop-in-16",  label: "Loop-In 16b",  role: "loop-in",  bars: 16 },
    { key: "cut-in",      label: "Cut-In",        role: "cut-in",   bars: null },
    { key: "passage-in",  label: "Passage-In",    role: "passage-in", bars: null },
];

// ── Waveform-Hilfstypen ───────────────────────────────────────────────────────

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
    onStop: () => void;
    onReset: () => void;
    onSaveTransitionPoint?: (point: TransitionPoint) => void;
};

export default function MixPlayer({
    state,
    onPlay,
    onPause,
    onSkip,
    onStartAutomix,
    onSeek,
    onStop,
    onReset,
    onSaveTransitionPoint,
}: MixPlayerProps) {
    const [selectedTypeKey, setSelectedTypeKey] = useState("loop-out-32");
    const status = state?.status ?? "idle";
    const isPlaying = status === "playing" || status === "transitioning";

    const current = state?.currentTrack ?? null;
    const next = state?.nextTrack ?? null;
    const plan = state?.transitionPlan ?? null;

    const curTime = state?.currentTime ?? 0;
    const curDur = state?.currentDuration ?? 0;
    const nxtDur = state?.nextDuration ?? 0;

    const waveA = current?.analysis?.waveform ?? [];

    const waveB = next?.analysis?.waveform ?? [];
    const cuesB = next?.analysis?.cuePoints ?? [];
    const tpB = next?.transitionPoints ?? [];
    const bpmB = next?.bpm ?? 0;
    const gridB = next?.analysis?.beatGridStartSeconds ?? 0;
    const blendInTime = plan?.nextTrackOffset ?? 0;

    const dispB = next ? overviewDisplay(waveB, nxtDur, bpmB, gridB, blendInTime) : null;

    // Blend-In-Marker auf Track B
    const blendInCue = plan
        ? [{ id: "__blend-in__", timeSeconds: blendInTime, name: "Blend In" }]
        : [];

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
                    {(isPlaying || status === "paused") && (
                        <button className="mix-btn mix-btn-stop" onClick={onStop} title="Stopp">■</button>
                    )}
                    {(isPlaying || status === "paused") && (
                        <button className="mix-btn mix-btn-reset" onClick={onReset} title="Reset + Queue leeren">↺</button>
                    )}
                </div>
            </div>

            {current && curDur > 0 && (
                <div
                    className="mix-seekbar"
                    onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
                        onSeek(ratio * curDur);
                    }}
                >
                    <div className="mix-seekbar-fill" style={{ width: `${(curTime / curDur) * 100}%` }} />
                    {plan && (
                        <div
                            className="mix-seekbar-marker"
                            style={{ left: `${(plan.outroStartSeconds / curDur) * 100}%` }}
                        />
                    )}
                </div>
            )}

            {current && onSaveTransitionPoint && (() => {
                const opt = TYPE_OPTIONS.find(o => o.key === selectedTypeKey) ?? TYPE_OPTIONS[0];
                const color = ROLE_COLORS[opt.role].text;
                return (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "4px 8px", background: "rgba(15,23,42,0.6)" }}>
                        <select
                            value={selectedTypeKey}
                            onChange={e => setSelectedTypeKey(e.target.value)}
                            style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "4px", color, padding: "3px 6px", fontSize: "12px", cursor: "pointer" }}
                        >
                            {TYPE_OPTIONS.map(o => (
                                <option key={o.key} value={o.key} style={{ color: ROLE_COLORS[o.role].text }}>
                                    {o.label}
                                </option>
                            ))}
                        </select>
                        <span style={{ fontSize: "11px", color: "#64748b", fontVariantNumeric: "tabular-nums" }}>
                            @ {formatTime(curTime)}
                        </span>
                        <button
                            onClick={() => {
                                const point: TransitionPoint = {
                                    id: `manual-${opt.role}-${Math.round(curTime * 10)}`,
                                    role: opt.role,
                                    bars: opt.bars,
                                    timeSeconds: Math.round(curTime * 10) / 10,
                                    source: "manual",
                                    label: opt.label,
                                };
                                onSaveTransitionPoint(point);
                            }}
                            style={{ background: `rgba(${opt.role.startsWith("loop-out") ? "249,115,22" : opt.role.startsWith("loop-in") ? "34,197,94" : opt.role.startsWith("cut") ? "239,68,68" : "96,165,250"},0.2)`, border: `1px solid ${color}`, borderRadius: "4px", color, padding: "3px 10px", fontSize: "12px", cursor: "pointer", fontWeight: 600 }}
                        >
                            📍 Punkt setzen
                        </button>
                    </div>
                );
            })()}

            {current && curDur > 0 && (
                <div className="mix-waveform-wrap">
                    <PlayerWaveform
                        trackId={current.id}
                        waveform={waveA}
                        duration={curDur}
                        currentTime={curTime}
                        onSeek={onSeek}
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
                        transitionPoints={tpB}
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
