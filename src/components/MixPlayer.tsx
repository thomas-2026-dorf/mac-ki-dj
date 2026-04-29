import type { MixState } from "../modules/audio/mixEngine";
import type { MixTransitionPlan } from "../modules/transition/autoMixPlanner";

function formatTime(s: number): string {
    if (!Number.isFinite(s) || s < 0) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, "0")}`;
}

function transitionLabel(plan: MixTransitionPlan): string {
    if (plan.type === "blend") return `Blend ${Math.round(plan.blendDurationSeconds)}s`;
    return "Cut";
}

type MixPlayerProps = {
    state: MixState | null;
    onPlay: () => void;
    onPause: () => void;
    onSkip: () => void;
    onStartAutomix: () => void;
};

export default function MixPlayer({ state, onPlay, onPause, onSkip, onStartAutomix }: MixPlayerProps) {
    const status = state?.status ?? "idle";
    const isPlaying = status === "playing" || status === "transitioning";
    const current = state?.currentTrack;
    const next = state?.nextTrack;
    const plan = state?.transitionPlan;

    const progress =
        state && state.currentDuration > 0
            ? (state.currentTime / state.currentDuration) * 100
            : 0;

    return (
        <div className="mix-player">
            <div className="mix-now-playing">
                <div className="mix-label">
                    {status === "transitioning"
                        ? "ÜBERGANG"
                        : status === "playing"
                          ? "NOW PLAYING"
                          : status === "loading"
                            ? "LADEN..."
                            : status === "paused"
                              ? "PAUSIERT"
                              : "TK-DJ AUTOMIX"}
                </div>
                {current ? (
                    <>
                        <div className="mix-title">{current.title}</div>
                        <div className="mix-meta">
                            {current.artist} · {current.bpm} BPM · {current.key} · NRG {current.energy}
                        </div>
                        <div className="mix-progress-bar">
                            <div className="mix-progress-fill" style={{ width: `${progress}%` }} />
                        </div>
                        <div className="mix-time">
                            {formatTime(state?.currentTime ?? 0)} / {formatTime(state?.currentDuration ?? 0)}
                        </div>
                    </>
                ) : (
                    <div className="mix-empty">Songs in die Queue laden, dann Automix starten</div>
                )}
            </div>

            <div className="mix-controls">
                {status === "idle" && (
                    <button className="mix-btn mix-btn-start" onClick={onStartAutomix}>
                        ▶ Start
                    </button>
                )}
                {status === "paused" && (
                    <button className="mix-btn mix-btn-play" onClick={onPlay}>▶ Weiter</button>
                )}
                {isPlaying && (
                    <button className="mix-btn mix-btn-pause" onClick={onPause}>⏸ Pause</button>
                )}
                {(isPlaying || status === "paused") && next && (
                    <button className="mix-btn mix-btn-skip" onClick={onSkip}>
                        ⏭ Skip
                    </button>
                )}
            </div>

            <div className="mix-up-next">
                {next ? (
                    <>
                        <div className="mix-label">
                            UP NEXT
                            {plan && (
                                <span className="mix-transition-badge">{transitionLabel(plan)}</span>
                            )}
                            {state?.timeToTransition != null && (
                                <span className="mix-countdown">
                                    in {formatTime(state.timeToTransition)}
                                </span>
                            )}
                        </div>
                        <div className="mix-next-title">{next.title}</div>
                        <div className="mix-meta">
                            {next.artist} · {next.bpm} BPM · {next.key} · NRG {next.energy}
                        </div>
                    </>
                ) : (
                    <div className="mix-label" style={{ color: "#334155" }}>UP NEXT — leer</div>
                )}
            </div>
        </div>
    );
}
