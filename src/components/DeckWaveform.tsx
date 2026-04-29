import { useRef, useState } from "react";
import type { TransitionPoint } from "../types/track";
import { ROLE_COLORS } from "../modules/transition/transitionPointPlanner";

type BeatMarker = {
    time: number;
    percent: number;
    beat: number;
};

type CuePoint = {
    id: string;
    timeSeconds: number;
    type?: string;
    name?: string;
};

type Props = {
    waveform: number[];
    beatMarkers: BeatMarker[];
    cuePoints: CuePoint[];
    transitionPoints?: TransitionPoint[];
    currentTime: number;
    visibleStart: number;
    visibleDuration: number;
    progressPercent: number;
    onSeek: (clientX: number, rect: DOMRect) => void;
    onPan?: (deltaX: number, viewWidth: number) => void;
};

export default function DeckWaveform({
    waveform,
    beatMarkers,
    cuePoints,
    transitionPoints,
    currentTime,
    visibleStart,
    visibleDuration,
    progressPercent,
    onSeek,
    onPan,
}: Props) {
    const waveformRef = useRef<HTMLDivElement | null>(null);
    const [isActive, setIsActive] = useState(false);
    const dragXRef = useRef<number | null>(null);

    const hasWaveform = waveform.length > 0;

    function getRect() {
        return waveformRef.current?.getBoundingClientRect() ?? null;
    }

    return (
        <div className="dj-waveform-outer">

            {/* Mittellinie */}
            <div className="dj-center-line" />

            {/* Beat-Grid — auch ohne Waveform, wenn BPM bekannt */}
            {beatMarkers.length > 0 && (
                <div className="dj-beat-grid">
                    {beatMarkers.map((marker) => (
                        <div
                            key={`beat-${marker.time}`}
                            className={`dj-beat-marker beat-${marker.beat}`}
                            style={{ left: `${marker.percent}%` }}
                        />
                    ))}
                </div>
            )}

            {/* Waveform-Ebene */}
            <div
                ref={waveformRef}
                className="dj-waveform-stage"
                style={{ cursor: onPan ? "ew-resize" : "crosshair" }}
                onMouseDown={(e) => {
                    setIsActive(true);
                    if (onPan) {
                        dragXRef.current = e.clientX;
                    } else {
                        const rect = getRect();
                        if (rect) onSeek(e.clientX, rect);
                    }
                }}
                onMouseMove={(e) => {
                    if (!isActive) return;
                    if (onPan) {
                        const rect = getRect();
                        if (rect && dragXRef.current !== null) {
                            onPan(e.clientX - dragXRef.current, rect.width);
                            dragXRef.current = e.clientX;
                        }
                    } else {
                        const rect = getRect();
                        if (rect) onSeek(e.clientX, rect);
                    }
                }}
                onMouseUp={() => { setIsActive(false); dragXRef.current = null; }}
                onMouseLeave={() => { setIsActive(false); dragXRef.current = null; }}
            >
                {hasWaveform ? (
                    (() => {
                        const maxVal = Math.max(...waveform, 0.001);
                        return waveform.map((value, index) => {
                            const normalized = value / maxVal;
                            const barTime = visibleStart + (index / waveform.length) * visibleDuration;
                            const played = barTime < currentTime;
                            const hot = normalized > 0.65;
                            const mid = normalized > 0.30;
                            const colorClass = played
                                ? (hot ? "bar-played-hot" : mid ? "bar-played-mid" : "bar-played-low")
                                : (hot ? "bar-hot" : mid ? "bar-mid" : "bar-low");

                            return (
                                <div
                                    key={index}
                                    className={`dj-bar ${colorClass}`}
                                    style={{ height: `${Math.max(8, Math.min(96, normalized * 96))}%` }}
                                />
                            );
                        });
                    })()
                ) : (
                    <div className="dj-waveform-empty" />
                )}

                {/* Cue-Marker — immer anzeigen (auch Blend-Marker ohne Analyse) */}
                {cuePoints.map((cue) => {
                    const pct = ((cue.timeSeconds - visibleStart) / visibleDuration) * 100;
                    if (pct < 0 || pct > 100) return null;
                    return (
                        <div
                            key={cue.id}
                            className="dj-cue-marker"
                            style={{ left: `${pct}%` }}
                            title={cue.name ?? ""}
                        />
                    );
                })}

                {/* TransitionPoint-Marker */}
                {(transitionPoints ?? []).map((tp) => {
                    const pct = ((tp.timeSeconds - visibleStart) / visibleDuration) * 100;
                    if (pct < -0.5 || pct > 100.5) return null;
                    const clampedPct = Math.max(0, Math.min(100, pct));
                    const color = ROLE_COLORS[tp.role]?.text ?? "#94a3b8";
                    const mm = Math.floor(tp.timeSeconds / 60);
                    const ss = String(Math.floor(tp.timeSeconds % 60)).padStart(2, "0");
                    return (
                        <div
                            key={tp.id}
                            title={`${tp.label ?? tp.role} @ ${mm}:${ss}`}
                            style={{
                                position: "absolute", left: `${clampedPct}%`, top: 0, bottom: 0,
                                width: "2px", background: color, opacity: 0.9, zIndex: 4,
                                pointerEvents: "none",
                            }}
                        >
                            <div style={{
                                position: "absolute", top: 0, left: "50%",
                                transform: "translateX(-50%)",
                                width: "7px", height: "7px", borderRadius: "50%",
                                background: color,
                            }} />
                        </div>
                    );
                })}

                {/* Playhead */}
                <div className="dj-playhead" style={{ left: `${progressPercent}%` }} />
            </div>
        </div>
    );
}
