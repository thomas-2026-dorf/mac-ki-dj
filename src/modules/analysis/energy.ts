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

export type ActivityRegion = {
    startSeconds: number;
    endSeconds: number;
    confidence: number;  // 0..1: mittlere Energie des Bereichs relativ zum globalen Maximum
};

/**
 * detectActivityRegions
 * Findet zusammenhängende Zeitbereiche mit erhöhter Energie.
 * Glättet zuerst mit einem Moving Average (~1s), dann threshold = avg * 0.85.
 * Kurze Bereiche < minDurationSeconds werden verworfen.
 */
export function detectActivityRegions(
    frames: EnergyFrame[],
    minDurationSeconds = 2.0,
): ActivityRegion[] {
    if (frames.length === 0) return [];

    // Moving Average über ca. 1s (25 Frames à 40ms)
    const SMOOTH = 25;
    const half = Math.floor(SMOOTH / 2);
    const smoothed = frames.map((_, i) => {
        const lo = Math.max(0, i - half);
        const hi = Math.min(frames.length - 1, i + half);
        let sum = 0;
        for (let j = lo; j <= hi; j++) sum += frames[j].energy;
        return sum / (hi - lo + 1);
    });

    const avgEnergy = smoothed.reduce((s, v) => s + v, 0) / smoothed.length;
    const maxEnergy = Math.max(...smoothed);
    if (maxEnergy <= 0) return [];

    const threshold = avgEnergy * 0.85;

    let activeFrameCount = 0;
    const regions: ActivityRegion[] = [];
    let regionStart: number | null = null;
    let regionEnergySum = 0;
    let regionFrameCount = 0;

    for (let i = 0; i < frames.length; i++) {
        const active = smoothed[i] > threshold;
        if (active) activeFrameCount++;

        if (active && regionStart === null) {
            regionStart = frames[i].timeSeconds;
            regionEnergySum = smoothed[i];
            regionFrameCount = 1;
        } else if (active && regionStart !== null) {
            regionEnergySum += smoothed[i];
            regionFrameCount++;
        } else if (!active && regionStart !== null) {
            const endSeconds = frames[i].timeSeconds;
            if (endSeconds - regionStart >= minDurationSeconds) {
                regions.push({
                    startSeconds: regionStart,
                    endSeconds,
                    confidence: Math.min(1, (regionEnergySum / regionFrameCount) / maxEnergy),
                });
            }
            regionStart = null;
            regionEnergySum = 0;
            regionFrameCount = 0;
        }
    }

    // Letzten offenen Bereich schließen
    if (regionStart !== null) {
        const endSeconds = frames[frames.length - 1].timeSeconds;
        if (endSeconds - regionStart >= minDurationSeconds) {
            regions.push({
                startSeconds: regionStart,
                endSeconds,
                confidence: Math.min(1, (regionEnergySum / regionFrameCount) / maxEnergy),
            });
        }
    }

    console.log("[detectActivityRegions]",
        `threshold=${threshold.toFixed(6)}`,
        `| aktive Frames: ${activeFrameCount}/${frames.length}`,
        `| Regionen: ${regions.length}`);

    return regions;
}
