import type { BpmCandidate, Onset } from "./types";

function normalizeBpm(rawBpm: number, minBpm = 80, maxBpm = 180): number {
    let bpm = rawBpm;

    while (bpm < minBpm) bpm *= 2;
    while (bpm > maxBpm) bpm /= 2;

    return Math.round(bpm);
}

export function calculateBpmCandidates(onsets: Onset[]): BpmCandidate[] {
    if (onsets.length < 6) return [];

    const scores = new Map<number, number>();

    for (let i = 0; i < onsets.length; i++) {
        for (let j = i + 1; j < Math.min(i + 10, onsets.length); j++) {
            const diff = onsets[j].timeSeconds - onsets[i].timeSeconds;

            if (diff < 0.25 || diff > 2.0) continue;

            const bpm = normalizeBpm(60 / diff);
            if (bpm < 80 || bpm > 180) continue;

            scores.set(bpm, (scores.get(bpm) || 0) + onsets[i].strength + onsets[j].strength);
        }
    }

    return [...scores.entries()]
        .map(([bpm, score]) => ({ bpm, score }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);
}

export function selectBestBpm(candidates: BpmCandidate[]): number | null {
    return candidates[0]?.bpm ?? null;
}
