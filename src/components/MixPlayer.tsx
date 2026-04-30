import { useEffect, useRef, useState } from "react";
import type { MixState } from "../modules/audio/mixEngine";
import type { MixTransitionPlan } from "../modules/transition/autoMixPlanner";
import { decideTransition } from "../modules/transition/autoMixPlanner";
import type { TransitionPoint } from "../types/track";
import { ROLE_COLORS } from "../modules/transition/transitionPointPlanner";
import PlayerWaveform from "./PlayerWaveform";
import CdjWaveform from "./CdjWaveform";
import { calculateGridOffsetForWindow } from "../modules/audio/beatGrid";

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
    onSetVolume?: (v: number) => void;
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
    onSetVolume,
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

    useEffect(() => {
        if (!current || !next) return;
        const decision = decideTransition(current, next);
        const bpmDiff = current.bpm > 0 && next.bpm > 0
            ? Math.abs(current.bpm - next.bpm).toFixed(1)
            : "?";
        console.group(`[decideTransition] ${current.title} → ${next.title}`);
        console.log("transitionType    :", decision.transitionType);
        console.log("transitionStartTime:", decision.transitionStartTime.toFixed(1), "s");
        console.log("BPM A / B         :", current.bpm, "/", next.bpm, "  Diff:", bpmDiff);
        console.log("Energy A / B      :", current.energy, "/", next.energy);
        console.groupEnd();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [next?.id]);

    const [metroOn, setMetroOn] = useState(false);
    const [metroBeat, setMetroBeat] = useState<{ n: number; t: number } | null>(null);
    const audioCtxRef  = useRef<AudioContext | null>(null);
    const lastBeatNRef = useRef<number>(-1);

    useEffect(() => { lastBeatNRef.current = -1; }, [current?.id, metroOn]);

    useEffect(() => {
        if (!metroOn || !isPlaying) return;
        const bpm = current?.analysis?.detectedBpm ?? current?.bpm ?? 0;
        const gridStart = current?.analysis?.beatGridStartSeconds;
        if (!bpm || gridStart === undefined) return;
        const beatN = Math.floor((curTime - gridStart) / (60 / bpm));
        if (beatN < 0 || beatN === lastBeatNRef.current) return;
        lastBeatNRef.current = beatN;
        setMetroBeat({ n: beatN, t: curTime });
        if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
        const ac = audioCtxRef.current;
        const osc  = ac.createOscillator();
        const gain = ac.createGain();
        osc.connect(gain); gain.connect(ac.destination);
        const isDown = beatN % 4 === 0;
        osc.type = "square";
        osc.frequency.value = isDown ? 1050 : 660;
        const now = ac.currentTime;
        gain.gain.setValueAtTime(isDown ? 1.0 : 0.6, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        osc.start(now); osc.stop(now + 0.06);
    }, [curTime, metroOn, isPlaying, current]);

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
                    <button
                        onClick={async () => {
                            if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
                            await audioCtxRef.current.resume();
                            const next = !metroOn;
                            onSetVolume?.(next ? 0.25 : 1.0);
                            setMetroOn(next);
                        }}
                        title="Metronom Grid-Debug"
                        style={{ marginLeft: "8px", background: metroOn ? "rgba(251,191,36,0.25)" : "rgba(255,255,255,0.05)", border: `1px solid ${metroOn ? "#fbbf24" : "rgba(255,255,255,0.15)"}`, borderRadius: "4px", color: metroOn ? "#fbbf24" : "#666", padding: "2px 8px", cursor: "pointer", fontSize: "13px" }}
                    >♩</button>
                    <button
                        onClick={() => {
                            const beats = current?.analysis?.beats;
                            const bpm = current?.analysis?.detectedBpm ?? current?.bpm ?? 0;
                            const gridStart = current?.analysis?.beatGridStartSeconds;
                            if (!beats || !bpm || gridStart === undefined || curDur <= 0) {
                                console.warn("[GridOffset] Keine Analyse-Daten für aktuellen Track");
                                return;
                            }

                            const outroFrom = curDur - 30;
                            const outroTo   = curDur;

                            const beatsInOutro = beats.filter(b => b >= outroFrom && b <= outroTo);
                            const lastBeat = beats[beats.length - 1] ?? null;

                            const beatDuration = 60 / bpm;
                            const firstGridIdx = Math.ceil((outroFrom - gridStart) / beatDuration);
                            const lastGridIdx  = Math.floor((outroTo   - gridStart) / beatDuration);
                            const firstGridBeat = gridStart + firstGridIdx * beatDuration;
                            const lastGridBeat  = gridStart + lastGridIdx  * beatDuration;

                            console.group(`[GridOffset Debug] ${current?.title}`);
                            console.log("durationSeconds       :", curDur.toFixed(3));
                            console.log("outro fromSec / toSec :", outroFrom.toFixed(3), "/", outroTo.toFixed(3));
                            console.log("beats.length          :", beats.length);
                            console.log("letzter Beat          :", lastBeat !== null ? lastBeat.toFixed(3) + " s" : "—");
                            console.log("Beats im Outro-Fenster:", beatsInOutro.length, beatsInOutro.map(b => b.toFixed(2)));
                            console.log("Grid-Beats im Outro   : Index", firstGridIdx, "→", lastGridIdx,
                                        "  =", lastGridIdx - firstGridIdx + 1, "Grid-Beats");
                            console.log("erster Grid-Beat      :", firstGridBeat.toFixed(3), "s");
                            console.log("letzter Grid-Beat     :", lastGridBeat.toFixed(3), "s");
                            console.groupEnd();

                            const intro = calculateGridOffsetForWindow({ beats, bpm, gridStart, fromSec: 0, toSec: 30 });
                            const outro = calculateGridOffsetForWindow({ beats, bpm, gridStart, fromSec: outroFrom, toSec: outroTo });
                            console.group(`[GridOffset Result] ${current?.title}`);
                            console.log(`Intro (0–30s):     Offset ${intro.offsetMs.toFixed(1)} ms  |  ${intro.matchCount} Matches`);
                            console.log(`Outro (letzt 30s): Offset ${outro.offsetMs.toFixed(1)} ms  |  ${outro.matchCount} Matches`);
                            console.groupEnd();
                        }}
                        title="Grid-Offset Intro/Outro messen"
                        style={{ marginLeft: "4px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "4px", color: "#666", padding: "2px 8px", cursor: "pointer", fontSize: "13px" }}
                    >⊡</button>
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
                        beats={current.analysis?.beats}
                        metroBeat={metroBeat}
                    />
                    {/* BeatGridDebug ausgeblendet */}
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
