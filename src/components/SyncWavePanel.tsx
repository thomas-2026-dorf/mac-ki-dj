import type { Track } from "../types/track";

type Props = {
    deck: "A" | "B";
    track?: Track;
    time?: number;
    duration?: number;
    onSeek?: (seconds: number) => void;
};

export default function SyncWavePanel({ deck, track, time = 0, duration = 0, onSeek }: Props) {
    const waveform = track?.analysis?.waveform ?? [];
    const bpm = track?.analysis?.detectedBpm ?? track?.bpm ?? 0;
    const beatDuration = bpm > 0 ? 60 / bpm : 0;
    const beatGridStart = track?.analysis?.beatGridStartSeconds ?? 0;

    const visibleSeconds = 48;
    const halfWindow = visibleSeconds / 2;

    const visibleStart = time - halfWindow;
    const visibleEnd = visibleStart + visibleSeconds;
    const visibleDuration = visibleSeconds;

    const beatMarkers = [];
    if (beatDuration > 0) {
        const firstBeatIndex = Math.ceil((visibleStart - beatGridStart) / beatDuration);

        for (let index = firstBeatIndex; beatGridStart + index * beatDuration <= visibleEnd; index++) {
            const markerTime = beatGridStart + index * beatDuration;
            if (markerTime < visibleStart) continue;

            beatMarkers.push({
                time: markerTime,
                percent: ((markerTime - visibleStart) / visibleDuration) * 100,
                beat: (((index % 4) + 4) % 4) + 1,
            });
        }
    }

    const maxVisibleBars = 260;
    const visibleWaveform =
        duration > 0 && waveform.length > 0
            ? Array.from({ length: maxVisibleBars }, (_, index) => {
                  const barStartTime = visibleStart + (index / maxVisibleBars) * visibleDuration;
                  const barEndTime = visibleStart + ((index + 1) / maxVisibleBars) * visibleDuration;

                  if (barEndTime < 0 || barStartTime > duration) return 0;

                  const start = Math.max(0, Math.floor((Math.max(0, barStartTime) / duration) * waveform.length));
                  const end = Math.min(
                      waveform.length,
                      Math.max(start + 1, Math.ceil((Math.min(duration, barEndTime) / duration) * waveform.length)),
                  );

                  const values = waveform.slice(start, end);
                  return values.length > 0 ? Math.max(...values) : 0;
              })
            : waveform;

    const playheadPercent = track ? 50 : 0;

    const sliderPercent = duration > 0 ? Math.min(100, Math.max(0, (time / duration) * 100)) : 0;

    return (
        <div className="sync-wave-panel">
            <div className="sync-wave-left">
                <strong>Deck {deck}</strong>
                <span>{track ? track.title : "Kein Track geladen"}</span>
                <small>
                    {track?.bpm ? `${track.bpm} BPM` : "BPM: -"} · {track?.key ? `Key: ${track.key}` : "Key: -"}
                </small>
            </div>

            <div className="sync-wave-main">
                <div className="sync-wave-grid">
                    {beatMarkers.map((marker) => (
                        <div
                            key={`${deck}-beat-${marker.time}`}
                            className={`sync-beat-marker ${marker.beat === 1 ? "beat-one" : ""}`}
                            style={{ left: `${marker.percent}%` }}
                        >
                            {marker.beat === 1 ? "1" : ""}
                        </div>
                    ))}
                </div>

                <div className="sync-wave-bars">
                    {visibleWaveform.length > 0 ? (
                        visibleWaveform.map((value, index) => (
                            <div
                                key={`${deck}-wave-${index}`}
                                className="sync-wave-bar"
                                style={{ height: `${Math.max(8, Math.min(100, value * 420))}%` }}
                            />
                        ))
                    ) : (
                        <div className="sync-wave-empty">Waveform noch nicht analysiert</div>
                    )}
                </div>

                <div className="sync-playhead" style={{ "--playhead-left": `${playheadPercent}%` } as React.CSSProperties} />

                <input
                    className="sync-wave-position"
                    type="range"
                    min="0"
                    max="100"
                    value={sliderPercent}
                    onChange={(event) => {
                        if (!duration || !onSeek) return;
                        onSeek((Number(event.target.value) / 100) * duration);
                    }}
                    aria-label={`Deck ${deck} Position`}
                />
            </div>
        </div>
    );
}
