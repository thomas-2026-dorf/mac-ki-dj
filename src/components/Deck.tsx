import { useState, useRef, useEffect } from "react";
import type { Track } from "../types/track";

type DeckProps = {
    title: string;
    track?: Track;
    isActive?: boolean;
    onActivate?: () => void;
    onPlay?: () => void;
    volume: number; // 0 - 1 vom Crossfader
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

    function handlePlayPause() {
        setIsPlaying((current) => {
            const next = !current;

            if (audioRef.current) {
                if (next) {
                    audioRef.current.play();
                    onPlay?.();
                } else {
                    audioRef.current.pause();
                }
            }

            return next;
        });
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

            <div className="deck-volume">
                Volume: {volume.toFixed(2)}
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

            <audio
                ref={audioRef}
                src={track?.url}
                preload="auto"
            />
        </div>
    );
}