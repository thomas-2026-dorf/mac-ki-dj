import type { Track } from "../types/track";

type QueuePanelProps = {
    queue: Track[];
};

export default function QueuePanel({ queue }: QueuePanelProps) {
    return (
        <div className="queue-panel">
            <h2>Queue</h2>

            {queue.length === 0 ? (
                <p className="empty-queue">Noch keine Songs in der Queue</p>
            ) : (
                <div className="queue-list">
                    {queue.map((track, index) => (
                        <div className="queue-row" key={track.id}>
                            <span>{index + 1}</span>
                            <div>
                                <strong>{track.title}</strong>
                                <small>
                                    {track.artist} · {track.bpm} BPM · {track.key}
                                </small>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}