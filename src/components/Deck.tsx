import type { Track } from "../types/track";

type DeckProps = {
    title: string;
    track?: Track;
};

export default function Deck({ title, track }: DeckProps) {
    return (
        <div className="deck">
            <div className="deck-header">
                <h2>{title}</h2>
            </div>

            <div className="waveform">
                <span>{track ? track.title : "Kein Track"}</span>
            </div>

            <div className="deck-info">
                <div>BPM: {track ? track.bpm : "-"}</div>
                <div>Key: {track ? track.key : "-"}</div>
                <div>Energy: {track ? track.energy : "-"}</div>
            </div>
        </div>
    );
}