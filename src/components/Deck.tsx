import { useState, useRef, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Track } from "../types/track";

type DeckProps = {
    title: string;
    track?: Track;
    isActive?: boolean;
    onActivate?: () => void;
    onPlay?: () => void;
    volume: number;
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
}: DeckProps) {
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    const waveform = track?.analysis?.waveform ?? [];
    const progressPercent =
        duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

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

    return (
        <div className={`deck ${isActive ? "active-deck" : ""}`}>
            <div className="deck-header">
                <h2>{title}</h2>

                <div className="deck-header-right">
                    {isActive && <span className="live-badge">LIVE</span>}

                    <button className="activate-btn" onClick={onActivate}>
                        Aktiv
                    </button>
                </div>
            </div>

            <div className="waveform">
                {track ? (
                    <>
                        <div className="deck-waveform-bars">
                            {waveform.length > 0 ? (
                                waveform.map((value, index) => (
                                    <div
                                        key={`${track.id}-wave-${index}`}
                                        className="deck-waveform-bar"
                                        style={{
                                            height: `${Math.max(8, Math.min(100, value * 400))}%`,
                                        }}
                                    />
                                ))
                            ) : (
                                <div className="deck-waveform-empty">
                                    Waveform noch nicht analysiert
                                </div>
                            )}

                            <div
                                className="deck-waveform-playhead"
                                style={{ left: `${progressPercent}%` }}
                            />
                        </div>

                        <div className="deck-time">
                            <span>{formatTime(currentTime)}</span>
                            <span>-{formatTime(Math.max(0, duration - currentTime))}</span>
                        </div>
                    </>
                ) : (
                    <span>Kein Track</span>
                )}
            </div>

            <div className="deck-info">
                <div>BPM: {track ? track.bpm : "-"}</div>
                <div>Key: {track ? track.key : "-"}</div>
                <div>Energy: {track ? track.energy : "-"}</div>
            </div>

            <div className="deck-controls">
                <button onClick={handlePlayPause} disabled={!track}>
                    {isPlaying ? "Pause" : "Play"}
                </button>

                <button onClick={handleStop} disabled={!track}>
                    Stop
                </button>

                <button disabled={!track}>Cue</button>
                <button disabled={!track}>Sync</button>
            </div>

            {track && <div className="deck-track-title">{track.title} · Waveform: {waveform.length}</div>}

            <audio
                ref={audioRef}
                onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
                onEnded={() => setIsPlaying(false)}
            />
        </div>
    );
}
