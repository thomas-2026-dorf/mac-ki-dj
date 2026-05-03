import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { WaveformPeaks } from "../modules/analysis/waveformPeaks";

const HEIGHT = 120;
const VISIBLE_SECONDS = 4;

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

function getFirstBeatPath(filePath: string): string {
    const parts = filePath.split("/");
    const fileName = parts.pop() ?? "track";
    const dir = parts.join("/");
    const baseName = fileName.replace(/\.[^/.]+$/, "");
    return `${dir}/.tkdj/${baseName}.firstbeat.json`;
}

// Beat-Farben: 1=rot, 2/3/4=weiß
const BEAT_COLORS = [
    { line: "rgba(255,50,50,0.95)",  text: "rgba(255,80,80,1)",    width: 2 }, // 1
    { line: "rgba(255,255,255,0.6)", text: "rgba(255,255,255,0.9)", width: 1 }, // 2
    { line: "rgba(255,255,255,0.6)", text: "rgba(255,255,255,0.9)", width: 1 }, // 3
    { line: "rgba(255,255,255,0.6)", text: "rgba(255,255,255,0.9)", width: 1 }, // 4
];

export default function CdjWaveform({
    filePath,
    currentTime,
    duration,
    bpm,
    beatGridStartSeconds,
    phaseOffset,
    onSeek,
    isPlaying,
}: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const peaksRef = useRef<number[]>([]);
    const currentTimeRef = useRef(currentTime);
    const durationRef = useRef(duration);
    const bpmRef = useRef(bpm);
    const beatGridRef = useRef(beatGridStartSeconds);
    const phaseRef = useRef(phaseOffset ?? 0);
    const isPlayingRef = useRef(isPlaying ?? false);

    // Smooth-Interpolation: prop kommt nur 20×/s vom MixEngine-Tick
    // RAF läuft 60fps → Echtzeit seit letztem Prop-Update addieren
    const lastPropRef = useRef<{ time: number; at: number }>({ time: currentTime, at: performance.now() });

    if (lastPropRef.current.time !== currentTime) {
        lastPropRef.current = { time: currentTime, at: performance.now() };
    }

    const [firstBeatOffset, setFirstBeatOffset] = useState<number | null>(null);
    const firstBeatOffsetRef = useRef<number | null>(null);
    const [saved, setSaved] = useState(false);

    currentTimeRef.current = currentTime;
    durationRef.current = duration;
    bpmRef.current = bpm;
    beatGridRef.current = beatGridStartSeconds;
    phaseRef.current = phaseOffset ?? 0;
    isPlayingRef.current = isPlaying ?? false;

    // Peaks + gespeicherten First-Beat laden wenn Track wechselt
    useEffect(() => {
        peaksRef.current = [];
        firstBeatOffsetRef.current = null;
        setFirstBeatOffset(null);
        setSaved(false);
        if (!filePath) return;

        invoke<number[]>("superpowered_generate_waveform", { path: filePath })
            .then(p => { peaksRef.current = p; })
            .catch(e => console.error("Waveform laden fehlgeschlagen:", e));

        const fbPath = getFirstBeatPath(filePath);
        invoke<boolean>("tkdj_file_exists", { path: fbPath })
            .then(exists => {
                if (!exists) return;
                return invoke<string>("tkdj_read_text_file", { path: fbPath })
                    .then(raw => {
                        const data = JSON.parse(raw) as { firstBeatSeconds: number };
                        firstBeatOffsetRef.current = data.firstBeatSeconds;
                        setFirstBeatOffset(data.firstBeatSeconds);
                        setSaved(true);
                    });
            })
            .catch(e => console.warn("First beat laden fehlgeschlagen:", e));
    }, [filePath]);

    // RAF-Loop: echter 60fps durch Zeitinterpolation
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const dpr = window.devicePixelRatio || 1;
        let rafId = 0;

        const setSize = () => {
            const w = canvas.parentElement?.clientWidth || 800;
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(HEIGHT * dpr);
        };
        setSize();

        const ro = new ResizeObserver(setSize);
        if (canvas.parentElement) ro.observe(canvas.parentElement);

        const draw = () => {
            rafId = requestAnimationFrame(draw);

            const peaks = peaksRef.current;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;

            ctx.imageSmoothingEnabled = false;

            const w = canvas.width / dpr;
            const h = canvas.height / dpr;
            const mid = Math.round(h / 2);
            const cx = Math.round(w / 2);

            ctx.save();
            ctx.scale(dpr, dpr);
            ctx.clearRect(0, 0, w, h);

            // Interpolierte Zeit für flüssige 60fps-Animation
            const { time: propTime, at: propAt } = lastPropRef.current;
            const elapsed = isPlayingRef.current ? (performance.now() - propAt) / 1000 : 0;
            const ct = Math.min(propTime + elapsed, Math.max(durationRef.current, 1));
            const dur = Math.max(durationRef.current, 1);

            // --- Waveform ---
            if (peaks.length > 0) {
                const pps = peaks.length / dur;
                const centerPeak = ct * pps;
                const halfPeaks = (VISIBLE_SECONDS / 2) * pps;

                ctx.fillStyle = "#00e87a";
                for (let x = 0; x < Math.round(w); x++) {
                    const idx = Math.round(centerPeak - halfPeaks + (x / w) * VISIBLE_SECONDS * pps);
                    if (idx < 0 || idx >= peaks.length) continue;
                    const amp = peaks[idx] || 0;
                    const barH = Math.round(amp * mid * 0.95);
                    if (barH < 1) continue;
                    ctx.fillRect(x, mid - barH, 1, barH * 2);
                }
            }

            // --- Beat-Grid: alle 4 Beats gleichwertig ---
            const bpm = bpmRef.current;
            const gridStart = firstBeatOffsetRef.current ?? beatGridRef.current ?? null;
            if (bpm && bpm > 0 && gridStart !== null) {
                const beatSec = 60 / bpm;
                const pxPerSec = w / VISIBLE_SECONDS;
                const tStart = ct - VISIBLE_SECONDS / 2;
                const tEnd = ct + VISIBLE_SECONDS / 2;
                const phase = phaseRef.current;

                const nFirst = Math.ceil((tStart - gridStart) / beatSec);
                const nLast = Math.floor((tEnd - gridStart) / beatSec);

                for (let n = nFirst; n <= nLast; n++) {
                    const beatTime = gridStart + n * beatSec;
                    const x = Math.round(cx + (beatTime - ct) * pxPerSec);
                    if (x < 0 || x > w) continue;

                    const beatInBar = ((n - phase) % 4 + 4) % 4; // 0=1, 1=2, 2=3, 3=4
                    const style = BEAT_COLORS[beatInBar];

                    ctx.strokeStyle = style.line;
                    ctx.lineWidth = style.width;
                    ctx.beginPath();
                    ctx.moveTo(x, 0);
                    ctx.lineTo(x, h);
                    ctx.stroke();

                    ctx.fillStyle = style.text;
                    ctx.font = beatInBar === 0
                        ? "bold 12px monospace"
                        : "11px monospace";
                    ctx.fillText(String(beatInBar + 1), x + 3, 14);
                }
            }

            // --- Playhead ---
            ctx.strokeStyle = "#ff3333";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(cx, 0);
            ctx.lineTo(cx, h);
            ctx.stroke();

            ctx.restore();
        };

        rafId = requestAnimationFrame(draw);
        return () => {
            cancelAnimationFrame(rafId);
            ro.disconnect();
        };
    }, [filePath]);

    if (!filePath) {
        return (
            <div style={{
                width: "100%",
                height: `${HEIGHT}px`,
                background: "#04090f",
                border: "1px dashed #1e3a5a",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#334155",
                fontSize: "12px",
            }}>
                Kein Track geladen
            </div>
        );
    }

    function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        e.preventDefault();

        const startX = e.clientX;
        const startTime = currentTimeRef.current;
        const canvasWidth = canvas.getBoundingClientRect().width;
        const secPerPx = VISIBLE_SECONDS / canvasWidth;

        canvas.style.cursor = "grabbing";

        const onMove = (ev: MouseEvent) => {
            const deltaX = ev.clientX - startX;
            const newTime = Math.max(0, Math.min(startTime - deltaX * secPerPx, durationRef.current));
            onSeek(newTime);
        };

        const onUp = () => {
            canvas.style.cursor = "grab";
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
        };

        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    }

    function handleSaveFirstBeat() {
        const t = currentTimeRef.current;
        firstBeatOffsetRef.current = t;
        setFirstBeatOffset(t);
        setSaved(false);

        if (!filePath) return;
        const fbPath = getFirstBeatPath(filePath);
        invoke("tkdj_write_text_file", {
            path: fbPath,
            content: JSON.stringify({ firstBeatSeconds: t }, null, 2),
        })
            .then(() => setSaved(true))
            .catch(e => console.error("First beat speichern fehlgeschlagen:", e));
    }

    const infoText = firstBeatOffset === null
        ? "Waveform ziehen → 1 ausrichten → Speichern"
        : `▼1 bei ${firstBeatOffset.toFixed(3)}s${saved ? " ✓" : " (nicht gespeichert)"}`;

    return (
        <div style={{ position: "relative", width: "100%" }}>
            <canvas
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                style={{ display: "block", width: "100%", height: `${HEIGHT}px`, background: "#111", cursor: "grab" }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 6px" }}>
                <button
                    onClick={handleSaveFirstBeat}
                    style={{
                        background: "#1a3a1a",
                        border: "1px solid #ffd84d",
                        color: "#ffd84d",
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 3,
                        cursor: "pointer",
                        fontFamily: "monospace",
                    }}
                >
                    ▼1 setzen
                </button>
                <span style={{ color: "#ffd84d", fontSize: 11 }}>{infoText}</span>
            </div>
        </div>
    );
}
