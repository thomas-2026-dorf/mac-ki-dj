import type { EnergyFrame, Onset } from "./types";

export function detectOnsets(frames: EnergyFrame[]): Onset[] {
    if (frames.length < 3) return [];

    const flux: number[] = [];

    for (let i = 1; i < frames.length; i++) {
        const diff = frames[i].energy - frames[i - 1].energy;
        flux.push(Math.max(0, diff));
    }

    const avgFlux = flux.reduce((sum, value) => sum + value, 0) / flux.length;
    const threshold = avgFlux * 1.5;
    const onsets: Onset[] = [];

    for (let i = 1; i < flux.length - 1; i++) {
        if (flux[i] > flux[i - 1] && flux[i] > flux[i + 1] && flux[i] > threshold) {
            onsets.push({
                timeSeconds: frames[i].timeSeconds,
                strength: flux[i],
            });
        }
    }

    return onsets;
}
