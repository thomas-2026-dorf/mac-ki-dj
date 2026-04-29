import { useEffect, useRef } from "react";
import WaveSurfer from "wavesurfer.js";

// Minimal silent WAV — wavesurfer braucht eine Audio-Quelle, Audio kommt aber vom MixEngine
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

    // Init / re-init wenn Track wechselt
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        wsRef.current?.destroy();

        console.log("[PlayerWaveform] init — trackId:", trackId, "peaks:", waveform.length, "duration:", duration);

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
        });

        wsRef.current = ws;

        ws.on("interaction", (newTime) => {
            onSeekRef.current(newTime);
        });

        ws.on("error", (err) => {
            console.warn("[PlayerWaveform] wavesurfer error (ignoriert):", err);
        });

        ws.on("ready", () => {
            console.log("[PlayerWaveform] ready, duration:", ws.getDuration());
        });

        const peaks: Float32Array[] =
            waveform.length > 0 ? [new Float32Array(waveform)] : [];

        console.log("[PlayerWaveform] load — peaks channels:", peaks.length, "first peak length:", peaks[0]?.length);

        ws.load(SILENT_WAV, peaks.length > 0 ? peaks : undefined, duration || 1).catch((e) => {
            console.warn("[PlayerWaveform] load rejected:", e);
        });

        return () => {
            ws.destroy();
            wsRef.current = null;
        };
    }, [trackId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Playhead-Position mit externem currentTime synchronisieren
    useEffect(() => {
        const ws = wsRef.current;
        if (!ws || !duration) return;
        try {
            ws.setTime(currentTime);
        } catch {
            // setTime kann werfen wenn wavesurfer noch nicht bereit ist
        }
    }, [currentTime, duration]);

    return (
        <div style={{ position: "relative", width: "100%" }}>
            {/* wavesurfer.js v7 nutzt Shadow DOM — Container braucht explizite Höhe */}
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
            {/* Fallback: sichtbar solange keine Peaks vorhanden */}
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
