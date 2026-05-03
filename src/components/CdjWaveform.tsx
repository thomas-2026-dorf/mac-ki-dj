import { invoke } from "@tauri-apps/api/core";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { WaveformPeaks } from "../modules/analysis/waveformPeaks";
import { detectVocalRegion } from "../modules/analysis/vocalAnalyzer";

const HEIGHT = 72;
const VISIBLE_SECONDS = 4;
const DEFAULT_VOCAL_DURATION = 120; // 2 Minuten Auto-Schätzung

type Props = {
    trackId: string;
    filePath?: string;
    waveform: number[];
    waveformPeaks?: WaveformPeaks;
    duration: number;
    currentTime: number;
    onSeek: (time: number) => void;
    bpm?: number;
    beatGridStartSeconds?: number;
    beats?: number[];
    metroBeat?: { n: number; t: number } | null;
    phaseOffset?: number;
    mixInStartSeconds?: number;
    mixInEndSeconds?: number;
    mixOutStartSeconds?: number;
    mixOutEndSeconds?: number;
    activityRegions?: { startSeconds: number; endSeconds: number; confidence: number }[];
    preActivityBeatCount?: number;
    alignedVocalRegions?: { startSeconds: number; endSeconds: number }[];
    vocalMixZones?: { type: "mix-in" | "mix-out"; startSeconds: number; endSeconds: number }[];
    isPlaying?: boolean;
};

function getCachePath(filePath: string, suffix: string): string {
    const parts = filePath.split("/");
    const fileName = parts.pop() ?? "track";
    const dir = parts.join("/");
    const baseName = fileName.replace(/\.[^/.]+$/, "");
    return `${dir}/.tkdj/${baseName}.${suffix}`;
}

// Beat-Farben: 1=rot, 2/3/4=weiß
const BEAT_COLORS = [
    { line: "rgba(255,50,50,0.95)",  text: "rgba(255,80,80,1)",    width: 2 },
    { line: "rgba(255,255,255,0.6)", text: "rgba(255,255,255,0.9)", width: 1 },
    { line: "rgba(255,255,255,0.6)", text: "rgba(255,255,255,0.9)", width: 1 },
    { line: "rgba(255,255,255,0.6)", text: "rgba(255,255,255,0.9)", width: 1 },
];


export type CdjWaveformHandle = {
    saveFirstBeat(): void;
    setVocalStart(): void;
    setVocalEnd(): void;
    jumpToVocalEnd(): void;
    prevMarker(): void;
    nextMarker(): void;
};

