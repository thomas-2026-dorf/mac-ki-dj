import { useEffect, useRef, useMemo, useState } from "react";
import WaveSurfer from "wavesurfer.js";

const SILENT_WAV =
    "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

const WAVEFORM_HEIGHT = 80;
const ZOOM_LEVELS = [1, 2, 4, 8] as const;

type BeatLine = { left: number; isDownbeat: boolean };

function computeBeatLines(vStart: number, vDur: number, bpm: number, gridStart: number): BeatLine[] {
    const beatInterval = 60 / bpm;
    const vEnd = vStart + vDur;
    const nMin = Math.floor((vStart - gridStart) / beatInterval) - 1;
    const nMax = Math.ceil((vEnd - gridStart) / beatInterval) + 1;
    const lines: BeatLine[] = [];
    for (let n = nMin; n <= nMax; n++) {
        const t = gridStart + n * beatInterval;
        if (t < vStart - 0.001 || t > vEnd + 0.001 || t < 0) continue;
        lines.push({
            left: ((t - vStart) / vDur) * 100,
            isDownbeat: ((n % 4) + 4) % 4 === 0,
        });
    }
    return lines;
}

type Props = {
    trackId: string;
    waveform: number[];
    duration: number;
    currentTime: number;
    onSeek: (time: number) => void;
    bpm?: number;
    beatGridStartSeconds?: number;
    showZoom?: boolean;
};

export default function PlayerWaveform({
    trackId, waveform, duration, currentTime, onSeek,
    bpm, beatGridStartSeconds, showZoom = false,
}: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const wsRef = useRef<WaveSurfer | null>(null);
    const onSeekRef = useRef(onSeek);
    onSeekRef.current = onSeek;
    const durationRef = useRef(duration);
    durationRef.current = duration;

    const [zoomLevel, setZoomLevel] = useState<number>(1);
    // Ref hält immer den aktuellen Zoom — sicher in Closures (ready-Callback etc.)
    const zoomLevelRef = useRef(1);

    // Zoom direkt anwenden — wird vom Button-Klick und ready-Event aufgerufen
    function applyZoom(level: number) {
        const ws = wsRef.current;
        const container = containerRef.current;
        const dur = durationRef.current;
        zoomLevelRef.current = level;
        setZoomLevel(level);
        if (!ws || !container || !dur || container.clientWidth === 0) return;
        const pxPerSec = (container.clientWidth / dur) * level;
        try { ws.zoom(pxPerSec); } catch { /* ignoriert — WaveSurfer noch nicht bereit */ }
    }

    // Sichtbares Zeitfenster für Beat-Grid-Overlay
    // zoom=1: kein currentTime-Einfluss → memoized bis Track wechselt
    const { visibleStart, visibleDuration } = useMemo(() => {
        if (zoomLevel === 1 || !duration) return { visibleStart: 0, visibleDuration: duration || 0 };
        const windowDur = duration / zoomLevel;
        const half = windowDur / 2;
        const start = Math.max(0, Math.min(duration - windowDur, currentTime - half));
        return { visibleStart: start, visibleDuration: windowDur };
    }, [zoomLevel, currentTime, duration]);

    // Beat-Linien nur wenn echte Analyse-Daten vorhanden
    const beatLines = useMemo(() => {
        if (!bpm || bpm <= 0 || beatGridStartSeconds === undefined || !duration || visibleDuration <= 0) return [];
        return computeBeatLines(visibleStart, visibleDuration, bpm, beatGridStartSeconds);
    }, [bpm, beatGridStartSeconds, duration, visibleStart, visibleDuration]);

    // Init / re-init wenn Track wechselt
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        wsRef.current?.destroy();
        // Zoom zurücksetzen wenn neuer Track geladen wird
        zoomLevelRef.current = 1;
        setZoomLevel(1);

        const ws = WaveSurfer.create({
            container,
            waveColor: "#1e4a7a",
            progressColor: "#ff9500",
            cursorColor: "#ffffff",
            cursorWidth: 2,
            height: WAVEFORM_HEIGHT,
            interact: true,
            normalize: true,
            barWidth: 2,
            barGap: 1,
            barRadius: 2,
            hideScrollbar: true,
            autoScroll: true,
            autoCenter: true,
        });

        wsRef.current = ws;

        ws.on("interaction", (newTime) => {
            onSeekRef.current(newTime);
        });

        ws.on("error", (err) => {
            console.warn("[PlayerWaveform] wavesurfer error (ignoriert):", err);
        });

        // Zoom nach dem Laden anwenden (erst jetzt kennt WaveSurfer die Dauer)
        ws.on("ready", () => {
            const dur = durationRef.current;
            if (!dur || container.clientWidth === 0) return;
            const pxPerSec = (container.clientWidth / dur) * zoomLevelRef.current;
            try { ws.zoom(pxPerSec); } catch { /* ignoriert */ }
        });

        const peaks: Float32Array[] = waveform.length > 0 ? [new Float32Array(waveform)] : [];

        ws.load(SILENT_WAV, peaks.length > 0 ? peaks : undefined, duration || 1).catch((e) => {
            console.warn("[PlayerWaveform] load rejected:", e);
        });

        return () => {
            ws.destroy();
            wsRef.current = null;
        };
    }, [trackId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Playhead-Position synchronisieren
    useEffect(() => {
        const ws = wsRef.current;
        if (!ws || !duration) return;
        try { ws.setTime(currentTime); } catch { /* noch nicht bereit */ }
    }, [currentTime, duration]);

    return (
        <div style={{ position: "relative", width: "100%" }}>
            <div
                ref={containerRef}
                style={{
                    width: "100%",
                    height: `${WAVEFORM_HEIGHT}px`,
                    background: "#04090f",
                    borderRadius: "4px",
                    border: "1px solid #0f2030",
                }}
            />

            {beatLines.length > 0 && (
                <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 2 }}>
                    {beatLines.map((line, i) => (
                        <div
                            key={i}
                            style={{
                                position: "absolute",
                                left: `${line.left}%`,
                                top: line.isDownbeat ? "0%" : "25%",
                                bottom: line.isDownbeat ? "0%" : "25%",
                                width: "1px",
                                background: line.isDownbeat
                                    ? "rgba(255,255,255,0.55)"
                                    : "rgba(255,255,255,0.18)",
                            }}
                        />
                    ))}
                </div>
            )}

            {showZoom && (
                <div style={{
                    position: "absolute", top: 4, right: 6, zIndex: 10,
                    display: "flex", gap: "3px",
                }}>
                    {ZOOM_LEVELS.map(level => (
                        <button
                            key={level}
                            onClick={() => applyZoom(level)}
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
            )}

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
