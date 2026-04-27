import type { Track } from "../types/track";

type AutomixPanelProps = {
    queue: Track[];
    onRemove: (trackId: string) => void;
    onMoveUp: (index: number) => void;
    onMoveDown: (index: number) => void;
};

export default function AutomixPanel({
    queue,
    onRemove,
    onMoveUp,
    onMoveDown,
}: AutomixPanelProps) {
    return (
        <div className="queue-panel">
            <h2>Automix</h2>

            {queue.length === 0 ? (
                <p className="empty-queue">Noch keine Songs in der Automix</p>
            ) : (
                <div className="queue-list">
                    {queue.map((track, index) => (
                        <div className="queue-row" key={`${track.id}-${index}`}>
                            <span>{index + 1}</span>

                            <div>
                                <strong>{track.title}</strong>
                                <small>
                                    {track.artist} · {track.bpm} BPM · {track.key}
                                </small>
                            </div>

                            <div className="queue-row-actions">
                                <button onClick={() => onMoveUp(index)} disabled={index === 0}>
                                    ↑
                                </button>
                                <button
                                    onClick={() => onMoveDown(index)}
                                    disabled={index === queue.length - 1}
                                >
                                    ↓
                                </button>
                                <button onClick={() => onRemove(track.id)}>×</button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}