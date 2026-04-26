import type { PreparedSignal } from "./types";

export function generateWaveform(
    signal: PreparedSignal,
    targetPoints = 1000,
): number[] {
    const samples = signal.samples;
    const blockSize = Math.floor(samples.length / targetPoints);

    const waveform: number[] = [];

    for (let i = 0; i < targetPoints; i++) {
        const start = i * blockSize;
        const end = Math.min(start + blockSize, samples.length);

        let max = 0;

        for (let j = start; j < end; j++) {
            const value = Math.abs(samples[j]);
            if (value > max) max = value;
        }

        waveform.push(max);
    }

    return waveform;
}
