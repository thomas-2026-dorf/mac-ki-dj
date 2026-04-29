import type { MixState } from "../modules/audio/mixEngine";
import type { MixTransitionPlan } from "../modules/transition/autoMixPlanner";
import type { TransitionPoint } from "../types/track";
import { ROLE_COLORS } from "../modules/transition/transitionPointPlanner";
import PlayerWaveform from "./PlayerWaveform";
import CdjWaveform from "./CdjWaveform";

const TYPE_OPTIONS: {
    key: string;
    label: string;
    role: TransitionPoint["role"];
    bars: TransitionPoint["bars"];
}[] = [
    { key: "loop-out-8",  label: "Loop-Out 8",  role: "loop-out",    bars: 8    },
    { key: "loop-out-16", label: "Loop-Out 16", role: "loop-out",    bars: 16   },
    { key: "loop-out-32", label: "Loop-Out 32", role: "loop-out",    bars: 32   },
    { key: "cut-out",     label: "Cut-Out",     role: "cut-out",     bars: null },
    { key: "loop-in",     label: "Loop-In",     role: "loop-in",     bars: 8    },
    { key: "cut-in",      label: "Cut-In",      role: "cut-in",      bars: null },
    { key: "passage",     label: "Passage",     role: "passage-out", bars: null },
];

function formatTime(s: number): string {
    if (!Number.isFinite(s) || s < 0) return "0:00";
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function transitionLabel(plan: MixTransitionPlan): string {
    return plan.type === "blend" ? `Blend ${Math.round(plan.blendDurationSeconds)}s` : "Cut";
}

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
    onRemoveTransitionPoint?: (pointId: string) => void;
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
    onRemoveTransitionPoint,
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
    const waveB = next?.analysis?.waveform ?? [];

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

            {current && onSaveTransitionPoint && (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px", padding: "4px 8px", background: "rgba(15,23,42,0.6)" }}>
                    <span style={{ fontSize: "11px", color: "#64748b", fontVariantNumeric: "tabular-nums", marginRight: "4px" }}>
                        @ {formatTime(curTime)}
                    </span>
                    {TYPE_OPTIONS.map(opt => {
                        const c = ROLE_COLORS[opt.role];
                        return (
                            <button
                                key={opt.key}
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
                                style={{
                                    background: c.bg,
                                    border: `1px solid ${c.border}`,
                                    borderRadius: "4px",
                                    color: c.text,
                                    padding: "3px 8px",
                                    fontSize: "11px",
                                    cursor: "pointer",
                                    fontWeight: 600,
                                }}
                            >
                                {opt.label}
                            </button>
                        );
                    })}
                </div>
            )}

            {current && onRemoveTransitionPoint && (current.transitionPoints ?? []).length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", padding: "2px 8px 4px", background: "rgba(15,23,42,0.6)" }}>
                    <span style={{ fontSize: "10px", color: "#475569", alignSelf: "center", marginRight: "2px" }}>Gesetzt:</span>
                    {(current.transitionPoints ?? []).map(p => {
                        const c = ROLE_COLORS[p.role];
                        return (
                            <span
                                key={p.id}
                                style={{ display: "inline-flex", alignItems: "center", gap: "3px", background: c.bg, border: `1px solid ${c.border}`, borderRadius: "4px", padding: "1px 5px", fontSize: "10px", color: c.text }}
                            >
                                {p.label ?? p.role} @ {formatTime(p.timeSeconds)}
                                <button
                                    onClick={() => onRemoveTransitionPoint(p.id)}
                                    style={{ background: "none", border: "none", cursor: "pointer", color: c.text, padding: "0 0 0 2px", fontSize: "10px", lineHeight: 1 }}
                                    title="Entfernen"
                                >×</button>
                            </span>
                        );
                    })}
                </div>
            )}

            {current && curDur > 0 && (
                <div className="mix-waveform-wrap">
                    <CdjWaveform
                        trackId={current.id}
                        waveform={waveA}
                        duration={curDur}
                        currentTime={curTime}
                        onSeek={onSeek}
                        bpm={current.analysis?.detectedBpm ?? current.bpm}
                        beatGridStartSeconds={current.analysis?.beatGridStartSeconds}
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

            {next && nxtDur > 0 && (
                <div className="mix-waveform-wrap mix-waveform-wrap-next">
                    <PlayerWaveform
                        trackId={next.id}
                        waveform={waveB}
                        duration={nxtDur}
                        currentTime={0}
                        onSeek={() => {}}
                        bpm={next.analysis?.detectedBpm ?? next.bpm}
                        beatGridStartSeconds={next.analysis?.beatGridStartSeconds}
                    />
                </div>
            )}
        </div>
    );
}
