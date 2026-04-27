import { useState } from "react";
import { buildSyncPlan, formatPitchPercent, formatPlaybackRate } from "../modules/sync/syncEngine";

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

        if (nextValue < 50) onActiveDeckChange("A");
        if (nextValue > 50) onActiveDeckChange("B");
    }

    const masterDeck = value <= 50 ? "A" : "B";
    const targetDeck = masterDeck === "A" ? "B" : "A";

    const masterBpm = masterDeck === "A" ? bpmA : bpmB;
    const targetBpm = masterDeck === "A" ? bpmB : bpmA;

    const syncPlan = buildSyncPlan({
        masterBpm: masterBpm ?? null,
        targetBpm: targetBpm ?? null,
    });

    return (
        <div className={`crossfader sync-${syncPlan.rating}`}>
            <div className="sync-info">
                <strong>SYNC</strong>
                <span>Master: {masterDeck}</span>
                <span>Ziel: Deck {targetDeck}</span>
                <span>
                    {syncPlan.masterBpm && syncPlan.targetBpm
                        ? `${syncPlan.targetBpm} → ${syncPlan.masterBpm} BPM`
                        : "BPM fehlt"}
                </span>
                <span>Pitch: {formatPitchPercent(syncPlan.pitchPercent)}</span>
                <span>Rate: {formatPlaybackRate(syncPlan.playbackRate)}</span>
            </div>

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

            <div className="mixer-controls">
                <div className="deck-mixer-controls">
                    <strong>Deck A</strong>
                    <label>Vol <input type="range" min="0" max="100" defaultValue="100" /></label>
                    <label>Höhen <input type="range" min="-12" max="12" defaultValue="0" /></label>
                    <label>Mitten <input type="range" min="-12" max="12" defaultValue="0" /></label>
                    <label>Bass <input type="range" min="-12" max="12" defaultValue="0" /></label>
                </div>

                <div className="deck-mixer-controls">
                    <strong>Deck B</strong>
                    <label>Vol <input type="range" min="0" max="100" defaultValue="100" /></label>
                    <label>Höhen <input type="range" min="-12" max="12" defaultValue="0" /></label>
                    <label>Mitten <input type="range" min="-12" max="12" defaultValue="0" /></label>
                    <label>Bass <input type="range" min="-12" max="12" defaultValue="0" /></label>
                </div>
            </div>
        </div>
    );
}