const CdjWaveform = forwardRef<CdjWaveformHandle, Props>(function CdjWaveform({
    filePath,
    currentTime,
    duration,
    bpm,
    beatGridStartSeconds,
    phaseOffset,
    onSeek,
    isPlaying,
}: Props, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const peaksRef        = useRef<number[]>([]);
    const currentTimeRef  = useRef(currentTime);
    const durationRef     = useRef(duration);
    const bpmRef          = useRef(bpm);
    const beatGridRef     = useRef(beatGridStartSeconds);
    const phaseRef        = useRef(phaseOffset ?? 0);
    const isPlayingRef    = useRef(isPlaying ?? false);

    const lastPropRef = useRef<{ time: number; at: number }>({ time: currentTime, at: performance.now() });
    if (lastPropRef.current.time !== currentTime) {
        lastPropRef.current = { time: currentTime, at: performance.now() };
    }

    // ── Beat "1" ──────────────────────────────────────────────────────────
    const firstBeatRef = useRef<number | null>(null);

    // ── Vocal Markers ─────────────────────────────────────────────────────
    const vocalStartRef = useRef<number | null>(null);
    const vocalEndRef   = useRef<number | null>(null);

    currentTimeRef.current  = currentTime;
    durationRef.current     = duration;
    bpmRef.current          = bpm;
    beatGridRef.current     = beatGridStartSeconds;
    phaseRef.current        = phaseOffset ?? 0;
    isPlayingRef.current    = isPlaying ?? false;

    // ── Laden wenn Track wechselt ─────────────────────────────────────────
    useEffect(() => {
        peaksRef.current    = [];
        firstBeatRef.current = null;
        vocalStartRef.current = null;
        vocalEndRef.current   = null;
        if (!filePath) return;

        invoke<number[]>("superpowered_generate_waveform", { path: filePath })
            .then(p => { peaksRef.current = p; })
            .catch(e => console.error("Waveform laden fehlgeschlagen:", e));

        // First-Beat laden
        const fbPath = getCachePath(filePath, "firstbeat.json");
        invoke<boolean>("tkdj_file_exists", { path: fbPath }).then(exists => {
            if (!exists) return;
            invoke<string>("tkdj_read_text_file", { path: fbPath }).then(raw => {
                const d = JSON.parse(raw) as { firstBeatSeconds: number };
                firstBeatRef.current = d.firstBeatSeconds;
            });
        }).catch(() => {});

        // Vocal-Marker laden
        const vpPath = getCachePath(filePath, "vocal.json");
        invoke<boolean>("tkdj_file_exists", { path: vpPath }).then(exists => {
            if (!exists) return;
            invoke<string>("tkdj_read_text_file", { path: vpPath }).then(raw => {
                const d = JSON.parse(raw) as { vocalStartSeconds: number; vocalEndSeconds: number };
                vocalStartRef.current = d.vocalStartSeconds;
                vocalEndRef.current   = d.vocalEndSeconds;
            });
        }).catch(() => {});
    }, [filePath]);

    // ── RAF-Loop ──────────────────────────────────────────────────────────
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const dpr = window.devicePixelRatio || 1;
        let rafId = 0;

        const setSize = () => {
            const w = canvas.parentElement?.clientWidth || 800;
            canvas.width  = Math.round(w * dpr);
            canvas.height = Math.round(HEIGHT * dpr);
        };
        setSize();
        const ro = new ResizeObserver(setSize);
        if (canvas.parentElement) ro.observe(canvas.parentElement);

        const draw = () => {
            rafId = requestAnimationFrame(draw);
            const ctx = canvas.getContext("2d");
            if (!ctx) return;

            ctx.imageSmoothingEnabled = false;
            const w  = canvas.width / dpr;
            const h  = canvas.height / dpr;
            const mid = Math.round(h / 2);
            const cx  = Math.round(w / 2);

            ctx.save();
            ctx.scale(dpr, dpr);
            ctx.clearRect(0, 0, w, h);

            const { time: propTime, at: propAt } = lastPropRef.current;
            const elapsed = isPlayingRef.current ? (performance.now() - propAt) / 1000 : 0;
            const ct  = Math.min(propTime + elapsed, Math.max(durationRef.current, 1));
            const dur = Math.max(durationRef.current, 1);
            const pxPerSec = w / VISIBLE_SECONDS;

            // ── Vocal-Zone (Hintergrund-Highlight) ────────────────────────
            const vs = vocalStartRef.current;
            const ve = vocalEndRef.current;
            if (vs !== null && ve !== null) {
                const x0 = Math.round(cx + (vs - ct) * pxPerSec);
                const x1 = Math.round(cx + (ve - ct) * pxPerSec);
                const xL = Math.max(0, Math.min(x0, x1));
                const xR = Math.min(w, Math.max(x0, x1));
                if (xR > xL) {
                    ctx.fillStyle = "rgba(0,180,220,0.08)";
                    ctx.fillRect(xL, 0, xR - xL, h);
                }
            }

            // ── Waveform ──────────────────────────────────────────────────
            const peaks = peaksRef.current;
            if (peaks.length > 0) {
                const pps = peaks.length / dur;
                const centerPeak = ct * pps;
                const halfPeaks  = (VISIBLE_SECONDS / 2) * pps;
                ctx.fillStyle = "#00e87a";
                for (let x = 0; x < Math.round(w); x++) {
                    const idx = Math.round(centerPeak - halfPeaks + (x / w) * VISIBLE_SECONDS * pps);
                    if (idx < 0 || idx >= peaks.length) continue;
                    // Waveform auf innere Zone begrenzen: 20px oben + 20px unten frei
                const barH = Math.round((peaks[idx] || 0) * (mid - 20) * 0.95);
                    if (barH < 1) continue;
                    ctx.fillRect(x, mid - barH, 1, barH * 2);
                }
            }

            // ── Beat-Grid + Vocal-Counter ─────────────────────────────────
            const bpm_ = bpmRef.current;
            const gridStart = firstBeatRef.current ?? beatGridRef.current ?? null;
            if (bpm_ && bpm_ > 0 && gridStart !== null) {
                const beatSec  = 60 / bpm_;
                const phase    = phaseRef.current;
                const vocalSt  = vocalStartRef.current;
                const nFirst   = Math.ceil((ct - VISIBLE_SECONDS / 2 - gridStart) / beatSec);
                const nLast    = Math.floor((ct + VISIBLE_SECONDS / 2 - gridStart) / beatSec);

                for (let n = nFirst; n <= nLast; n++) {
                    const beatTime = gridStart + n * beatSec;
                    const x = Math.round(cx + (beatTime - ct) * pxPerSec);
                    if (x < 0 || x > w) continue;

                    // Beat-Linie + 1/2/3/4 Label (original Position)
                    const style = BEAT_COLORS[((n - phase) % 4 + 4) % 4];
                    ctx.strokeStyle = style.line;
                    ctx.lineWidth   = style.width;
                    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
                    ctx.fillStyle = style.text;
                    ctx.font = style.width === 2 ? "bold 12px monospace" : "11px monospace";
                    ctx.fillText(String(((n - phase) % 4 + 4) % 4 + 1), x + 3, 14);

                    // Vocal-Counter unten (außerhalb Waveform-Zone)
                    if (vocalSt !== null && beatTime >= vocalSt - beatSec * 0.5) {
                        const vocalBeat = Math.round((beatTime - vocalSt) / beatSec) + 1;
                        if (vocalBeat >= 1) {
                            ctx.fillStyle = "rgba(255,210,50,1)";
                            ctx.font = "bold 10px monospace";
                            ctx.fillText(String(vocalBeat), x + 2, h - 6);
                        }
                    }
                }
            }

            // ── Vocal Start Marker (Cyan) ─────────────────────────────────
            if (vs !== null) {
                const x = Math.round(cx + (vs - ct) * pxPerSec);
                ctx.strokeStyle = "rgba(0,220,255,0.95)";
                ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
                ctx.fillStyle = "rgba(0,220,255,1)";
                ctx.font = "bold 11px monospace";
                ctx.fillText("VS", x + 3, h - 16);
            }

            // ── Vocal End Marker (Orange) ─────────────────────────────────
            if (ve !== null) {
                const x = Math.round(cx + (ve - ct) * pxPerSec);
                ctx.strokeStyle = "rgba(255,150,0,0.95)";
                ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
                ctx.fillStyle = "rgba(255,150,0,1)";
                ctx.font = "bold 11px monospace";
                ctx.fillText("VE", x + 3, h - 16);
            }

            // ── Playhead ──────────────────────────────────────────────────
            ctx.strokeStyle = "#ff3333";
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();

            ctx.restore();
        };

        rafId = requestAnimationFrame(draw);
        return () => { cancelAnimationFrame(rafId); ro.disconnect(); };
    }, [filePath]);

    // ── Early return wenn kein Track ──────────────────────────────────────
    if (!filePath) {
        return (
            <div style={{ width: "100%", height: `${HEIGHT}px`, background: "#04090f",
                border: "1px dashed #1e3a5a", display: "flex", alignItems: "center",
                justifyContent: "center", color: "#334155", fontSize: "12px" }}>
                Kein Track geladen
            </div>
        );
    }

    // ── Drag-to-seek ──────────────────────────────────────────────────────
    function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        e.preventDefault();
        const startX    = e.clientX;
        const startTime = currentTimeRef.current;
        const secPerPx  = VISIBLE_SECONDS / canvas.getBoundingClientRect().width;
        canvas.style.cursor = "grabbing";
        const onMove = (ev: MouseEvent) => {
            onSeek(Math.max(0, Math.min(startTime - (ev.clientX - startX) * secPerPx, durationRef.current)));
        };
        const onUp = () => {
            canvas.style.cursor = "grab";
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    }

    // ── Speichern-Helfer ──────────────────────────────────────────────────
    function saveFirstBeat() {
        const t = currentTimeRef.current;
        firstBeatRef.current = t;
        onSeek(t); // Playhead auf die "1" springen
        const path = getCachePath(filePath!, "firstbeat.json");
        invoke("tkdj_write_text_file", { path, content: JSON.stringify({ firstBeatSeconds: t }, null, 2) })
            .catch(console.error);
    }

    function saveVocal(start: number, end: number) {
        vocalStartRef.current = start;
        vocalEndRef.current   = end;
        const path = getCachePath(filePath!, "vocal.json");
        invoke("tkdj_write_text_file", {
            path,
            content: JSON.stringify({ vocalStartSeconds: start, vocalEndSeconds: end }, null, 2),
        }).catch(console.error);
    }

    function handleSetVocalStart() {
        const t = currentTimeRef.current;
        // Sofort mit 2-Min-Schätzung setzen
        const estimatedEnd = Math.min(t + DEFAULT_VOCAL_DURATION, durationRef.current);
        saveVocal(t, estimatedEnd);

        // Vocal-Erkennung im Hintergrund — korrigiert VE wenn fertig
        detectVocalRegion(filePath!)
            .then(region => {
                if (region) {
                    console.log("[CdjWaveform] Vocal-Region erkannt:", region);
                    saveVocal(t, region.endSeconds);
                } else {
                    console.log("[CdjWaveform] Kein Vocal erkannt, behalte 2-Min-Schätzung");
                }
            })
            .catch(e => console.warn("[CdjWaveform] Vocal-Analyse fehlgeschlagen:", e));
    }

    function handleSetVocalEnd() {
        const t   = currentTimeRef.current;
        const start = vocalStartRef.current ?? t;
        saveVocal(start, t);
    }

    function handleJumpToVocalEnd() {
        if (vocalEndRef.current !== null) onSeek(vocalEndRef.current);
    }

    // ── Marker-Navigation ─────────────────────────────────────────────────
    // Refs für Navigation – damit Click-Handler immer aktuelle Werte haben
    function getMarkersFromRefs() {
        const m: { label: string; time: number }[] = [];
        if (firstBeatRef.current  !== null) m.push({ label: "▼1", time: firstBeatRef.current });
        if (vocalStartRef.current !== null) m.push({ label: "VS", time: vocalStartRef.current });
        if (vocalEndRef.current   !== null) m.push({ label: "VE", time: vocalEndRef.current });
        return m.sort((a, b) => a.time - b.time);
    }

    function handlePrevMarker() {
        const t = currentTimeRef.current;
        const prev = [...getMarkersFromRefs()].reverse().find(m => m.time < t - 0.1);
        if (prev) onSeek(prev.time);
    }

    function handleNextMarker() {
        const t = currentTimeRef.current;
        const next = getMarkersFromRefs().find(m => m.time > t + 0.1);
        if (next) onSeek(next.time);
    }

    useImperativeHandle(ref, () => ({
        saveFirstBeat,
        setVocalStart: handleSetVocalStart,
        setVocalEnd: handleSetVocalEnd,
        jumpToVocalEnd: handleJumpToVocalEnd,
        prevMarker: handlePrevMarker,
        nextMarker: handleNextMarker,
    }));

    return (
        <div style={{ position: "relative", width: "100%" }}>
            <canvas
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                style={{ display: "block", width: "100%", height: `${HEIGHT}px`, background: "#111", cursor: "grab" }}
            />
        </div>
    );
});

export default CdjWaveform;
