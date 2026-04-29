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
};

export default function CdjWaveform({
    trackId, waveform, duration, currentTime, onSeek,
    bpm, beatGridStartSeconds,
}: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [zoomLevel, setZoomLevel] = useState(1);
    const [canvasW, setCanvasW] = useState(0);

    // Drag-Scrub: Anchor-Position beim MouseDown merken
    const dragRef = useRef<{ startX: number; startTime: number; windowSec: number } | null>(null);
    // Optimistisches Seek-Time während Drag — sofort sichtbar, ohne auf Engine zu warten
    const [dragTime, setDragTime] = useState<number | null>(null);

    // Zoom zurücksetzen wenn neuer Track geladen wird
    useEffect(() => {
        setZoomLevel(1);
        setDragTime(null);
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

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const W = canvasW;
        const H = HEIGHT;

        // Hintergrund
        ctx.fillStyle = "#04090f";
        ctx.fillRect(0, 0, W, H);

        // Waveform-Balken
        if (waveform.length > 0) {
            let maxVal = 0.001;
            for (const v of waveform) if (v > maxVal) maxVal = v;

            const barW = 2;
            const gap = 1;
            const step = barW + gap;
            const numBars = Math.floor(W / step);

            for (let i = 0; i < numBars; i++) {
                const barTime = visibleStart + (i / numBars) * windowSec;

                let normalized = 0;
                if (barTime >= 0 && barTime <= duration) {
                    const idx = Math.min(
                        waveform.length - 1,
                        Math.floor((barTime / duration) * waveform.length),
                    );
                    normalized = waveform[idx] / maxVal;
                }

                const barH = Math.max(2, normalized * H);
                const y = (H - barH) / 2;
                const played = barTime < centerTime;

                if (played) {
                    ctx.fillStyle = normalized > 0.65 ? "#ff6b35"
                        : normalized > 0.30 ? "#e07800"
                        : "#6b3a10";
                } else {
                    ctx.fillStyle = normalized > 0.65 ? "#3b82f6"
                        : normalized > 0.30 ? "#1e4a7a"
                        : "#0d2040";
                }
                ctx.fillRect(i * step, y, barW, barH);
            }
        }

        // Beat-Grid-Linien + Beschriftung
        if (bpm && bpm > 0 && beatGridStartSeconds !== undefined) {
            const beatInterval = 60 / bpm;
            const vEnd = visibleStart + windowSec;
            const nMin = Math.floor((visibleStart - beatGridStartSeconds) / beatInterval) - 1;
            const nMax = Math.ceil((vEnd - beatGridStartSeconds) / beatInterval) + 1;

            ctx.lineWidth = 1;
            ctx.font = "bold 9px monospace";
            ctx.textAlign = "center";
            ctx.textBaseline = "top";

            for (let n = nMin; n <= nMax; n++) {
                const t = beatGridStartSeconds + n * beatInterval;
                if (t < visibleStart - 0.001 || t > vEnd + 0.001 || t < 0) continue;
                const x = Math.round(((t - visibleStart) / windowSec) * W) + 0.5;
                const beatInBar = ((n % 4) + 4) % 4; // 0 = Beat 1, 1 = Beat 2, ...
                const isDownbeat = beatInBar === 0;

                ctx.strokeStyle = isDownbeat
                    ? "rgba(255,255,255,0.70)"
                    : beatInBar === 2
                    ? "rgba(255,255,255,0.35)"
                    : "rgba(255,255,255,0.18)";

                ctx.beginPath();
                ctx.moveTo(x, isDownbeat ? 0 : H * 0.3);
                ctx.lineTo(x, isDownbeat ? H : H * 0.7);
                ctx.stroke();

                // Zahl über der Linie
                ctx.fillStyle = isDownbeat
                    ? "rgba(255,255,255,0.85)"
                    : "rgba(255,255,255,0.35)";
                ctx.fillText(String(beatInBar + 1), x, 2);
            }
        }

        // Fixe Mittellinie (Playhead-Cursor)
        const cx = Math.round(W / 2) + 0.5;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, H);
        ctx.stroke();

    }, [canvasW, centerTime, waveform, duration, visibleStart, windowSec, bpm, beatGridStartSeconds]);

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
