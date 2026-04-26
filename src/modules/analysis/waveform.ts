import type { PreparedSignal } from "./types";

export function generateWaveform(
    signal: PreparedSignal,
    targetPoints = 1000,
): number[] {
    const samples = signal.samples;
    const blockSize = Math.max(1, Math.floor(samples.length / targetPoints));
    const rawWaveform: number[] = [];

    for (let i = 0; i < targetPoints; i++) {
        const start = i * blockSize;
        const end = Math.min(start + blockSize, samples.length);

        let sum = 0;

        for (let j = start; j < end; j++) {
            sum += Math.abs(samples[j]);
        }

        rawWaveform.push(sum / Math.max(1, end - start));
    }

    const max = Math.max(...rawWaveform);

    if (max <= 0) return rawWaveform;

    return rawWaveform.map((value) => value / max);
}
