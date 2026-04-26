import type { BpmCandidate, Onset } from "./types";

function normalizeBpm(rawBpm: number, minBpm = 80, maxBpm = 180): number {
    let bpm = rawBpm;

    while (bpm < minBpm) bpm *= 2;
    while (bpm > maxBpm) bpm /= 2;

    return Math.round(bpm);
}

export function calculateTempogramBpmCandidates(onsets: Onset[]): BpmCandidate[] {
    if (onsets.length < 8) return [];

    const scores = new Map<number, number>();

    for (let i = 0; i < onsets.length; i++) {
        for (let j = i + 1; j < Math.min(i + 24, onsets.length); j++) {
            const diff = onsets[j].timeSeconds - onsets[i].timeSeconds;

            if (diff < 0.25 || diff > 2.2) continue;

            const bpm = normalizeBpm(60 / diff);

            if (bpm < 80 || bpm > 180) continue;

            const distanceWeight = 1 / Math.max(1, j - i);
            const strengthWeight = onsets[i].strength + onsets[j].strength;
            const score = strengthWeight * distanceWeight;

            scores.set(bpm, (scores.get(bpm) || 0) + score);
        }
    }

    return [...scores.entries()]
        .map(([bpm, score]) => ({ bpm, score }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 12);
}
