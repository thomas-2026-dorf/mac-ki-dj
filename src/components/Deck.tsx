import { useState } from "react";
import type { Track } from "../types/track";

type DeckProps = {
    title: string;
    track?: Track;
    isActive?: boolean;
    onActivate?: () => void;
    onPlay?: () => void;
};

export default function Deck({
    title,
    track,
    isActive,
    onActivate,
    onPlay,
}: DeckProps) {
    const [isPlaying, setIsPlaying] = useState(false);

    function handlePlayPause() {
        setIsPlaying((current) => {
            const next = !current;

            if (next) {
                onPlay?.();
            }

            return next;
        });
    }

    function handleStop() {
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
        </div>
    );
}