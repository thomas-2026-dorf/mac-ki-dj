import { demoTracks } from "../data/demoTracks";

export default function TrackList() {
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
                <div className="track-row" key={track.id}>
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