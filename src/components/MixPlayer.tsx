import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { MixState } from "../modules/audio/mixEngine";
import type { MixTransitionPlan } from "../modules/transition/autoMixPlanner";
import { decideTransition } from "../modules/transition/autoMixPlanner";
import type { TransitionPoint, TransitionSettings, TransitionFade, TransitionEQ, TransitionEffect, TransitionStyle } from "../types/track";
import { ROLE_COLORS } from "../modules/transition/transitionPointPlanner";
import CdjWaveform, { type CdjWaveformHandle } from "./CdjWaveform";
import { computeGridOffset, GRID_OFFSET_TOL_ENG, GRID_OFFSET_TOL_WIDE } from "../modules/analysis/gridOffsetAnalyzer";
import { detectDownbeatPhase } from "../modules/analysis/downbeatDetector";
import { loadAnalysisCache, saveAnalysisCache } from "../modules/analysis/analysisCache";
import type { WaveformPeaks } from "../modules/analysis/waveformPeaks";

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
    { key: "loop-in-8",   label: "Loop-In 8",   role: "loop-in",     bars: 8    },
    { key: "loop-in-16",  label: "Loop-In 16",  role: "loop-in",     bars: 16   },
    { key: "loop-in-32",  label: "Loop-In 32",  role: "loop-in",     bars: 32   },
    { key: "cut-in",      label: "Cut-In",      role: "cut-in",      bars: null },
    { key: "passage",     label: "Passage",     role: "passage-out", bars: null },
];

