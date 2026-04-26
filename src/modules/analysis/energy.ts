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
