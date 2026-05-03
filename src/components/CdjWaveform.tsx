import { useEffect, useRef, useState } from "react";
import type { WaveformPeaks } from "../modules/analysis/waveformPeaks";

const HEIGHT = 80;
const ZOOM_LEVELS = [1, 2, 4, 8] as const;
const BASE_WINDOW_SEC = 20;

type Props = {
    trackId: string;
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
};

export default function CdjWaveform({
    trackId, waveform, waveformPeaks, duration, currentTime, onSeek,
    bpm, beatGridStartSeconds, beats, metroBeat,
    phaseOffset: externalPhaseOffset,
    mixInStartSeconds, mixInEndSeconds, mixOutStartSeconds, mixOutEndSeconds,
    activityRegions, preActivityBeatCount,
    alignedVocalRegions, vocalMixZones,
}: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [zoomLevel, setZoomLevel] = useState(1);
    const [canvasW, setCanvasW] = useState(0);
    const [internalPhaseOffset, setInternalPhaseOffset] = useState(0);
    const phaseOffset = externalPhaseOffset !== undefined ? externalPhaseOffset : internalPhaseOffset;

    // Drag-Scrub: Anchor-Position beim MouseDown merken
    const dragRef = useRef<{ startX: number; startTime: number; windowSec: number } | null>(null);
    // Optimistisches Seek-Time während Drag
    const [dragTime, setDragTime] = useState<number | null>(null);
    // Lokaler View-Center (aktuell nur per Drag gesetzt, Wheel deaktiviert)
    const [viewCenterSec, setViewCenterSec] = useState<number | null>(null);

    // Zoom + Phase zurücksetzen wenn neuer Track geladen wird
    useEffect(() => {
        setZoomLevel(1);
        setDragTime(null);
        setViewCenterSec(null);
        setInternalPhaseOffset(0);
    }, [trackId]);

    // Debug: einmalig wenn waveformPeaks für einen Track verfügbar wird
    useEffect(() => {
        if (!waveformPeaks) return;
        console.log("[WaveformStartDebug]", {
            duration,
            beatGridStartSeconds,
            // firstBeatSeconds + gridOffset sind keine Props → können Waveform nicht verschieben
            rms0:      waveformPeaks.rms?.[0],
            rms10:     waveformPeaks.rms?.[10],
            rms100:    waveformPeaks.rms?.[100],
            maxRms:    waveformPeaks.maxRms,
            peakLength: waveformPeaks.length,
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [waveformPeaks]);

    // Canvas-Breite per ResizeObserver tracken
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const ro = new ResizeObserver(() => setCanvasW(container.clientWidth));
        ro.observe(container);
        setCanvasW(container.clientWidth);
        return () => ro.disconnect();
    }, []);

    // Canvas-Dimensionen nur setzen wenn canvasW sich ändert — setzt canvas.width zurück
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || canvasW === 0) return;
        canvas.width = canvasW;
        canvas.height = HEIGHT;
    }, [canvasW]);

    const windowSec = BASE_WINDOW_SEC / zoomLevel;
    // Priorität: aktiver Drag > manueller View-Scroll > Playback-Position
    const centerTime = dragTime ?? viewCenterSec ?? currentTime;
    // CDJ-Stil: visibleStart darf negativ sein — Waveform beginnt in der Mitte beim Songstart.
    // Zeiten < 0 werden beim Zeichnen übersprungen (leerer Bereich links vom Startpunkt).
    const visibleStart = centerTime - windowSec / 2;

    // Wheel-Scroll deaktiviert — war instabil beim Scrollen über den Playhead.
    // Navigation später über MiniWaveform-Klick.

    // Canvas neu zeichnen bei jeder Änderung
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || canvasW === 0) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const W = canvasW;
        const H = HEIGHT;

        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = "#04090f";
        ctx.fillRect(0, 0, W, H);

        // ── Alle Eingangswerte absichern ──────────────────────────────────────
        // Ungültige Werte (NaN, Infinity, 0) führen zu unsichtbaren oder
        // falsch platzierten Canvas-Zeichenoperationen.
        if (
            !Number.isFinite(duration)    || duration <= 0 ||
            !Number.isFinite(windowSec)   || windowSec <= 0 ||
            !Number.isFinite(centerTime)  ||
            !Number.isFinite(visibleStart)
        ) {
            const playheadX = Number.isFinite(centerTime) && Number.isFinite(visibleStart) && windowSec > 0
                ? ((centerTime - visibleStart) / windowSec) * W
                : null;
            console.log("[WaveformInvalid]", {
                visibleStart,
                visibleEnd:      visibleStart + windowSec,
                visibleDuration: windowSec,
                currentTime,
                centerTime,
                playheadX,
            });
            return;
        }

        const LABEL_W = 40;
        const timeToX = (t: number) => ((t - visibleStart) / windowSec) * W;
        const xToTime = (px: number) => visibleStart + (px / W) * windowSec;
        const halfH = (H - 8) / 2;
        const midY  = H / 2;
        const CLAMP = 0.9;
        const vEnd  = visibleStart + windowSec;

        // ── 1. Waveform als Hintergrund (volle Höhe) ─────────────────────────
        if (waveformPeaks && waveformPeaks.length > 0 && duration > 0) {
            const peakLength = waveformPeaks.length;
            const normFactor = 1 / (waveformPeaks.maxRms || 1);
            ctx.fillStyle = "rgba(56,189,248,0.55)";
            for (let px = LABEL_W; px < W; px++) {
                const tStart = xToTime(px);
                const tEnd   = xToTime(px + 1);
                if (tEnd < 0 || tStart >= duration) continue;
                const i0 = Math.max(0,      Math.min(peakLength - 1, Math.floor((tStart / duration) * peakLength)));
                const i1 = Math.max(i0 + 1, Math.min(peakLength,     Math.ceil( (tEnd   / duration) * peakLength)));
                let rmsVal = 0, hasData = false;
                for (let i = i0; i < i1; i++) {
                    const r = waveformPeaks.rms[i];
                    if (r === undefined) continue;
                    if (r > rmsVal) rmsVal = r;
                    hasData = true;
                }
                if (!hasData) continue;
                const normalized = Math.min(1, rmsVal * normFactor);
                const displayH = Math.sqrt(normalized) * halfH;
                if (displayH < 0.5) continue;
                const y0 = Math.round(midY - displayH);
                const y1 = Math.round(midY + displayH);
                ctx.fillRect(px, y0, 1, Math.max(1, y1 - y0));
            }
        } else if (waveform.length > 0 && duration > 0) {
            const waveLength = waveform.length;
            ctx.fillStyle = "rgba(56,189,248,0.30)";
            for (let px = LABEL_W; px < W; px++) {
                const tStart = xToTime(px);
                const tEnd   = xToTime(px + 1);
                if (tEnd < 0 || tStart >= duration) continue;
                const i0 = Math.max(0,            Math.min(waveLength - 1, Math.floor((tStart / duration) * waveLength)));
                const i1 = Math.max(i0 + 1,       Math.min(waveLength,     Math.ceil( (tEnd   / duration) * waveLength)));
                let peak = 0, hasData = false;
                for (let i = i0; i < i1; i++) {
                    const a = Math.abs(waveform[i]);
                    if (isNaN(a)) continue;
                    if (a > peak) peak = a;
                    hasData = true;
                }
                if (!hasData) continue;
                peak = Math.min(peak, CLAMP);
                ctx.fillRect(px, Math.round(midY - peak * halfH), 1, Math.max(1, Math.round(peak * halfH * 2)));
            }
        }

        // ── 2. Metronom-Flash ─────────────────────────────────────────────────
        if (metroBeat && centerTime - metroBeat.t < 0.15) {
            const fade = 1 - (centerTime - metroBeat.t) / 0.15;
            const isDown = metroBeat.n % 4 === 0;
            ctx.fillStyle = isDown
                ? `rgba(74,222,128,${(0.13 * fade).toFixed(2)})`
                : `rgba(255,255,255,${(0.05 * fade).toFixed(2)})`;
            ctx.fillRect(LABEL_W, 0, W - LABEL_W, H);
        }

        // ── 3. Rohbeats ───────────────────────────────────────────────────────
        if (beats && beats.length > 0) {
            ctx.strokeStyle = "rgba(150,200,230,0.35)";
            ctx.lineWidth = 0.5;
            for (const t of beats) {
                if (t < visibleStart - 0.01 || t > vEnd + 0.01) continue;
                const x = Math.round(timeToX(t)) + 0.5;
                ctx.beginPath(); ctx.moveTo(x, 2); ctx.lineTo(x, H - 2); ctx.stroke();
            }
        }

        // ── 4. Beat-Grid ──────────────────────────────────────────────────────
        if (bpm && bpm > 0 && beatGridStartSeconds !== undefined) {
            const beatInterval = 60 / bpm;
            const nMin = Math.floor((visibleStart - beatGridStartSeconds) / beatInterval) - 1;
            const nMax = Math.ceil((vEnd - beatGridStartSeconds) / beatInterval) + 1;

            for (let n = nMin; n <= nMax; n++) {
                const t = beatGridStartSeconds + n * beatInterval;
                if (t < visibleStart - 0.01 || t > vEnd + 0.01) continue;
                const x = Math.round(timeToX(t)) + 0.5;
                const beatInBar = ((n + phaseOffset) % 4 + 4) % 4;
                const isDown = beatInBar === 0;

                if (isDown) {
                    ctx.fillStyle = "rgba(251,191,36,0.10)";
                    ctx.fillRect(x - 1, 0, 3, H);
                    ctx.strokeStyle = "rgba(251,191,36,0.90)";
                    ctx.lineWidth = 2;
                    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
                    ctx.font = "bold 11px monospace";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "top";
                    ctx.fillStyle = "#fbbf24";
                    ctx.fillText("1", x, 3);
                } else {
                    ctx.strokeStyle = "rgba(255,255,255,0.45)";
                    ctx.lineWidth = 1;
                    ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x, H - 4); ctx.stroke();
                    ctx.font = "bold 9px monospace";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "top";
                    ctx.fillStyle = "rgba(255,255,255,0.55)";
                    ctx.fillText(String(beatInBar + 1), x, 4);
                }
            }
        }

        // ── 5. Labels links ───────────────────────────────────────────────────
        ctx.fillStyle = "rgba(4,9,15,0.65)";
        ctx.fillRect(0, 0, LABEL_W - 1, H);
        ctx.font = "bold 8px monospace";
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        ctx.fillStyle = "#38bdf8";                  ctx.fillText("BEATS", 3, H * 0.22);
        ctx.fillStyle = "rgba(255,255,255,0.55)";   ctx.fillText("GRID",  3, H * 0.50);
        ctx.fillStyle = "#4ade80";                   ctx.fillText("METRO", 3, H * 0.78);

        // ── 6. Timing-Debug ───────────────────────────────────────────────────
        if (bpm && bpm > 0 && beatGridStartSeconds !== undefined) {
            const iv = 60 / bpm;
            const steps = Math.ceil((centerTime - beatGridStartSeconds) / iv + 1e-6);
            const nextGrid = beatGridStartSeconds + steps * iv;
            const gridInMs = (nextGrid - centerTime) * 1000;

            const nearestBeat = beats && beats.length > 0
                ? beats.reduce((best, b) => Math.abs(b - nextGrid) < Math.abs(best - nextGrid) ? b : best)
                : null;
            const offsetMs = nearestBeat != null ? (nearestBeat - nextGrid) * 1000 : null;

            const fm = (v: number | null, unit = "ms") =>
                v != null ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}${unit}` : "–";

            const line1 = `t=${centerTime.toFixed(3)}s  |  nGrid=${nextGrid.toFixed(3)}s (in ${fm(gridInMs)})  |  nearestBeat=${nearestBeat?.toFixed(3) ?? "–"}s`;
            const line2 = `offsetBeatGrid=${fm(offsetMs)}  |  grid=metro  |  BPM ${bpm.toFixed(2)}`;

            ctx.fillStyle = "rgba(0,0,0,0.72)";
            ctx.fillRect(0, H - 22, W, 22);
            ctx.font = "9px monospace";
            ctx.textAlign = "left";
            ctx.textBaseline = "top";
            ctx.fillStyle = "rgba(255,255,255,0.75)";
            ctx.fillText(line1, 4, H - 21);
            ctx.fillStyle = "rgba(255,255,255,0.5)";
            ctx.fillText(line2, 4, H - 11);
        }

        // ── 7. Playhead ───────────────────────────────────────────────────────
        // CDJ-Stil: Playhead steht immer fest in der Mitte, Waveform scrollt darunter.
        const cx = Math.round(W / 2) + 0.5;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, H);
        ctx.stroke();

    }, [canvasW, centerTime, waveform, waveformPeaks, duration, visibleStart, windowSec, bpm, beatGridStartSeconds, beats, metroBeat, phaseOffset, mixInStartSeconds, mixInEndSeconds, mixOutStartSeconds, mixOutEndSeconds, activityRegions, preActivityBeatCount, alignedVocalRegions, vocalMixZones]);

    // ── Maus-Interaktion ─────────────────────────────────────────────────────

    function getSeekTime(clientX: number): number {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return currentTime;
        const ratio = (clientX - rect.left) / rect.width;
        return Math.max(0, Math.min(duration, visibleStart + ratio * windowSec));
    }

    function handleMouseDown(e: React.MouseEvent) {
        dragRef.current = {
            startX: e.clientX,
            startTime: centerTime,
            windowSec,
        };
    }

    function handleMouseMove(e: React.MouseEvent) {
        if (!dragRef.current) return;
        const { startX, startTime, windowSec: ws } = dragRef.current;
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const deltaTime = -((e.clientX - startX) / rect.width) * ws;
        const newTime = Math.max(0, Math.min(duration, startTime + deltaTime));
        setDragTime(newTime);
        onSeek(newTime);
    }

    function handleMouseUp(e: React.MouseEvent) {
        const drag = dragRef.current;
        dragRef.current = null;
        setDragTime(null);
        setViewCenterSec(null);
        if (!drag) return;
        // Klick (keine echte Drag-Bewegung) → direkt zu Klick-Position springen
        if (Math.abs(e.clientX - drag.startX) < 4) {
            onSeek(getSeekTime(e.clientX));
        }
    }

    function handleMouseLeave() {
        // viewCenterSec nur bei aktivem Drag zurücksetzen — nicht beim Wheel-Scroll.
        // Ohne diese Unterscheidung springt die View zurück sobald der Cursor
        // beim Scrollen den Canvas-Rand streift.
        if (dragRef.current) {
            dragRef.current = null;
            setDragTime(null);
            setViewCenterSec(null);
        }
    }

    return (
        <div style={{ position: "relative", width: "100%" }}>
            <div
                ref={containerRef}
                style={{
                    width: "100%",
                    height: `${HEIGHT}px`,
                    background: "#04090f",
                    borderRadius: "4px",
                    border: "1px solid #0f2030",
                    cursor: "ew-resize",
                    userSelect: "none",
                }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
            >
                <canvas
                    ref={canvasRef}
                    style={{ display: "block", width: "100%", height: `${HEIGHT}px`, pointerEvents: "none" }}
                />
            </div>

            {/* Downbeat-Phase-Buttons */}
            {externalPhaseOffset === undefined && bpm && bpm > 0 && beatGridStartSeconds !== undefined && (
                <div style={{
                    position: "absolute", bottom: 4, left: "50%", transform: "translateX(-50%)",
                    display: "flex", gap: "4px", alignItems: "center", zIndex: 10,
                }}>
                    <button
                        onClick={(e) => { e.stopPropagation(); setInternalPhaseOffset(o => (o - 1 + 4) % 4); }}
                        style={{ background: "rgba(10,20,35,0.85)", border: "1px solid #1e3a5a", borderRadius: "3px", color: "#94a3b8", fontSize: "10px", padding: "1px 7px", cursor: "pointer", lineHeight: 1.5 }}
                        title="Grid 1 Beat zurück"
                    >Grid −1</button>
                    <span style={{ fontSize: "10px", color: phaseOffset === 0 ? "#475569" : "#fbbf24", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", background: "rgba(10,20,35,0.85)", padding: "1px 5px", borderRadius: "3px" }}>
                        {phaseOffset === 0 ? "Phase 0" : `+${phaseOffset} Beat${phaseOffset > 1 ? "s" : ""}`}
                    </span>
                    <button
                        onClick={(e) => { e.stopPropagation(); setInternalPhaseOffset(o => (o + 1) % 4); }}
                        style={{ background: "rgba(10,20,35,0.85)", border: "1px solid #1e3a5a", borderRadius: "3px", color: "#94a3b8", fontSize: "10px", padding: "1px 7px", cursor: "pointer", lineHeight: 1.5 }}
                        title="Grid 1 Beat vor"
                    >Grid +1</button>
                </div>
            )}

            {/* Zoom-Buttons */}
            <div style={{
                position: "absolute", top: 4, right: 6, zIndex: 10,
                display: "flex", gap: "3px",
            }}>
                {ZOOM_LEVELS.map(level => (
                    <button
                        key={level}
                        onClick={(e) => { e.stopPropagation(); setZoomLevel(level); }}
                        style={{
                            background: zoomLevel === level ? "#1e4a7a" : "rgba(10,20,35,0.85)",
                            border: `1px solid ${zoomLevel === level ? "#3b7dbf" : "#1e3a5a"}`,
                            borderRadius: "3px",
                            color: zoomLevel === level ? "#fff" : "#64748b",
                            fontSize: "10px",
                            padding: "1px 6px",
                            cursor: "pointer",
                            lineHeight: 1.5,
                            fontVariantNumeric: "tabular-nums",
                        }}
                    >
                        {level}×
                    </button>
                ))}
            </div>

            {waveform.length === 0 && !waveformPeaks && (
                <div style={{
                    position: "absolute", inset: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#334155", fontSize: "12px", pointerEvents: "none",
                    border: "1px dashed #1e3a5a", borderRadius: "4px",
                }}>
                    Keine Wellenform-Daten — Track analysieren
                </div>
            )}
        </div>
    );
}
