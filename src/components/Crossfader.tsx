import { useState } from "react";

export default function Crossfader() {
    const [value, setValue] = useState(50);

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
                onChange={(e) => setValue(Number(e.target.value))}
                className="fader"
            />

            <div className="value">
                A: {100 - value} | B: {value}
            </div>
        </div>
    );
}