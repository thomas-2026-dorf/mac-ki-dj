import { useState } from "react";

type CrossfaderProps = {
    onActiveDeckChange: (deck: "A" | "B") => void;
    onChange: (value: number) => void; // 0 → A | 1 → B
    bpmA?: number;
    bpmB?: number;
};

export default function Crossfader({ onActiveDeckChange, onChange, bpmA, bpmB }: CrossfaderProps) {
    const [value, setValue] = useState(50);

    function handleChange(nextValue: number) {
        setValue(nextValue);

        onChange(nextValue / 100);

        if (nextValue < 50) {
            onActiveDeckChange("A");
        }

        if (nextValue > 50) {
            onActiveDeckChange("B");
        }
    }

    const masterDeck = value <= 50 ? "A" : "B";
    const masterBpm = masterDeck === "A" ? bpmA : bpmB;
    const targetBpm = masterDeck === "A" ? bpmB : bpmA;

    const pitchPercent =
        masterBpm && targetBpm
            ? ((masterBpm / targetBpm - 1) * 100).toFixed(1)
            : null;

    return (
        <div className="crossfader">
            <div className="labels">
                <span>A</span>
                <span>B</span>
            </div>

            <input
                type="range"
                min="0"
                max="100"
                value={value}
                onChange={(e) => handleChange(Number(e.target.value))}
                className="fader"
            />

            <div className="value">
                A: {100 - value} | B: {value}
            </div>

            <div className="sync-info">
                <strong>SYNC</strong>
                <span>Master: {masterDeck}</span>
                <span>
                    {masterBpm && targetBpm
                        ? `${targetBpm} → ${masterBpm} BPM (${pitchPercent}%)`
                        : "BPM fehlt"}
                </span>
            </div>
        </div>
    );
}