function formatTime(s: number): string {
    if (!Number.isFinite(s) || s < 0) return "0:00";
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function transitionLabel(plan: MixTransitionPlan): string {
    return plan.type === "blend" ? `Überblenden ${Math.round(plan.blendDurationSeconds)}s` : "Schnitt";
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
    onUpdateTransitionPoint?: (point: TransitionPoint) => void;
    onSaveTransitionPointB?: (point: TransitionPoint) => void;
    onRemoveTransitionPointB?: (pointId: string) => void;
    onUpdateTransitionPointB?: (point: TransitionPoint) => void;
    onSetVolume?: (v: number) => void;
    onSetRateNext?: (rate: number) => void;
    onSetRateCur?: (rate: number) => void;
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
    onUpdateTransitionPoint,
    onSaveTransitionPointB,
    onRemoveTransitionPointB,
    onUpdateTransitionPointB,
    onSetVolume,
    onSetRateNext,
    onSetRateCur,
}: MixPlayerProps) {
    const waveformRefA = useRef<CdjWaveformHandle>(null);
    const waveformRefB = useRef<CdjWaveformHandle>(null);

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

    function syncBtoA() {
        const masterBpm = current?.analysis?.detectedBpm ?? current?.bpm ?? 0;
        const slaveBpm  = next?.analysis?.detectedBpm  ?? next?.bpm  ?? 0;
        if (!masterBpm || !slaveBpm || !next) return;

        // Rate: Slave auf Master-BPM bringen
        onSetRateNext?.(masterBpm / slaveBpm);

        // Phase-Sync: firstbeat hat Vorrang vor Analyse-Wert
        const masterGrid = curFirstBeat ?? current?.analysis?.beatGridStartSeconds;
        const slaveGrid  = nxtFirstBeat ?? next?.analysis?.beatGridStartSeconds ?? nextGridStartOverride;
        if (masterGrid == null || slaveGrid == null) return;

        const masterInterval = 60 / masterBpm;
        const slaveInterval  = 60 / slaveBpm;
        const masterFrac = ((curTime - masterGrid) % masterInterval + masterInterval) % masterInterval;
        const k = Math.round((nxtTime - slaveGrid) / slaveInterval);
        onDeckBSeek?.(slaveGrid + k * slaveInterval + (masterFrac / masterInterval) * slaveInterval);
    }

    function syncAtoB() {
        const masterBpm = next?.analysis?.detectedBpm  ?? next?.bpm  ?? 0;
        const slaveBpm  = current?.analysis?.detectedBpm ?? current?.bpm ?? 0;
        if (!masterBpm || !slaveBpm || !current) return;
        onSetRateCur?.(masterBpm / slaveBpm);
        const masterGrid = next?.analysis?.beatGridStartSeconds ?? nextGridStartOverride;
        const slaveGrid  = current?.analysis?.beatGridStartSeconds;
        if (masterGrid == null || slaveGrid === undefined) return;
        const masterInterval = 60 / masterBpm;
        const slaveInterval  = 60 / slaveBpm;
        const masterFrac = ((nxtTime - masterGrid) % masterInterval + masterInterval) % masterInterval;
        const k = Math.round((curTime - slaveGrid) / slaveInterval);
        onSeek(slaveGrid + k * slaveInterval + (masterFrac / masterInterval) * slaveInterval);
    }

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
    const [waveformPeaksOverride, setWaveformPeaksOverride] = useState<WaveformPeaks | null>(null);
    const [nextWaveformPeaksOverride, setNextWaveformPeaksOverride] = useState<WaveformPeaks | null>(null);
    const [nextBeatsOverride, setNextBeatsOverride] = useState<number[] | null>(null);
    const [nextGridStartOverride, setNextGridStartOverride] = useState<number | null>(null);

    // Transition-Punkt-Editor
    type EditState = { pointId: string; settings: TransitionSettings; deck: "A" | "B" };
    const [editState, setEditState] = useState<EditState | null>(null);

    function defaultSettings(): TransitionSettings {
        return { fade: "none", fadeDurationBeats: 16, eq: "none", effect: "none", style: "soft" };
    }

    function openEdit(point: TransitionPoint, deck: "A" | "B") {
        setEditState({
            pointId: point.id,
            settings: { ...defaultSettings(), ...(point.settings ?? {}) },
            deck,
        });
    }

    function closeEdit() { setEditState(null); }

    function saveEdit(points: TransitionPoint[], onUpdate?: (p: TransitionPoint) => void) {
        if (!editState) return;
        const p = points.find(tp => tp.id === editState.pointId);
        if (p) onUpdate?.({ ...p, settings: editState.settings });
        closeEdit();
    }

    function renderEditPanel(points: TransitionPoint[], onUpdate?: (p: TransitionPoint) => void) {
        if (!editState) return null;
        const p = points.find(tp => tp.id === editState.pointId);
        if (!p) return null;
        const c = ROLE_COLORS[p.role];
        const s = editState.settings;
        const btnBase: React.CSSProperties = { borderRadius: "3px", fontSize: "10px", cursor: "pointer", padding: "1px 6px", border: "1px solid" };
        const active: React.CSSProperties = { ...btnBase, background: "rgba(99,102,241,0.2)", borderColor: "#818cf8", color: "#818cf8" };
        const inactive: React.CSSProperties = { ...btnBase, background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.1)", color: "#64748b" };

        function row(label: string, children: React.ReactNode) {
            return (
                <div style={{ display: "flex", alignItems: "center", gap: "4px", marginBottom: "3px" }}>
                    <span style={{ fontSize: "10px", color: "#64748b", minWidth: "44px" }}>{label}</span>
                    {children}
                </div>
            );
        }

        return (
            <div style={{ padding: "6px 8px 4px", background: "rgba(8,13,26,0.95)", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                <div style={{ fontSize: "10px", color: c.text, fontWeight: 600, marginBottom: "5px" }}>
                    ✎ {p.label ?? p.role} @ {formatTime(p.timeSeconds)}
                </div>
                {row("Fade", (["none", "fade", "crossfade"] as TransitionFade[]).map(f => (
                    <button key={f} style={s.fade === f ? active : inactive}
                        onClick={() => setEditState(es => es ? { ...es, settings: { ...es.settings, fade: f } } : es)}>
                        {f === "none" ? "Kein" : f === "fade" ? "Fade" : "Crossfade"}
                    </button>
                )))}
                {s.fade !== "none" && row("", (
                    <>
                        <span style={{ fontSize: "10px", color: "#64748b" }}>Dauer</span>
                        <input type="number" min={4} max={64} step={4} value={s.fadeDurationBeats}
                            onChange={e => setEditState(es => es ? { ...es, settings: { ...es.settings, fadeDurationBeats: Number(e.target.value) } } : es)}
                            style={{ width: "38px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "3px", color: "#94a3b8", fontSize: "10px", padding: "1px 4px" }}
                        />
                        <span style={{ fontSize: "10px", color: "#475569" }}>Beats</span>
                    </>
                ))}
                {row("EQ", ([
                    { v: "none" as TransitionEQ, label: "Kein" },
                    { v: "bass-swap" as TransitionEQ, label: "Bass-Swap" },
                    { v: "filter-hpf" as TransitionEQ, label: "HPF-Filter" },
                    { v: "filter-lpf" as TransitionEQ, label: "LPF-Filter" },
                ]).map(({ v, label }) => (
                    <button key={v} style={s.eq === v ? active : inactive}
                        onClick={() => setEditState(es => es ? { ...es, settings: { ...es.settings, eq: v } } : es)}>
                        {label}
                    </button>
                )))}
                {row("Effekt", ([
                    { v: "none" as TransitionEffect, label: "Kein" },
                    { v: "echo-out" as TransitionEffect, label: "Echo-Out" },
                    { v: "backspin" as TransitionEffect, label: "Backspin" },
                    { v: "vinyl-brake" as TransitionEffect, label: "Vinyl-Brake" },
                ]).map(({ v, label }) => (
                    <button key={v} style={s.effect === v ? active : inactive}
                        onClick={() => setEditState(es => es ? { ...es, settings: { ...es.settings, effect: v } } : es)}>
                        {label}
                    </button>
                )))}
                {row("Stil", ([
                    { v: "soft" as TransitionStyle, label: "Soft" },
                    { v: "hard" as TransitionStyle, label: "Hard-Cut" },
                ]).map(({ v, label }) => (
                    <button key={v} style={s.style === v ? active : inactive}
                        onClick={() => setEditState(es => es ? { ...es, settings: { ...es.settings, style: v } } : es)}>
                        {label}
                    </button>
                )))}
                {row("Notiz", (
                    <input type="text" placeholder="optional" value={s.notes ?? ""}
                        onChange={e => setEditState(es => es ? { ...es, settings: { ...es.settings, notes: e.target.value || undefined } } : es)}
                        style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "3px", color: "#94a3b8", fontSize: "10px", padding: "1px 6px" }}
                    />
                ))}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "4px", marginTop: "4px" }}>
                    <button onClick={closeEdit}
                        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "3px", color: "#64748b", padding: "2px 10px", fontSize: "10px", cursor: "pointer" }}>
                        Abbrechen
                    </button>
                    <button onClick={() => saveEdit(points, onUpdate)}
                        style={{ background: "rgba(99,102,241,0.2)", border: "1px solid #818cf8", borderRadius: "3px", color: "#818cf8", padding: "2px 10px", fontSize: "10px", cursor: "pointer", fontWeight: 600 }}>
                        Speichern
                    </button>
                </div>
            </div>
        );
    }

    // Manuell gesetzte "1" aus .tkdj/*.firstbeat.json für Sync
    const [curFirstBeat, setCurFirstBeat] = useState<number | null>(null);
    const [nxtFirstBeat, setNxtFirstBeat] = useState<number | null>(null);

    function getFirstBeatPath(url: string) {
        const parts = url.split("/");
        const fileName = parts.pop() ?? "track";
        const dir = parts.join("/");
        const baseName = fileName.replace(/\.[^/.]+$/, "");
        return `${dir}/.tkdj/${baseName}.firstbeat.json`;
    }

    async function loadFirstBeat(url: string): Promise<number | null> {
        try {
            const path = getFirstBeatPath(url);
            const exists = await invoke<boolean>("tkdj_file_exists", { path });
            if (!exists) return null;
            const raw = await invoke<string>("tkdj_read_text_file", { path });
            return (JSON.parse(raw) as { firstBeatSeconds: number }).firstBeatSeconds;
        } catch { return null; }
    }

    useEffect(() => {
        setCurFirstBeat(null);
        if (!current?.url) return;
        loadFirstBeat(current.url).then(setCurFirstBeat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [current?.id]);

    useEffect(() => {
        setNxtFirstBeat(null);
        if (!next?.url) return;
        loadFirstBeat(next.url).then(setNxtFirstBeat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [next?.id]);

    useEffect(() => {
        setActivityRegions(null);
        setAlignedVocalRegions(null);
        setVocalMixZones(null);
        setWaveformPeaksOverride(null);
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
                    if (src?.waveformPeaks && !current.analysis?.waveformPeaks) {
                        setWaveformPeaksOverride(src.waveformPeaks);
                    }
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
        setNextBeatsOverride(null);
        setNextGridStartOverride(null);
    }, [next?.id]);
    useEffect(() => {
        setNextWaveformPeaksOverride(null);
        if (!next?.url) return;
        const needsPeaks = !next.analysis?.waveformPeaks;
        const needsBeats = !next.analysis?.beats?.length;
        const needsGridStart = next.analysis?.beatGridStartSeconds === undefined;
        if (!needsPeaks && !needsBeats && !needsGridStart) return;
        loadAnalysisCache(next.url)
            .then(cached => {
                if (cached?.waveformPeaks && needsPeaks) setNextWaveformPeaksOverride(cached.waveformPeaks);
                if (cached?.beats?.length && needsBeats) setNextBeatsOverride(cached.beats);
                if (cached?.beatGridStartSeconds !== undefined && needsGridStart) setNextGridStartOverride(cached.beatGridStartSeconds);
            })
            .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        status === "playing" ? "LÄUFT" :
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
                                {current.artist} · {current.bpm} BPM · {current.key} · ENR {current.energy}
                                <span className="mix-timecode">{formatTime(curTime)} / {formatTime(curDur)}</span>
                            </span>
                        </>
                    ) : (
                        <span className="mix-track-empty">Songs in die Queue laden, dann Automix starten</span>
                    )}
                </div>

                <div className="mix-controls">
                    {status === "idle" && (
                        <button className="mix-btn mix-btn-start" onClick={onStartAutomix}>▶ Starten</button>
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
                        <button className="mix-btn mix-btn-stop" onClick={onStop} title="Auswerfen">■</button>
                    )}
                    {(isPlaying || status === "paused") && (
                        <button className="mix-btn mix-btn-reset" onClick={onReset} title="Zurücksetzen + Queue leeren">↺</button>
                    )}
                    {nxtPlaying && current && next && (
                        <button
                            onClick={syncAtoB}
                            title="Deck A auf Deck-B-BPM und -Phase synchronisieren"
                            style={{ marginLeft: "4px", background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.45)", borderRadius: "4px", color: "#34d399", padding: "2px 8px", cursor: "pointer", fontSize: "12px", fontWeight: 700, letterSpacing: "0.03em" }}
                        >SYNC</button>
                    )}
                    {false && <button
                        onClick={async () => {
                            if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
                            await audioCtxRef.current.resume();
                            const next = !metroOn;
                            onSetVolume?.(next ? 0.25 : 1.0);
                            setMetroOn(next);
                        }}
                        title="Metronom-Grid-Debug"
                        style={{ marginLeft: "8px", background: metroOn ? "rgba(251,191,36,0.25)" : "rgba(255,255,255,0.05)", border: `1px solid ${metroOn ? "#fbbf24" : "rgba(255,255,255,0.15)"}`, borderRadius: "4px", color: metroOn ? "#fbbf24" : "#666", padding: "2px 8px", cursor: "pointer", fontSize: "13px" }}
                    >♩</button>}
                    {false && <button
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
                        title={debugGridOffsetSec !== null ? `Grid-Offset aktiv: ${((debugGridOffsetSec ?? 0) * 1000).toFixed(1)} ms – klicken zum Neu-Messen` : "Grid-Offset Intro/Outro messen"}
                        style={{ marginLeft: "4px", background: debugGridOffsetSec !== null ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.05)", border: `1px solid ${debugGridOffsetSec !== null ? "#10b981" : "rgba(255,255,255,0.15)"}`, borderRadius: "4px", color: debugGridOffsetSec !== null ? "#10b981" : "#666", padding: "2px 8px", cursor: "pointer", fontSize: "13px" }}
                    >⊡</button>}
                    {false && current?.url && current!.analysis?.beatGridStartSeconds !== undefined && (current!.analysis?.detectedBpm ?? current!.bpm) && (
                        <button
                            onClick={async () => {
                                const url = current!.url!;
                                const bpm = current!.analysis?.detectedBpm ?? current!.bpm ?? 0;
                                const rawGridStart = current!.analysis!.beatGridStartSeconds!;
                                if (!bpm) return;
                                const beatInterval = 60 / bpm;
                                const effectiveGridStart = rawGridStart + (debugGridOffsetSec ?? 0);
                                // Nächsten Grid-Beat zur aktuellen Playhead-Position finden
                                const k = Math.round((curTime - effectiveGridStart) / beatInterval);
                                // Grid so verschieben, dass Beat k die „1" wird (k % 4 === 0)
                                const shift = ((k % 4) + 4) % 4;
                                const newGridStart = effectiveGridStart + shift * beatInterval;
                                const cached = await loadAnalysisCache(url);
                                if (!cached) return;
                                await saveAnalysisCache(url, { ...cached, beatGridStartSeconds: newGridStart });
                                setDebugGridOffsetSec(newGridStart - rawGridStart || null);
                                setTestOffset(0);
                            }}
                            title="Playhead-Position als '1' setzen und speichern (.tkdj)"
                            style={{ marginLeft: "4px", background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.4)", borderRadius: "4px", color: "#818cf8", padding: "2px 8px", cursor: "pointer", fontSize: "13px" }}
                        >1↓</button>
                    )}
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

            {onSaveTransitionPoint && (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px", padding: "4px 8px", background: "rgba(15,23,42,0.6)", opacity: current ? 1 : 0.35, pointerEvents: current ? "auto" : "none" }}>
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
                    <span style={{ color: "#1e2a3a", fontSize: "11px", margin: "0 2px" }}>│</span>
                    <button onClick={() => waveformRefA.current?.saveFirstBeat()}
                        style={{ background: "#1a2a1a", border: "1px solid #ff5050", borderRadius: "4px", color: "#ff5050", padding: "3px 8px", fontSize: "11px", cursor: "pointer", fontWeight: 600 }}>
                        ▼1
                    </button>
                    <button onClick={() => waveformRefA.current?.setVocalStart()}
                        style={{ background: "#001a22", border: "1px solid #00dcff", borderRadius: "4px", color: "#00dcff", padding: "3px 8px", fontSize: "11px", cursor: "pointer", fontWeight: 600 }}>
                        VS
                    </button>
                    <button onClick={() => waveformRefA.current?.jumpToVocalEnd()}
                        style={{ background: "#1a1000", border: "1px solid #ff9600", borderRadius: "4px", color: "#ff9600", padding: "3px 8px", fontSize: "11px", cursor: "pointer", fontWeight: 600 }}>
                        ⏭VE
                    </button>
                    <button onClick={() => waveformRefA.current?.setVocalEnd()}
                        style={{ background: "#1a1000", border: "1px solid #ff9600", borderRadius: "4px", color: "#ff9600", padding: "3px 8px", fontSize: "11px", cursor: "pointer", fontWeight: 600 }}>
                        VE
                    </button>
                    <span style={{ color: "#1e2a3a", fontSize: "11px", margin: "0 2px" }}>│</span>
                    <button onClick={() => waveformRefA.current?.prevMarker()}
                        style={{ background: "#151525", border: "1px solid #6688cc", borderRadius: "4px", color: "#6688cc", padding: "3px 8px", fontSize: "11px", cursor: "pointer", fontWeight: 600 }}>
                        ◀
                    </button>
                    <button onClick={() => waveformRefA.current?.nextMarker()}
                        style={{ background: "#151525", border: "1px solid #6688cc", borderRadius: "4px", color: "#6688cc", padding: "3px 8px", fontSize: "11px", cursor: "pointer", fontWeight: 600 }}>
                        ▶
                    </button>
                </div>
            )}

            {onRemoveTransitionPoint && (current?.transitionPoints ?? []).length > 0 && (
                <div style={{ background: "rgba(15,23,42,0.6)" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", padding: "2px 8px 4px" }}>
                        <span style={{ fontSize: "10px", color: "#475569", alignSelf: "center", marginRight: "2px" }}>Gesetzt:</span>
                        {(current?.transitionPoints ?? []).map(p => {
                            const c = ROLE_COLORS[p.role];
                            const isEditing = editState?.pointId === p.id && editState.deck === "A";
                            return (
                                <span
                                    key={p.id}
                                    style={{ display: "inline-flex", alignItems: "center", gap: "3px", background: c.bg, border: `1px solid ${isEditing ? c.text : c.border}`, borderRadius: "4px", padding: "1px 5px", fontSize: "10px", color: c.text }}
                                >
                                    <span
                                        onClick={() => isEditing ? closeEdit() : openEdit(p, "A")}
                                        style={{ cursor: "pointer" }}
                                        title="Einstellungen bearbeiten"
                                    >
                                        {p.label ?? p.role} @ {formatTime(p.timeSeconds)}{p.settings && p.settings.fade !== "none" || p.settings?.eq !== "none" || p.settings?.effect !== "none" ? " ✎" : ""}
                                    </span>
                                    <button
                                        onClick={() => onRemoveTransitionPoint(p.id)}
                                        style={{ background: "none", border: "none", cursor: "pointer", color: c.text, padding: "0 0 0 2px", fontSize: "10px", lineHeight: 1 }}
                                        title="Entfernen"
                                    >×</button>
                                </span>
                            );
                        })}
                    </div>
                    {editState?.deck === "A" && renderEditPanel(current?.transitionPoints ?? [], onUpdateTransitionPoint)}
                </div>
            )}

            {/* ── Downbeat-Testpanel disabled (Superpowered migration) ── */}
            {false && current && (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", padding: "4px 8px", background: "rgba(10,16,30,0.8)", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                    <span style={{ fontSize: "11px", color: "#64748b", marginRight: "2px" }}>Downbeat:</span>
                    {downbeatSuggestion ? (() => {
                        const ds = downbeatSuggestion!;
                        const pct = Math.round(ds.confidence * 100);
                        const effectivePhase = (ds.phase - testOffset + 4) % 4;
                        if (testOffset > 0) {
                            return (
                                <>
                                    <span style={{ fontSize: "11px", color: "#fbbf24", fontWeight: 700 }}>
                                        Manueller Test aktiv – bitte hören
                                    </span>
                                    <span style={{ fontSize: "11px", color: "#64748b" }}>
                                        Auto: Phase {ds.phase} · {pct}%
                                    </span>
                                    <span style={{ fontSize: "11px", color: "#fbbf24" }}>
                                        Test +{testOffset} Beats → effektive Phase {effectivePhase}
                                    </span>
                                </>
                            );
                        }
                        const statusLabel = pct >= 85 ? "sicher" : pct >= 60 ? "prüfen" : "unsicher";
                        const statusColor = pct >= 85 ? "#86efac" : pct >= 60 ? "#fbbf24" : "#f87171";
                        return (
                            <>
                                <span style={{ fontSize: "11px", color: statusColor, fontWeight: 700 }}>
                                    Downbeat: {statusLabel}
                                </span>
                                <span style={{ fontSize: "11px", color: "#64748b" }}>
                                    Phase {ds.phase} · {pct}% · Vorschlag: Grid +{ds.phase} Beat{ds.phase !== 1 ? "s" : ""}
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
                    >Zurück</button>
                    {testOffset > 0 && (
                        <span style={{ fontSize: "11px", color: "#fbbf24", fontWeight: 700, marginLeft: "4px" }}>
                            ● Testphase aktiv: +{testOffset} Beat{testOffset !== 1 ? "s" : ""}
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
                            ref={waveformRefA}
                            trackId={current.id}
                            filePath={current.url}
                            waveform={waveA}
                            waveformPeaks={current.analysis?.waveformPeaks ?? waveformPeaksOverride ?? undefined}
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
                            isPlaying={isPlaying}
                        />
                    );
                })() : (
                    <div className="mix-waveform-empty">Kein Track aktiv</div>
                )}
            </div>

            {/* ── Track B: nächster ───────────────────────────── */}
            <div className="mix-track-row mix-track-row-next">
                <div className="mix-track-info">
                    <span className="mix-status-label">
                        ALS NÄCHSTES
                        {plan && <span className="mix-transition-badge">{transitionLabel(plan)}</span>}
                        {state?.timeToTransition != null && (
                            <span className="mix-countdown"> in {formatTime(state.timeToTransition)}</span>
                        )}
                    </span>
                    {next ? (
                        <>
                            <span className="mix-track-title">{next.title}</span>
                            <span className="mix-track-meta">
                                {next.artist} · {next.bpm} BPM · {next.key} · ENR {next.energy}
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
                    {next && current && (
                        <button
                            onClick={syncBtoA}
                            title="Deck B auf Deck-A-BPM und -Phase synchronisieren"
                            style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.45)", borderRadius: "4px", color: "#34d399", padding: "2px 8px", cursor: "pointer", fontSize: "12px", fontWeight: 700, letterSpacing: "0.03em" }}
                        >SYNC</button>
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

            {onSaveTransitionPointB && (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px", padding: "4px 8px", background: "rgba(15,23,42,0.6)", opacity: next ? 1 : 0.35, pointerEvents: next ? "auto" : "none" }}>
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
                    <span style={{ color: "#1e2a3a", fontSize: "11px", margin: "0 2px" }}>│</span>
                    <button onClick={() => waveformRefB.current?.saveFirstBeat()}
                        style={{ background: "#1a2a1a", border: "1px solid #ff5050", borderRadius: "4px", color: "#ff5050", padding: "3px 8px", fontSize: "11px", cursor: "pointer", fontWeight: 600 }}>
                        ▼1
                    </button>
                    <button onClick={() => waveformRefB.current?.setVocalStart()}
                        style={{ background: "#001a22", border: "1px solid #00dcff", borderRadius: "4px", color: "#00dcff", padding: "3px 8px", fontSize: "11px", cursor: "pointer", fontWeight: 600 }}>
                        VS
                    </button>
                    <button onClick={() => waveformRefB.current?.jumpToVocalEnd()}
                        style={{ background: "#1a1000", border: "1px solid #ff9600", borderRadius: "4px", color: "#ff9600", padding: "3px 8px", fontSize: "11px", cursor: "pointer", fontWeight: 600 }}>
                        ⏭VE
                    </button>
                    <button onClick={() => waveformRefB.current?.setVocalEnd()}
                        style={{ background: "#1a1000", border: "1px solid #ff9600", borderRadius: "4px", color: "#ff9600", padding: "3px 8px", fontSize: "11px", cursor: "pointer", fontWeight: 600 }}>
                        VE
                    </button>
                    <span style={{ color: "#1e2a3a", fontSize: "11px", margin: "0 2px" }}>│</span>
                    <button onClick={() => waveformRefB.current?.prevMarker()}
                        style={{ background: "#151525", border: "1px solid #6688cc", borderRadius: "4px", color: "#6688cc", padding: "3px 8px", fontSize: "11px", cursor: "pointer", fontWeight: 600 }}>
                        ◀
                    </button>
                    <button onClick={() => waveformRefB.current?.nextMarker()}
                        style={{ background: "#151525", border: "1px solid #6688cc", borderRadius: "4px", color: "#6688cc", padding: "3px 8px", fontSize: "11px", cursor: "pointer", fontWeight: 600 }}>
                        ▶
                    </button>
                </div>
            )}

            {onRemoveTransitionPointB && (next?.transitionPoints ?? []).length > 0 && (
                <div style={{ background: "rgba(15,23,42,0.6)" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", padding: "2px 8px 4px" }}>
                        <span style={{ fontSize: "10px", color: "#475569", alignSelf: "center", marginRight: "2px" }}>Gesetzt:</span>
                        {(next?.transitionPoints ?? []).map(p => {
                            const c = ROLE_COLORS[p.role];
                            const isEditing = editState?.pointId === p.id && editState.deck === "B";
                            return (
                                <span
                                    key={p.id}
                                    style={{ display: "inline-flex", alignItems: "center", gap: "3px", background: c.bg, border: `1px solid ${isEditing ? c.text : c.border}`, borderRadius: "4px", padding: "1px 5px", fontSize: "10px", color: c.text }}
                                >
                                    <span
                                        onClick={() => isEditing ? closeEdit() : openEdit(p, "B")}
                                        style={{ cursor: "pointer" }}
                                        title="Einstellungen bearbeiten"
                                    >
                                        {p.label ?? p.role} @ {formatTime(p.timeSeconds)}{p.settings && p.settings.fade !== "none" || p.settings?.eq !== "none" || p.settings?.effect !== "none" ? " ✎" : ""}
                                    </span>
                                    <button
                                        onClick={() => onRemoveTransitionPointB(p.id)}
                                        style={{ background: "none", border: "none", cursor: "pointer", color: c.text, padding: "0 0 0 2px", fontSize: "10px", lineHeight: 1 }}
                                        title="Entfernen"
                                    >×</button>
                                </span>
                            );
                        })}
                    </div>
                    {editState?.deck === "B" && renderEditPanel(next?.transitionPoints ?? [], onUpdateTransitionPointB)}
                </div>
            )}

            <div className="mix-waveform-wrap mix-waveform-wrap-next">
                {next && nxtDur > 0 ? (
                    <CdjWaveform
                        ref={waveformRefB}
                        key={next.id}
                        trackId={next.id}
                        filePath={next.url}
                        waveform={waveB}
                        waveformPeaks={next.analysis?.waveformPeaks ?? nextWaveformPeaksOverride ?? undefined}
                        duration={nxtDur}
                        currentTime={nxtTime}
                        onSeek={onDeckBSeek ?? (() => {})}
                        bpm={next.analysis?.detectedBpm ?? next.bpm}
                        beatGridStartSeconds={next.analysis?.beatGridStartSeconds ?? nextGridStartOverride ?? undefined}
                        beats={next.analysis?.beats ?? nextBeatsOverride ?? undefined}
                        metroBeat={metroBeatB}
                        phaseOffset={testOffsetB}
                        isPlaying={nxtPlaying}
                    />
                ) : (
                    <div className="mix-waveform-empty">Kein Track bereit</div>
                )}
            </div>

            {/* Deck-B-Phase-Panel disabled (Superpowered migration) */}
            {false && next && (next!.analysis?.beatGridStartSeconds !== undefined || nextGridStartOverride !== null) && (
                <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "2px 16px 4px", background: "rgba(10,16,30,0.8)" }}>
                    <span style={{ fontSize: "10px", color: "#475569" }}>Deck-B-Phase:</span>
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
                        >Zurück</button>
                    )}
                    {next!.url && (next!.analysis?.detectedBpm ?? next!.bpm) && (
                        <button
                            onClick={async () => {
                                const url = next!.url!;
                                const bpm = next!.analysis?.detectedBpm ?? next!.bpm ?? 0;
                                const rawGridStart = next!.analysis?.beatGridStartSeconds ?? nextGridStartOverride;
                                if (!bpm || rawGridStart === undefined || rawGridStart === null) return;
                                const beatInterval = 60 / bpm;
                                // Nächsten Grid-Beat zur aktuellen Deck-B-Position finden
                                const k = Math.round((nxtTime - rawGridStart) / beatInterval);
                                const shift = ((k % 4) + 4) % 4;
                                const newGridStart = rawGridStart + shift * beatInterval;
                                const cached = await loadAnalysisCache(url);
                                if (!cached) return;
                                await saveAnalysisCache(url, { ...cached, beatGridStartSeconds: newGridStart });
                                setNextGridStartOverride(newGridStart);
                                setTestOffsetB(0);
                            }}
                            title="Deck-B-Position als '1' setzen und speichern (.tkdj)"
                            style={{ marginLeft: "4px", background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.4)", borderRadius: "3px", color: "#818cf8", fontSize: "10px", padding: "1px 7px", cursor: "pointer", lineHeight: 1.5 }}
                        >1↓</button>
                    )}
                </div>
            )}
        </div>
    );
}
