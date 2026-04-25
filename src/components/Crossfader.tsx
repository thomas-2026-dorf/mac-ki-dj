import { useState } from "react";

export default function Crossfader() {
    const [value, setValue] = useState(50);
    const [isAutoFading, setIsAutoFading] = useState(false);

    function autoFadeToB() {
        if (isAutoFading) return;

        setIsAutoFading(true);
        setValue(0);

        let current = 0;

        const timer = window.setInterval(() => {
            current += 5;
            setValue(current);

            if (current >= 100) {
                window.clearInterval(timer);
                setValue(100);
                setIsAutoFading(false);
            }
        }, 100);
    }

    function resetCenter() {
        if (isAutoFading) return;
        setValue(50);
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
                onChange={(e) => setValue(Number(e.target.value))}
                className="fader"
                disabled={isAutoFading}
            />

            <div className="value">
                A: {100 - value} | B: {value}
            </div>

            <div className="crossfader-buttons">
                <button onClick={resetCenter} disabled={isAutoFading}>
                    Mitte
                </button>

                <button onClick={autoFadeToB} disabled={isAutoFading}>
                    {isAutoFading ? "Auto läuft..." : "Auto → B"}
                </button>
            </div>
        </div>
    );
}