import { useEffect, useRef, useState } from "react";
import type { MixState } from "../modules/audio/mixEngine";
import type { MixTransitionPlan } from "../modules/transition/autoMixPlanner";
import { decideTransition } from "../modules/transition/autoMixPlanner";
import type { TransitionPoint } from "../types/track";
import { ROLE_COLORS } from "../modules/transition/transitionPointPlanner";
import CdjWaveform from "./CdjWaveform";
import { computeGridOffset, GRID_OFFSET_TOL_ENG, GRID_OFFSET_TOL_WIDE } from "../modules/analysis/gridOffsetAnalyzer";
import { detectDownbeatPhase } from "../modules/analysis/downbeatDetector";
import { loadAnalysisCache } from "../modules/analysis/analysisCache";

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
    // Deck A
    onPlay: () => void;
    onPause: () => void;
    onSkip: () => void;
    onStartAutomix: () => void;
    onSeek: (time: number) => void;
    onStop: () => void;
    onReset: () => void;
    // Deck B
    onDeckBPlay?: () => void;
    onDeckBPause?: () => void;
    onDeckBStop?: () => void;
    onDeckBSeek?: (time: number) => void;
    onSaveTransitionPoint?: (point: TransitionPoint) => void;
    onRemoveTransitionPoint?: (pointId: string) => void;
    onSaveTransitionPointB?: (point: TransitionPoint) => void;
    onRemoveTransitionPointB?: (pointId: string) => void;
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
    onDeckBPlay,
    onDeckBPause,
    onDeckBStop,
    onDeckBSeek,
    onSaveTransitionPoint,
    onRemoveTransitionPoint,
    onSaveTransitionPointB,
    onRemoveTransitionPointB,
    onSetVolume,
}: MixPlayerProps) {
    const status = state?.status ?? "idle";
    const isPlaying = status === "playing" || status === "transitioning";

    const current = state?.currentTrack ?? null;
    const next = state?.nextTrack ?? null;
    const plan = state?.transitionPlan ?? null;

    const curTime = state?.currentTime ?? 0;
    const curDur = state?.currentDuration ?? 0;
    const nxtTime = state?.nextTime ?? 0;
    const nxtPlaying = state?.nextPlaying ?? false;
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

    // Downbeat-Erkennung: Debug-Log + UI-State bei jedem Track-Wechsel
    useEffect(() => {
        // Sofort zurücksetzen — unabhängig von async Laden
        setDownbeatSuggestion(null);
        setTestOffset(0);

        if (!current) return;

        const title = current.title;
        const bpm   = current.analysis?.detectedBpm ?? current.bpm ?? 0;
        const dur   = current.analysis?.durationSeconds ?? 0;

        // Mix-Out-Zone bestimmen
        const beatDuration = bpm > 0 ? 60 / bpm : 0;
        const zoneEndSeconds: number =
            current.transitionPoints?.find(p => p.role === "loop-out" || p.role === "cut-out")?.timeSeconds
            ?? current.outroStartSeconds
            ?? current.analysis?.outroStartSeconds
            ?? dur;
        const zoneStartSeconds: number = Math.max(0, zoneEndSeconds - 64 * beatDuration);

        function runAndLog(beats: number[] | undefined | null) {
            if (!beats || beats.length < 16) {
                console.log("[Downbeat]", {
                    title,
                    phase: null,
                    confidence: 0,
                    reason: `beats[] nicht verfügbar (${beats?.length ?? 0} Einträge) — Track analysieren`,
                });
                return;
            }
            if (bpm <= 0 || dur <= 0) {
                console.log("[Downbeat]", { title, phase: null, confidence: 0,
                    reason: `BPM (${bpm}) oder Dauer (${dur}s) fehlt` });
                return;
            }

            const result = detectDownbeatPhase({
                beats,
                bpm,
                durationSeconds: dur,
                zoneStartSeconds,
                zoneEndSeconds,
            });
            if (!result) {
                console.log("[Downbeat]", { title, phase: null, confidence: 0, reason: "Erkennung fehlgeschlagen" });
                return;
            }

            // Kompakt-Log — immer sichtbar
            console.log("[Downbeat]", {
                title,
                phase: result.downbeatPhase,
                confidence: parseFloat((result.confidence * 100).toFixed(0)),
            });

            // UI-State setzen
            setDownbeatSuggestion({ phase: result.downbeatPhase, confidence: result.confidence });

            // Detail-Gruppe
            const pct = (result.confidence * 100).toFixed(0);
            console.group(`[Downbeat] "${title}" — Phase ${result.downbeatPhase}  (${pct}%)`);
            console.log("vorgeschlagene Phase  :", result.downbeatPhase,
                `→ Grid +${result.downbeatPhase} Beat${result.downbeatPhase !== 1 ? "s" : ""}`);
            console.log("Confidence            :", pct + "%");
            console.log("Grund                 :", result.reason);
            console.log("1 liegt aktuell auf   :", `Beat ${result.downbeatPhase + 1} des Rasters (Phase 0 = Grid-Anfang)`);
            console.log("Phase-Scores (norm.)  :", result.phaseScores.map((s, i) =>
                `P${i}=${s.toFixed(3)}`).join("  "));
            console.log("Metrik A (Dev)        :", result.debugInfo.metricA_scores.join("  "));
            console.log("Metrik B (IBI-Komp.)  :", result.debugInfo.metricB_scores.join("  "));
            console.log("Core-Beats            :", result.debugInfo.coreBeats,
                `(intro: −${result.debugInfo.introSkipped}  outro: −${result.debugInfo.outroSkipped})`);
            console.log("Fenster-Votes         :", result.debugInfo.windowVotes.join(" "),
                `(${result.debugInfo.windows} Fenster à 32 Beats)`);
            console.log("Zone                  :",
                result.debugInfo.zoneUsed
                    ? `aktiv — ${result.debugInfo.zoneStartSeconds?.toFixed(1)}s … ${result.debugInfo.zoneEndSeconds?.toFixed(1)}s`
                    : "Fallback (Intro/Outro 15%)");
            console.groupEnd();
        }

        // Beats direkt im Track-Objekt?
        const tracksBeats = current.analysis?.beats;
        if (tracksBeats && tracksBeats.length > 0) {
            runAndLog(tracksBeats);
        } else if (current.url) {
            // beats[] wird beim Speichern gestripped (sanitizeTrackForStorage) →
            // aus Analysis-Cache nachladen
            loadAnalysisCache(current.url)
                .then(cached => runAndLog(cached?.beats))
                .catch(() => runAndLog(null));
        } else {
            runAndLog(null);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [current?.id]);

    const [activityRegions, setActivityRegions] = useState<{ startSeconds: number; endSeconds: number; confidence: number }[] | null>(null);
    const [alignedVocalRegions, setAlignedVocalRegions] = useState<{ startSeconds: number; endSeconds: number }[] | null>(null);
    const [vocalMixZones, setVocalMixZones] = useState<{ type: "mix-in" | "mix-out"; startSeconds: number; endSeconds: number }[] | null>(null);

    useEffect(() => {
        setActivityRegions(null);
        setAlignedVocalRegions(null);
        setVocalMixZones(null);
        if (!current) return;
        // Bevorzugt aus Cache laden (enthält activityRegions nach Neuanalyse)
        const logRegions = (regions: typeof activityRegions) => {
            console.log("[ActivityRegions Player]", {
                track: current?.title,
                count: regions?.length ?? 0,
                first: regions?.slice?.(0, 3) ?? null,
            });
        };

        if (current.url) {
            loadAnalysisCache(current.url)
                .then(cached => {
                    console.log("[PlayerAnalysisKeys] current.analysis:", Object.keys((current.analysis as any) ?? {}));
                    console.log("[PlayerAnalysisKeys] cached:", Object.keys(cached ?? {}));
                    const src = (cached && Object.keys(cached).length > 0) ? cached : (current.analysis as any);
                    if (src?.activityRegions?.length > 0) {
                        setActivityRegions(src.activityRegions);
                        logRegions(src.activityRegions);
                    } else {
                        logRegions(null);
                    }
                    setAlignedVocalRegions(src?.alignedVocalRegions ?? null);
                    setVocalMixZones(src?.vocalMixZones ?? null);
                })
                .catch(() => {
                    const src = current.analysis as any;
                    if (src?.activityRegions) {
                        setActivityRegions(src.activityRegions);
                        logRegions(src.activityRegions);
                    } else {
                        logRegions(null);
                    }
                    setAlignedVocalRegions(src?.alignedVocalRegions ?? null);
                    setVocalMixZones(src?.vocalMixZones ?? null);
                });
        } else {
            const src = current.analysis as any;
            if (src?.activityRegions) {
                setActivityRegions(src.activityRegions);
                logRegions(src.activityRegions);
            } else {
                logRegions(null);
            }
            setAlignedVocalRegions(src?.alignedVocalRegions ?? null);
            setVocalMixZones(src?.vocalMixZones ?? null);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [current?.id]);

    const [metroOn, setMetroOn] = useState(false);
    const [downbeatSuggestion, setDownbeatSuggestion] = useState<{ phase: 0|1|2|3; confidence: number } | null>(null);
    const [testOffset, setTestOffset] = useState(0);
    const [testOffsetB, setTestOffsetB] = useState(0);
    const [metroBeat, setMetroBeat] = useState<{ n: number; t: number } | null>(null);
    const [metroBeatB, setMetroBeatB] = useState<{ n: number; t: number } | null>(null);
    const [debugGridOffsetSec, setDebugGridOffsetSec] = useState<number | null>(null);
    const audioCtxRef  = useRef<AudioContext | null>(null);
    const lastBeatNRef  = useRef<number>(-1);
    const lastBeatNBRef = useRef<number>(-1);

    useEffect(() => {
        lastBeatNRef.current = -1;
        setDebugGridOffsetSec(null);
    }, [current?.id]);
    useEffect(() => {
        lastBeatNBRef.current = -1;
        setTestOffsetB(0);
    }, [next?.id]);
    useEffect(() => {
        lastBeatNRef.current  = -1;
        lastBeatNBRef.current = -1;
    }, [metroOn]);

    useEffect(() => {
        if (!metroOn || !isPlaying) return;
        const bpm = current?.analysis?.detectedBpm ?? current?.bpm ?? 0;
        const rawGridStart = current?.analysis?.beatGridStartSeconds;
        if (!bpm || rawGridStart === undefined) return;
        const gridStart = debugGridOffsetSec !== null ? rawGridStart + debugGridOffsetSec : rawGridStart;
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
    }, [curTime, metroOn, isPlaying, current, debugGridOffsetSec]);

    useEffect(() => {
        if (!metroOn || !nxtPlaying) return;
        const bpm = next?.analysis?.detectedBpm ?? next?.bpm ?? 0;
        const gridStart = next?.analysis?.beatGridStartSeconds;
        if (!bpm || gridStart === undefined) return;
        const beatN = Math.floor((nxtTime - gridStart) / (60 / bpm));
        if (beatN < 0 || beatN === lastBeatNBRef.current) return;
        lastBeatNBRef.current = beatN;
        setMetroBeatB({ n: beatN, t: nxtTime });
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
    }, [nxtTime, metroOn, nxtPlaying, next]);

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

                            const { stabil, bereich, source, medianMs, medianSec, correctedGridStart, beatMs, intro, outro, introWide, outroWide } =
                                computeGridOffset({ beats, bpm, gridStart, durationSeconds: curDur });

                            console.group(`[GridOffset Result] ${current?.title}`);
                            console.log(`--- eng (${GRID_OFFSET_TOL_ENG} ms) ---`);
                            console.log(`Intro:  Offset ${intro.offsetMs.toFixed(1)} ms  |  ${intro.matchCount} Matches`);
                            console.log(`Outro:  Offset ${outro.offsetMs.toFixed(1)} ms  |  ${outro.matchCount} Matches`);
                            console.log(`--- wide (${GRID_OFFSET_TOL_WIDE} ms) ---`);
                            console.log(`Intro:  Offset ${introWide.offsetMs.toFixed(1)} ms  |  ${introWide.matchCount} Matches  |  Phase ${(Math.abs(introWide.offsetMs) / beatMs * 100).toFixed(0)}%`);
                            console.log(`Outro:  Offset ${outroWide.offsetMs.toFixed(1)} ms  |  ${outroWide.matchCount} Matches  |  Phase ${(Math.abs(outroWide.offsetMs) / beatMs * 100).toFixed(0)}%`);
                            console.log(`--- Ergebnis ---`);
                            console.log(`Quelle:            ${source}`);
                            console.log(`stabil:            ${stabil}${bereich ? `  (${bereich})` : ""}`);
                            console.log(`Median-Offset:     ${source !== "keine" ? medianMs.toFixed(1) + " ms" : "–"}`);
                            console.log(`GridStart (roh):   ${gridStart.toFixed(4)} s`);
                            if (stabil === "ja") {
                                console.log(`GridStart (korr):  ${correctedGridStart.toFixed(4)} s  ← global DEBUG aktiv`);
                            } else if (stabil === "teilweise" && bereich === "nur Outro") {
                                console.log(`Outro-Offset:      ${medianMs.toFixed(1)} ms  ← nur Outro-/Transition-Debug, kein globales Grid`);
                            }
                            console.groupEnd();

                            setDebugGridOffsetSec(stabil === "ja" ? medianSec : null);
                        }}
                        title={debugGridOffsetSec !== null ? `Grid-Offset aktiv: ${(debugGridOffsetSec * 1000).toFixed(1)} ms – klicken zum Neu-Messen` : "Grid-Offset Intro/Outro messen"}
                        style={{ marginLeft: "4px", background: debugGridOffsetSec !== null ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.05)", border: `1px solid ${debugGridOffsetSec !== null ? "#10b981" : "rgba(255,255,255,0.15)"}`, borderRadius: "4px", color: debugGridOffsetSec !== null ? "#10b981" : "#666", padding: "2px 8px", cursor: "pointer", fontSize: "13px" }}
                    >⊡</button>
                </div>
            </div>

            <div
                className="mix-seekbar"
                onClick={(e) => {
                    if (!current || curDur <= 0) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
                    onSeek(ratio * curDur);
                }}
            >
                <div className="mix-seekbar-fill" style={{ width: curDur > 0 ? `${(curTime / curDur) * 100}%` : "0%" }} />
                {plan && curDur > 0 && (
                    <div
                        className="mix-seekbar-marker"
                        style={{ left: `${(plan.outroStartSeconds / curDur) * 100}%` }}
                    />
                )}
            </div>

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

            {/* ── Downbeat-Testpanel ──────────────────────────── */}
            {current && (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", padding: "4px 8px", background: "rgba(10,16,30,0.8)", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                    <span style={{ fontSize: "11px", color: "#64748b", marginRight: "2px" }}>Downbeat:</span>
                    {downbeatSuggestion ? (() => {
                        const pct = Math.round(downbeatSuggestion.confidence * 100);
                        const effectivePhase = (downbeatSuggestion.phase - testOffset + 4) % 4;
                        if (testOffset > 0) {
                            return (
                                <>
                                    <span style={{ fontSize: "11px", color: "#fbbf24", fontWeight: 700 }}>
                                        Manueller Test aktiv – bitte hören
                                    </span>
                                    <span style={{ fontSize: "11px", color: "#64748b" }}>
                                        Auto: Phase {downbeatSuggestion.phase} · {pct}%
                                    </span>
                                    <span style={{ fontSize: "11px", color: "#fbbf24" }}>
                                        Test +{testOffset} Beats → effektiv Phase {effectivePhase}
                                    </span>
                                </>
                            );
                        }
                        const statusLabel = pct >= 85 ? "sicher" : pct >= 60 ? "prüfen" : "unsicher";
                        const statusColor = pct >= 85 ? "#86efac" : pct >= 60 ? "#fbbf24" : "#f87171";
                        return (
                            <>
                                <span style={{ fontSize: "11px", color: statusColor, fontWeight: 700 }}>
                                    Auto-Downbeat: {statusLabel}
                                </span>
                                <span style={{ fontSize: "11px", color: "#64748b" }}>
                                    Phase {downbeatSuggestion.phase} · {pct}% · Vorschlag: Grid +{downbeatSuggestion.phase} Beat{downbeatSuggestion.phase !== 1 ? "s" : ""}
                                </span>
                            </>
                        );
                    })() : (
                        <span style={{ fontSize: "11px", color: "#334155" }}>wird geladen…</span>
                    )}
                    <span style={{ fontSize: "11px", color: "#1e3a5a", margin: "0 2px" }}>│</span>
                    {([1, 2, 3] as const).map(n => (
                        <button
                            key={n}
                            onClick={() => setTestOffset(n)}
                            style={{ background: testOffset === n ? "rgba(251,191,36,0.2)" : "rgba(255,255,255,0.04)", border: `1px solid ${testOffset === n ? "#fbbf24" : "rgba(255,255,255,0.12)"}`, borderRadius: "4px", color: testOffset === n ? "#fbbf24" : "#64748b", fontSize: "11px", padding: "2px 8px", cursor: "pointer", fontWeight: testOffset === n ? 700 : 400 }}
                        >Test +{n}</button>
                    ))}
                    <button
                        onClick={() => setTestOffset(0)}
                        style={{ background: testOffset === 0 ? "rgba(99,102,241,0.12)" : "rgba(255,255,255,0.04)", border: `1px solid ${testOffset === 0 ? "#818cf8" : "rgba(255,255,255,0.12)"}`, borderRadius: "4px", color: testOffset === 0 ? "#818cf8" : "#475569", fontSize: "11px", padding: "2px 8px", cursor: "pointer" }}
                    >Reset</button>
                    {testOffset > 0 && (
                        <span style={{ fontSize: "11px", color: "#fbbf24", fontWeight: 700, marginLeft: "4px" }}>
                            ● Test-Phase aktiv: +{testOffset} Beat{testOffset !== 1 ? "s" : ""}
                        </span>
                    )}
                </div>
            )}

            <div className="mix-waveform-wrap">
                {current && curDur > 0 ? (() => {
                    const deckABpm = current.analysis?.detectedBpm ?? current.bpm ?? 0;
                    const deckABeatDur = deckABpm > 0 ? 60 / deckABpm : 0;
                    const deckAMixOutEnd: number =
                        current.transitionPoints?.find(p => p.role === "loop-out" || p.role === "cut-out")?.timeSeconds
                        ?? current.outroStartSeconds
                        ?? current.analysis?.outroStartSeconds
                        ?? curDur;
                    const deckAMixOutStart = Math.max(0, deckAMixOutEnd - 64 * deckABeatDur);
                    const deckAMixInStart = 0;
                    const deckAMixInEnd = 64 * deckABeatDur;
                    return (
                        <CdjWaveform
                            trackId={current.id}
                            waveform={waveA}
                            waveformPeaks={current.analysis?.waveformPeaks}
                            duration={curDur}
                            currentTime={curTime}
                            onSeek={onSeek}
                            bpm={current.analysis?.detectedBpm ?? current.bpm}
                            beatGridStartSeconds={
                                debugGridOffsetSec !== null && current.analysis?.beatGridStartSeconds !== undefined
                                    ? current.analysis.beatGridStartSeconds + debugGridOffsetSec
                                    : current.analysis?.beatGridStartSeconds
                            }
                            beats={current.analysis?.beats}
                            metroBeat={metroBeat}
                            phaseOffset={testOffset}
                            mixInStartSeconds={deckAMixInStart}
                            mixInEndSeconds={deckAMixInEnd}
                            mixOutStartSeconds={deckAMixOutStart}
                            mixOutEndSeconds={deckAMixOutEnd}
                            activityRegions={activityRegions ?? undefined}
                            preActivityBeatCount={16}
                            alignedVocalRegions={alignedVocalRegions ?? undefined}
                            vocalMixZones={vocalMixZones ?? undefined}
                        />
                    );
                })() : (
                    <div className="mix-waveform-empty">Kein Track geladen</div>
                )}
            </div>

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
                            <span className="mix-track-title">{next.title}</span>
                            <span className="mix-track-meta">
                                {next.artist} · {next.bpm} BPM · {next.key} · NRG {next.energy}
                                <span className="mix-timecode">{formatTime(nxtTime)} / {formatTime(nxtDur)}</span>
                            </span>
                        </>
                    ) : (
                        <span className="mix-track-empty">Kein nächster Track bereit</span>
                    )}
                </div>
                <div className="mix-controls">
                    {next && !nxtPlaying && (
                        <button className="mix-btn mix-btn-play" onClick={onDeckBPlay} title="Deck B vorhören">▶</button>
                    )}
                    {next && nxtPlaying && (
                        <button className="mix-btn mix-btn-pause" onClick={onDeckBPause} title="Deck B Vorhör pausieren">⏸</button>
                    )}
                    {(isPlaying || status === "paused") && next && (
                        <button className="mix-btn mix-btn-skip" onClick={onSkip} title="Sofort zu Deck B wechseln">⏭</button>
                    )}
                    {next && (
                        <button className="mix-btn mix-btn-stop" onClick={onDeckBStop} title="Deck B leeren">■</button>
                    )}
                </div>
            </div>

            <div className="mix-seekbar">
                <div className="mix-seekbar-fill" style={{ width: nxtDur > 0 ? `${(nxtTime / nxtDur) * 100}%` : "0%" }} />
            </div>

            {next && onSaveTransitionPointB && (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px", padding: "4px 8px", background: "rgba(15,23,42,0.6)" }}>
                    <span style={{ fontSize: "11px", color: "#64748b", fontVariantNumeric: "tabular-nums", marginRight: "4px" }}>
                        @ {formatTime(nxtTime)}
                    </span>
                    {TYPE_OPTIONS.map(opt => {
                        const c = ROLE_COLORS[opt.role];
                        return (
                            <button
                                key={opt.key}
                                onClick={() => onSaveTransitionPointB({
                                    id: `B-manual-${opt.role}-${nxtTime.toFixed(2)}`,
                                    role: opt.role,
                                    bars: opt.bars,
                                    timeSeconds: nxtTime,
                                    source: "manual",
                                    label: opt.label,
                                })}
                                style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: "4px", color: c.text, padding: "3px 8px", fontSize: "11px", cursor: "pointer", fontWeight: 600 }}
                            >
                                {opt.label}
                            </button>
                        );
                    })}
                </div>
            )}

            {next && onRemoveTransitionPointB && (next.transitionPoints ?? []).length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", padding: "2px 8px 4px", background: "rgba(15,23,42,0.6)" }}>
                    <span style={{ fontSize: "10px", color: "#475569", alignSelf: "center", marginRight: "2px" }}>Gesetzt:</span>
                    {(next.transitionPoints ?? []).map(p => {
                        const c = ROLE_COLORS[p.role];
                        return (
                            <span
                                key={p.id}
                                style={{ display: "inline-flex", alignItems: "center", gap: "3px", background: c.bg, border: `1px solid ${c.border}`, borderRadius: "4px", padding: "1px 5px", fontSize: "10px", color: c.text }}
                            >
                                {p.label ?? p.role} @ {formatTime(p.timeSeconds)}
                                <button
                                    onClick={() => onRemoveTransitionPointB(p.id)}
                                    style={{ background: "none", border: "none", cursor: "pointer", color: c.text, padding: "0 0 0 2px", fontSize: "10px", lineHeight: 1 }}
                                    title="Entfernen"
                                >×</button>
                            </span>
                        );
                    })}
                </div>
            )}

            <div className="mix-waveform-wrap mix-waveform-wrap-next">
                {next && nxtDur > 0 ? (
                    <CdjWaveform
                        key={next.id}
                        trackId={next.id}
                        waveform={waveB}
                        waveformPeaks={next.analysis?.waveformPeaks}
                        duration={nxtDur}
                        currentTime={nxtTime}
                        onSeek={onDeckBSeek ?? (() => {})}
                        bpm={next.analysis?.detectedBpm ?? next.bpm}
                        beatGridStartSeconds={next.analysis?.beatGridStartSeconds}
                        beats={next.analysis?.beats}
                        metroBeat={metroBeatB}
                        phaseOffset={testOffsetB}
                    />
                ) : (
                    <div className="mix-waveform-empty">Kein Track bereit</div>
                )}
            </div>

            {next && next.analysis?.beatGridStartSeconds !== undefined && (
                <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "2px 16px 4px", background: "rgba(10,16,30,0.8)" }}>
                    <span style={{ fontSize: "10px", color: "#475569" }}>Deck B Phase:</span>
                    <button
                        onClick={() => setTestOffsetB(o => (o - 1 + 4) % 4)}
                        style={{ background: "rgba(10,20,35,0.85)", border: "1px solid #1e3a5a", borderRadius: "3px", color: "#94a3b8", fontSize: "10px", padding: "1px 7px", cursor: "pointer", lineHeight: 1.5 }}
                    >Grid −1</button>
                    <span style={{ fontSize: "10px", color: testOffsetB === 0 ? "#475569" : "#fbbf24", fontVariantNumeric: "tabular-nums", background: "rgba(10,20,35,0.85)", padding: "1px 5px", borderRadius: "3px" }}>
                        {testOffsetB === 0 ? "Phase 0" : `+${testOffsetB} Beat${testOffsetB > 1 ? "s" : ""}`}
                    </span>
                    <button
                        onClick={() => setTestOffsetB(o => (o + 1) % 4)}
                        style={{ background: "rgba(10,20,35,0.85)", border: "1px solid #1e3a5a", borderRadius: "3px", color: "#94a3b8", fontSize: "10px", padding: "1px 7px", cursor: "pointer", lineHeight: 1.5 }}
                    >Grid +1</button>
                    {testOffsetB !== 0 && (
                        <button
                            onClick={() => setTestOffsetB(0)}
                            style={{ background: "rgba(10,20,35,0.85)", border: "1px solid #1e3a5a", borderRadius: "3px", color: "#64748b", fontSize: "10px", padding: "1px 7px", cursor: "pointer", lineHeight: 1.5 }}
                        >Reset</button>
                    )}
                </div>
            )}
        </div>
    );
}
