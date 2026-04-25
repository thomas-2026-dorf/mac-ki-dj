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

export default function Deck({
    title,
    track,
    isActive,
    onActivate,
    onPlay,
    volume,
}: DeckProps) {
    const [isPlaying, setIsPlaying] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

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
            return;
        }

        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current.src = convertFileSrc(track.url);
        audioRef.current.load();
        setIsPlaying(false);
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
                <span>{track ? track.title : "Kein Track"}</span>
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

            <audio ref={audioRef} />
        </div>
    );
}