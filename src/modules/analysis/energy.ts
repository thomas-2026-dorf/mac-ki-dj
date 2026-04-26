import type { EnergyFrame, PreparedSignal } from "./types";

export function calculateEnergyFrames(
    signal: PreparedSignal,
    frameSizeSeconds = 0.04,
): EnergyFrame[] {
    const frameSize = Math.max(1, Math.floor(signal.sampleRate * frameSizeSeconds));
    const frames: EnergyFrame[] = [];

    for (let start = 0, index = 0; start < signal.samples.length; start += frameSize, index++) {
        let sum = 0;
        const end = Math.min(start + frameSize, signal.samples.length);

        for (let i = start; i < end; i++) {
            const sample = signal.samples[i];
            sum += sample * sample;
        }

        frames.push({
            index,
            timeSeconds: start / signal.sampleRate,
            energy: sum / (end - start),
        });
    }

    return frames;
}

export function calculateEnergyLevel(frames: EnergyFrame[], onsetCount: number): number {
    if (frames.length === 0) return 0;

    const avgEnergy =
        frames.reduce((sum, frame) => sum + frame.energy, 0) / frames.length;

    const sortedEnergies = frames
        .map((frame) => frame.energy)
        .sort((a, b) => a - b);

    const p90 = sortedEnergies[Math.floor(sortedEnergies.length * 0.9)] || 0;
    const onsetDensity = onsetCount / Math.max(1, frames.length);

    const loudnessScore = Math.sqrt(avgEnergy) * 18;
    const peakScore = Math.sqrt(p90) * 10;
    const rhythmScore = onsetDensity * 18;

    const rawScore = (loudnessScore + peakScore + rhythmScore) * 0.65;

    return Math.round(Math.max(1, Math.min(10, rawScore)));
}
