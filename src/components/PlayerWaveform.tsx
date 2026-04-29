import { useEffect, useRef } from "react";
import WaveSurfer from "wavesurfer.js";

const SILENT_WAV =
    "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

const WAVEFORM_HEIGHT = 80;

type Props = {
    trackId: string;
    waveform: number[];
    duration: number;
    currentTime: number;
    onSeek: (time: number) => void;
};

export default function PlayerWaveform({ trackId, waveform, duration, currentTime, onSeek }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const wsRef = useRef<WaveSurfer | null>(null);
    const onSeekRef = useRef(onSeek);
    onSeekRef.current = onSeek;
    const durationRef = useRef(duration);
    durationRef.current = duration;
    const isDraggingRef = useRef(false);

    const hasWaveform = waveform.length > 0;

    // Init / re-init wenn Track wechselt ODER Waveform erstmals ankommt
    useEffect(() => {
        // Immer zuerst altes ws zerstören (auch wenn neuer Track keine Waveform hat)
        wsRef.current?.destroy();
        wsRef.current = null;

        const container = containerRef.current;
        if (!container) return; // kein Waveform-Container → nur Placeholder sichtbar

        const ws = WaveSurfer.create({
            container,
            waveColor: "#1e4a7a",
            progressColor: "#ff9500",
            cursorColor: "#ffffff",
            cursorWidth: 2,
            height: WAVEFORM_HEIGHT,
            interact: false, // Events werden manuell über das Overlay abgehandelt
            normalize: true,
            barWidth: 2,
            barGap: 1,
            barRadius: 2,
            hideScrollbar: true,
        });

        wsRef.current = ws;

        ws.on("error", (err) => {
            console.warn("[PlayerWaveform] wavesurfer error:", err);
        });

        ws.load(SILENT_WAV, [new Float32Array(waveform)], duration || 1).catch((e) => {
            console.warn("[PlayerWaveform] load rejected:", e);
        });

        return () => {
            ws.destroy();
            wsRef.current = null;
        };
    }, [trackId, hasWaveform]); // eslint-disable-line react-hooks/exhaustive-deps

    // Playhead mit externem currentTime synchronisieren
    useEffect(() => {
        const ws = wsRef.current;
        if (!ws || !duration) return;
        try { ws.setTime(currentTime); } catch { /* noch nicht bereit */ }
    }, [currentTime, duration]);

    function seekFromEvent(e: React.MouseEvent<HTMLDivElement>) {
        const rect = e.currentTarget.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const time = ratio * durationRef.current;
        onSeekRef.current(time);
        try { wsRef.current?.setTime(time); } catch { /* ignoriert */ }
    }

    // Kein Waveform-Daten → klarer Placeholder, kein leerer Bereich
    if (!hasWaveform) {
        return (
            <div style={{
                width: "100%",
                height: `${WAVEFORM_HEIGHT}px`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#334155",
                fontSize: "12px",
                border: "1px dashed #1e3a5a",
                borderRadius: "4px",
                background: "#04090f",
            }}>
                Waveform erst nach Analyse verfügbar
            </div>
        );
    }

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
            {/* Transparentes Overlay: fängt alle Klick- und Drag-Events ab */}
            <div
                style={{
                    position: "absolute",
                    inset: 0,
                    zIndex: 5,
                    cursor: "crosshair",
                }}
                onMouseDown={(e) => {
                    isDraggingRef.current = true;
                    seekFromEvent(e);
                }}
                onMouseMove={(e) => {
                    if (!isDraggingRef.current) return;
                    seekFromEvent(e);
                }}
                onMouseUp={() => { isDraggingRef.current = false; }}
                onMouseLeave={() => { isDraggingRef.current = false; }}
            />
        </div>
    );
}
