import { demoTracks } from "../data/demoTracks";
import type { Track } from "../types/track";

type Props = {
    onSelect: (track: Track) => void;
};

export default function TrackList({ onSelect }: Props) {
    return (
        <div className="track-list">
            <h2>Songliste</h2>

            <div className="track-list-header">
                <span>Titel</span>
                <span>BPM</span>
                <span>Key</span>
                <span>Energy</span>
                <span>Länge</span>
            </div>

            {demoTracks.map((track) => (
                <div
                    className="track-row"
                    key={track.id}
                    onClick={() => onSelect(track)}
                >
                    <div>
                        <strong>{track.title}</strong>
                        <small>
                            {track.artist} · {track.genre}
                        </small>
                    </div>

                    <span>{track.bpm}</span>
                    <span>{track.key}</span>
                    <span>{track.energy}</span>
                    <span>{track.duration}</span>
                </div>
            ))}
        </div>
    );
}