import { useState, useRef, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Track } from "../types/track";

type DeckProps = {
    onSetGridStart?: (seconds: number) => void;
    title: string;
    track?: Track;
    isActive?: boolean;
    onActivate?: () => void;
    onPlay?: () => void;
    volume: number;
    onLoad?: () => void;
    onEject?: () => void;
};

function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "00:00";

    const minutes = Math.floor(seconds / 60);
    const restSeconds = Math.floor(seconds % 60);

    return `${String(minutes).padStart(2, "0")}:${String(restSeconds).padStart(2, "0")}`;
}

export default function Deck({
    title,
    track,
    isActive,
    onActivate,
    onPlay,
    volume,
    onLoad,
    onEject,
    onSetGridStart,
}: DeckProps) {
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isScrubbing, setIsScrubbing] = useState(false);
    const [pitchPercent, setPitchPercent] = useState(0);

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const waveformRef = useRef<HTMLDivElement | null>(null);

    const waveform = track?.analysis?.waveform ?? [];
    const cuePoints = track?.analysis?.cuePoints ?? [];
    const bpm = track?.bpm ?? 0;
    const beatDuration = bpm > 0 ? 60 / bpm : 0;
    const beatGridStart =
        track?.analysis?.beatGridStartSeconds ??
        cuePoints.find((cuePoint) => cuePoint.type === "drum" || cuePoint.type === "start")?.timeSeconds ??
        0;

    const visibleSeconds = 24;
    const visibleStart =
        duration > visibleSeconds
            ? Math.min(Math.max(0, currentTime - visibleSeconds * 0.25), duration - visibleSeconds)
            : 0;
    const visibleEnd = duration > 0 ? Math.min(duration, visibleStart + visibleSeconds) : 0;
    const visibleDuration = Math.max(1, visibleEnd - visibleStart);

    const visibleWaveformRaw =
        duration > 0 && waveform.length > 0
            ? waveform.slice(
                  Math.max(0, Math.floor((visibleStart / duration) * waveform.length)),
                  Math.min(waveform.length, Math.ceil((visibleEnd / duration) * waveform.length)),
              )
            : waveform;

    const maxVisibleBars = 180;
    const visibleWaveform =
        visibleWaveformRaw.length > maxVisibleBars
            ? Array.from({ length: maxVisibleBars }, (_, index) => {
                  const start = Math.floor((index / maxVisibleBars) * visibleWaveformRaw.length);
                  const end = Math.max(
                      start + 1,
                      Math.floor(((index + 1) / maxVisibleBars) * visibleWaveformRaw.length),
                  );
                  const values = visibleWaveformRaw.slice(start, end);
                  return Math.max(...values);
              })
            : visibleWaveformRaw;

    const beatMarkers = [];
    if (beatDuration > 0 && visibleEnd > visibleStart) {
        const firstBeatIndex = Math.ceil((visibleStart - beatGridStart) / beatDuration);

        for (let index = firstBeatIndex; beatGridStart + index * beatDuration <= visibleEnd; index++) {
            const time = beatGridStart + index * beatDuration;
            if (time < visibleStart) continue;

            beatMarkers.push({
                time,
                percent: ((time - visibleStart) / visibleDuration) * 100,
                beat: (((index % 4) + 4) % 4) + 1,
            });
        }
    }

    const progressPercent =
        visibleDuration > 0
            ? Math.min(100, Math.max(0, ((currentTime - visibleStart) / visibleDuration) * 100))
            : 0;

    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.volume = volume;
        }
    }, [volume]);

    useEffect(() => {
        if (!audioRef.current) return;

        if (!track?.url) {
            audioRef.current.removeAttribute("src");
            audioRef.current.load();
            setIsPlaying(false);
            setCurrentTime(0);
            setDuration(0);
            return;
        }

        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current.src = convertFileSrc(track.url);
        audioRef.current.load();
        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(0);
    }, [track]);

    async function handlePlayPause() {
        if (!audioRef.current || !track) return;

        if (isPlaying) {
            audioRef.current.pause();
            setIsPlaying(false);
            return;
        }

        try {
            await audioRef.current.play();
            setIsPlaying(true);
            onPlay?.();
        } catch (error) {
            console.error("Audio konnte nicht abgespielt werden:", error);
            alert("Audio konnte nicht abgespielt werden: " + String(error));
        }
    }

    function handleStop() {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
        }

        setIsPlaying(false);
        setCurrentTime(0);
    }

    function seekToPosition(clientX: number) {
        if (!audioRef.current || !track || duration <= 0 || !waveformRef.current) return;

        const rect = waveformRef.current.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        const nextTime = Math.min(duration, Math.max(0, visibleStart + ratio * visibleDuration));

        audioRef.current.currentTime = nextTime;
        setCurrentTime(nextTime);
    }

    return (
        <div className={`deck ${isActive ? "active-deck" : ""}`} style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative", paddingRight: "44px" }}>
            <div className="deck-pitch-control">
                <span>Pitch</span>
                <input
                    type="range"
                    min="-8"
                    max="8"
                    step="0.1"
                    value={pitchPercent}
                    onChange={(event) => setPitchPercent(Number(event.target.value))}
                />
                <strong>{pitchPercent > 0 ? "+" : ""}{pitchPercent.toFixed(1)}%</strong>
            </div>

            <div className="deck-header">
                <h2>{title}</h2>

                <div className="deck-header-right">
                    {isActive && <span className="live-badge">LIVE</span>}

                    {track && (
                        <button className="activate-btn" onClick={onEject} title="Track auswerfen">
                            Auswerfen
                        </button>
                    )}

                    <button className="activate-btn" onClick={onActivate}>
                        Aktiv
                    </button>
                </div>
            </div>

            <div className="waveform">
                {track ? (
                    <>
                        <div className="deck-waveform-container">
                            <div className="deck-beat-grid">
                                {beatMarkers.map((marker) => (
                                    <div
                                        key={`beat-${marker.time}`}
                                        className={`deck-beat-marker beat-${marker.beat}`}
                                        style={{ left: `${marker.percent}%` }}
                                        title={`Beat ${marker.beat} · ${formatTime(marker.time)}`}
                                    >
                                        {marker.beat === 1 ? "1" : ""}
                                    </div>
                                ))}
                            </div>

                            <div
                                ref={waveformRef}
                                className="deck-beatgrid-stage"
                                onMouseDown={(event) => {
                                    setIsScrubbing(true);
                                    seekToPosition(event.clientX);
                                }}
                                onMouseMove={(event) => {
                                    if (isScrubbing) seekToPosition(event.clientX);
                                }}
                                onMouseUp={() => setIsScrubbing(false)}
                                onMouseLeave={() => setIsScrubbing(false)}
                            >
                                <div className="deck-mini-waveform">
                                {visibleWaveform.length > 0 ? (
                                    visibleWaveform.map((value, index) => (
                                        <div
                                            key={`${track.id}-wave-${index}`}
                                            className={
                                                "deck-waveform-bar " +
                                                (value > 0.22
                                                    ? "wave-hot"
                                                    : value > 0.12
                                                        ? "wave-mid"
                                                        : "wave-low")
                                            }
                                            style={{
                                                height: `${Math.max(10, Math.min(100, value * 420))}%`,
                                            }}
                                        />
                                    ))
                                ) : (
                                    <div className="deck-waveform-empty">
                                        Waveform noch nicht analysiert
                                    </div>
                                )}
                                </div>

                                {cuePoints.map((cuePoint) => {
                                    const markerLeft =
                                        cuePoint.timeSeconds >= visibleStart &&
                                        cuePoint.timeSeconds <= visibleEnd
                                            ? Math.min(
                                                  100,
                                                  Math.max(
                                                      0,
                                                      ((cuePoint.timeSeconds - visibleStart) / visibleDuration) * 100,
                                                  ),
                                              )
                                            : -1;

                                    if (markerLeft < 0) return null;

                                    return (
                                        <div
                                            key={cuePoint.id}
                                            className={`deck-cue-marker deck-cue-${cuePoint.type}`}
                                            style={{ left: `${markerLeft}%` }}
                                            title={`${cuePoint.name} · ${formatTime(cuePoint.timeSeconds)}`}
                                        />
                                    );
                                })}

                                <div
                                    className="deck-waveform-playhead"
                                    style={{ left: `${progressPercent}%` }}
                                />
                            </div>
                        </div>

                        <div className="deck-time">
                            <span>{formatTime(currentTime)}</span>
                            <span>Zoom {formatTime(visibleStart)} - {formatTime(visibleEnd)}</span>
                            <span>-{formatTime(Math.max(0, duration - currentTime))}</span>
                        </div>



                        {cuePoints.length > 0 && (
                            <div className="deck-cue-list">
                                {cuePoints.map((cuePoint) => (
                                    <span
                                        key={`${cuePoint.id}-label`}
                                        className={`deck-cue-label deck-cue-${cuePoint.type}`}
                                    >
                                        {cuePoint.name} · {formatTime(cuePoint.timeSeconds)}
                                    </span>
                                ))}
                            </div>
                        )}
                    </>
                ) : (
                    <span>Kein Track</span>
                )}
            </div>

            {track && (
                <input
                    type="range"
                    className="deck-song-position"
                    min="0"
                    max={duration || 0}
                    step="0.1"
                    value={currentTime}
                    onChange={(event) => {
                        const nextTime = Number(event.target.value);
                        if (audioRef.current) {
                            audioRef.current.currentTime = nextTime;
                        }
                        setCurrentTime(nextTime);
                    }}
                />
            )}

            <div className="deck-info">
                <div>BPM: {track ? track.bpm : "-"}</div>
                <div>Key: {track ? track.key : "-"}</div>
                <div>Energy: {track ? track.energy : "-"}</div>
            </div>

            

            {track && (
                <div className="deck-track-title">
                    {track.title} · Waveform: {waveform.length}
                </div>
            )}

            <div className="deck-controls" style={{ marginTop: "auto" }}>
                <button className="load-btn" onClick={onLoad}>
                    Load
                </button>

                <button onClick={handlePlayPause} disabled={!track}>
                    {isPlaying ? "Pause" : "Play"}
                </button>

                <button onClick={handleStop} disabled={!track}>
                    Stop
                </button>

                <button disabled={!track}>Cue</button>
                <button
    onClick={() => {
        if (!track) return;
        onSetGridStart?.(currentTime);
    }}
>
    Sync
</button>
            </div>

<audio
                ref={audioRef}
                onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
                onEnded={() => setIsPlaying(false)}
            />
        </div>
    );
}
