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
}: Props) {
    const waveformRef = useRef<HTMLDivElement | null>(null);
    const [isScrubbing, setIsScrubbing] = useState(false);

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
                        >
                            {marker.beat === 1 && <span className="dj-beat-one">1</span>}
                        </div>
                    ))}
                </div>
            )}

            {/* Waveform-Ebene */}
            <div
                ref={waveformRef}
                className="dj-waveform-stage"
                onMouseDown={(e) => {
                    const rect = getRect();
                    if (rect) { setIsScrubbing(true); onSeek(e.clientX, rect); }
                }}
                onMouseMove={(e) => {
                    if (!isScrubbing) return;
                    const rect = getRect();
                    if (rect) onSeek(e.clientX, rect);
                }}
                onMouseUp={() => setIsScrubbing(false)}
                onMouseLeave={() => setIsScrubbing(false)}
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
