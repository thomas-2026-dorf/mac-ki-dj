import { useEffect, useRef, useState } from "react";

const HEIGHT = 80;
const ZOOM_LEVELS = [1, 2, 4, 8] as const;
// Sichtbares Zeitfenster bei Zoom 1× (Sekunden links + rechts des Cursors)
const BASE_WINDOW_SEC = 20;

type Props = {
    trackId: string;
    waveform: number[];
    duration: number;
    currentTime: number;
    onSeek: (time: number) => void;
    bpm?: number;
    beatGridStartSeconds?: number;
    beats?: number[];
    metroBeat?: { n: number; t: number } | null;
    /** Kontrollierter Phase-Offset von außen (z.B. MixPlayer-Testpanel).
     *  Wenn gesetzt, werden die internen Buttons ausgeblendet. */
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
    trackId, waveform, duration, currentTime, onSeek,
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
    // Wenn externer Offset gesetzt: diesen verwenden, sonst internen
    const phaseOffset = externalPhaseOffset !== undefined ? externalPhaseOffset : internalPhaseOffset;

    // Drag-Scrub: Anchor-Position beim MouseDown merken
    const dragRef = useRef<{ startX: number; startTime: number; windowSec: number } | null>(null);
    // Optimistisches Seek-Time während Drag — sofort sichtbar, ohne auf Engine zu warten
    const [dragTime, setDragTime] = useState<number | null>(null);

    // Zoom + Phase zurücksetzen wenn neuer Track geladen wird
    useEffect(() => {
        setZoomLevel(1);
        setDragTime(null);
        setInternalPhaseOffset(0);
    }, [trackId]);

    // Canvas-Breite per ResizeObserver tracken
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const ro = new ResizeObserver(() => setCanvasW(container.clientWidth));
        ro.observe(container);
        setCanvasW(container.clientWidth);
        return () => ro.disconnect();
    }, []);

    const windowSec = BASE_WINDOW_SEC / zoomLevel;
    // Während Drag: sofortige visuelle Reaktion ohne auf Engine-Update zu warten
    const centerTime = dragTime ?? currentTime;
    const visibleStart = centerTime - windowSec / 2;

    // Canvas neu zeichnen bei jeder Änderung
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || canvasW === 0) return;
        canvas.width = canvasW;
        canvas.height = HEIGHT;

        console.log("[WaveformDebug]", {
            alignedVocalRegions: alignedVocalRegions?.length,
            vocalMixZones: vocalMixZones?.length,
        });

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const W = canvasW;
        const H = HEIGHT;

        // Hintergrund
        ctx.fillStyle = "#04090f";
        ctx.fillRect(0, 0, W, H);

        // Beat Inspector: 3 Zeilen — BEATS / GRID / METRO
        const rowH = H / 3;
        const LABEL_W = 48;
        const toX = (t: number) => ((t - visibleStart) / windowSec) * W;

        // Zeilen-Hintergründe
        ctx.fillStyle = "#060e18"; ctx.fillRect(0, 0,          W, rowH);
        ctx.fillStyle = "#04090f"; ctx.fillRect(0, rowH,       W, rowH);
        ctx.fillStyle = "#060e12"; ctx.fillRect(0, rowH * 2,   W, rowH);

        // Zeilen-Trenner
        ctx.strokeStyle = "rgba(255,255,255,0.12)";
        ctx.lineWidth = 1;
        for (let i = 1; i < 3; i++) {
            const ly = Math.round(i * rowH) + 0.5;
            ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(W, ly); ctx.stroke();
        }

        const drawZone = (start: number | undefined, end: number | undefined, color: string) => {
            if (start === undefined || end === undefined) return;
            const x0 = Math.max(0, toX(start));
            const x1 = Math.min(W, toX(end));
            if (x1 <= x0) return;
            ctx.fillStyle = color;
            ctx.fillRect(x0, 0, x1 - x0, H);
        };

        // Vocal-Regionen (gelb)
        if (alignedVocalRegions) {
            for (const region of alignedVocalRegions) {
                drawZone(region.startSeconds, region.endSeconds, "rgba(255,210,0,0.22)");
            }
        }

        // Mix-In / Mix-Out aus Vocal-Analyse (blau / rot)
        if (vocalMixZones) {
            for (const zone of vocalMixZones) {
                drawZone(zone.startSeconds, zone.endSeconds,
                    zone.type === "mix-in" ? "rgba(0,120,255,0.28)" : "rgba(255,60,60,0.28)");
            }
        }


        // Label-Blöcke links
        ctx.font = "bold 9px monospace";
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        ctx.fillStyle = "rgba(56,189,248,0.18)";  ctx.fillRect(0, 0,        LABEL_W, rowH);
        ctx.fillStyle = "#38bdf8";                 ctx.fillText("BEATS", 3, rowH * 0.5);
        ctx.fillStyle = "rgba(255,255,255,0.08)";  ctx.fillRect(0, rowH,     LABEL_W, rowH);
        ctx.fillStyle = "rgba(255,255,255,0.65)";  ctx.fillText("GRID",  3, rowH * 1.5);
        ctx.fillStyle = "rgba(74,222,128,0.15)";   ctx.fillRect(0, rowH * 2, LABEL_W, rowH);
        ctx.fillStyle = "#4ade80";                  ctx.fillText("METRO", 3, rowH * 2.5);

        // Zeile 0 — BEATS: erkannte Rohbeats (Referenz, abgeschwächt)
        if (beats && beats.length > 0) {
            ctx.strokeStyle = "rgba(150,180,200,0.3)";
            ctx.lineWidth = 0.5;
            const vEnd0 = visibleStart + windowSec;
            for (const t of beats) {
                if (t < visibleStart - 0.01 || t > vEnd0 + 0.01) continue;
                const x = Math.round(toX(t)) + 0.5;
                ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x, rowH - 4); ctx.stroke();
            }
        }

        // Zeilen 1 + 2 — GRID und METRO
        if (bpm && bpm > 0 && beatGridStartSeconds !== undefined) {
            const beatInterval = 60 / bpm;
            const vEnd = visibleStart + windowSec;
            const nMin = Math.floor((visibleStart - beatGridStartSeconds) / beatInterval) - 1;
            const nMax = Math.ceil((vEnd - beatGridStartSeconds) / beatInterval) + 1;

            for (let n = nMin; n <= nMax; n++) {
                const t = beatGridStartSeconds + n * beatInterval;
                if (t < visibleStart - 0.01 || t > vEnd + 0.01) continue;
                const x = Math.round(toX(t)) + 0.5;
                const beatInBar = ((n + phaseOffset) % 4 + 4) % 4;
                const isDown = beatInBar === 0;

                // GRID-Zeile: Linie
                ctx.strokeStyle = isDown ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.40)";
                ctx.lineWidth = isDown ? 2.5 : 1;
                ctx.beginPath(); ctx.moveTo(x, rowH + 4); ctx.lineTo(x, rowH * 2 - 4); ctx.stroke();

                // Beat-Zahl 1/2/3/4 — Beat 1 gold+groß, 2/3/4 weiß
                if (isDown) {
                    ctx.fillStyle = "rgba(251,191,36,0.30)";
                    ctx.fillRect(x - 7, rowH + 1, 14, 13);
                    ctx.font = "bold 11px monospace";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "top";
                    ctx.fillStyle = "#fbbf24";
                    ctx.fillText("1", x, rowH + 2);
                } else {
                    ctx.font = "bold 9px monospace";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "top";
                    ctx.fillStyle = "rgba(255,255,255,0.60)";
                    ctx.fillText(String(beatInBar + 1), x, rowH + 2);
                }

                // METRO-Zeile: Beat 1 grün+groß, 2/3/4 weiß+klein
                if (isDown) {
                    ctx.strokeStyle = "#4ade80";
                    ctx.lineWidth = 2.5;
                    ctx.beginPath(); ctx.moveTo(x, rowH * 2 + 3); ctx.lineTo(x, H - 3); ctx.stroke();
                } else {
                    ctx.strokeStyle = "rgba(255,255,255,0.22)";
                    ctx.lineWidth = 1;
                    const mid = rowH * 2.5;
                    ctx.beginPath(); ctx.moveTo(x, mid - 5); ctx.lineTo(x, mid + 5); ctx.stroke();
                }
            }
        }

        // Metronom-Flash in METRO-Zeile
        if (metroBeat && centerTime - metroBeat.t < 0.15) {
            const fade = 1 - (centerTime - metroBeat.t) / 0.15;
            const isDown = metroBeat.n % 4 === 0;
            const cx = Math.round(W / 2);
            ctx.fillStyle = isDown
                ? `rgba(74,222,128,${(0.9 * fade).toFixed(2)})`
                : `rgba(255,255,255,${(0.45 * fade).toFixed(2)})`;
            ctx.fillRect(cx - 5, rowH * 2, 10, rowH);
        }

        // Timing-Debug: Werte am Playhead
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

        // Fixe Mittellinie (Playhead-Cursor)
        const cx = Math.round(W / 2) + 0.5;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, H);
        ctx.stroke();

    }, [canvasW, centerTime, waveform, duration, visibleStart, windowSec, bpm, beatGridStartSeconds, beats, metroBeat, phaseOffset, mixInStartSeconds, mixInEndSeconds, mixOutStartSeconds, mixOutEndSeconds, activityRegions, preActivityBeatCount, alignedVocalRegions, vocalMixZones]);

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
        // Drag rechts → Zeit zurück, drag links → Zeit vor
        const deltaTime = -((e.clientX - startX) / rect.width) * ws;
        const newTime = Math.max(0, Math.min(duration, startTime + deltaTime));
        setDragTime(newTime);
        onSeek(newTime);
    }

    function handleMouseUp(e: React.MouseEvent) {
        const drag = dragRef.current;
        dragRef.current = null;
        setDragTime(null);
        if (!drag) return;
        // Klick (keine echte Drag-Bewegung) → direkt zu Klick-Position springen
        if (Math.abs(e.clientX - drag.startX) < 4) {
            onSeek(getSeekTime(e.clientX));
        }
    }

    function handleMouseLeave() {
        dragRef.current = null;
        setDragTime(null);
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

            {/* Downbeat-Phase-Buttons — nur wenn nicht von außen kontrolliert (Deck B) */}
            {externalPhaseOffset === undefined && bpm && bpm > 0 && beatGridStartSeconds !== undefined && (
                <div style={{
                    position: "absolute", bottom: 4, left: "50%", transform: "translateX(-50%)",
                    display: "flex", gap: "4px", alignItems: "center", zIndex: 10,
                }}>
                    <button
                        onClick={(e) => { e.stopPropagation(); setInternalPhaseOffset(o => (o - 1 + 4) % 4); }}
                        style={{ background: "rgba(10,20,35,0.85)", border: "1px solid #1e3a5a", borderRadius: "3px", color: "#94a3b8", fontSize: "10px", padding: "1px 7px", cursor: "pointer", lineHeight: 1.5 }}
                        title="Grid-Phase um 1 Beat zurück"
                    >Grid −1</button>
                    <span style={{ fontSize: "10px", color: phaseOffset === 0 ? "#475569" : "#fbbf24", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", background: "rgba(10,20,35,0.85)", padding: "1px 5px", borderRadius: "3px" }}>
                        {phaseOffset === 0 ? "Phase 0" : `+${phaseOffset} Beat${phaseOffset > 1 ? "s" : ""}`}
                    </span>
                    <button
                        onClick={(e) => { e.stopPropagation(); setInternalPhaseOffset(o => (o + 1) % 4); }}
                        style={{ background: "rgba(10,20,35,0.85)", border: "1px solid #1e3a5a", borderRadius: "3px", color: "#94a3b8", fontSize: "10px", padding: "1px 7px", cursor: "pointer", lineHeight: 1.5 }}
                        title="Grid-Phase um 1 Beat vor"
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

            {waveform.length === 0 && (
                <div style={{
                    position: "absolute", inset: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#334155", fontSize: "12px", pointerEvents: "none",
                    border: "1px dashed #1e3a5a", borderRadius: "4px",
                }}>
                    Keine Waveform-Daten — Track analysieren
                </div>
            )}
        </div>
    );
}
