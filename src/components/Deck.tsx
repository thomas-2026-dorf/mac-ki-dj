type DeckProps = {
    title: string;
};

export default function Deck({ title }: DeckProps) {
    return (
        <div className="deck">
            <div className="deck-header">
                <h2>{title}</h2>
            </div>

            <div className="waveform">
                <span>Waveform</span>
            </div>

            <div className="deck-info">
                <div>BPM: 124</div>
                <div>Key: 8A</div>
                <div>Energy: 6</div>
            </div>
        </div>
    );
}