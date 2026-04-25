import { useState } from "react";

type CrossfaderProps = {
    onActiveDeckChange: (deck: "A" | "B") => void;
};

export default function Crossfader({ onActiveDeckChange }: CrossfaderProps) {
    const [value, setValue] = useState(50);

    function handleChange(nextValue: number) {
        setValue(nextValue);

        if (nextValue < 50) {
            onActiveDeckChange("A");
        }

        if (nextValue > 50) {
            onActiveDeckChange("B");
        }
    }

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
        </div>
    );
}