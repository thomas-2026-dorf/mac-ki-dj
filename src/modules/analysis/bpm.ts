import type { BpmCandidate, Onset } from "./types";

function normalizeBpm(rawBpm: number, minBpm = 80, maxBpm = 180): number {
    let bpm = rawBpm;

    while (bpm < minBpm) bpm *= 2;
    while (bpm > maxBpm) bpm /= 2;

    return Math.round(bpm);
}

function getDjTempoBonus(bpm: number): number {
    if (bpm >= 108 && bpm <= 132) return 1.4;
    if (bpm >= 88 && bpm < 108) return 1.2;
    if (bpm > 132 && bpm <= 150) return 0.75;
    if (bpm > 150) return 0.45;
    return 1;
}

export function calculateBpmCandidates(onsets: Onset[]): BpmCandidate[] {
    if (onsets.length < 6) return [];

    const scores = new Map<number, number>();

    for (let i = 0; i < onsets.length; i++) {
        for (let j = i + 1; j < Math.min(i + 12, onsets.length); j++) {
            const diff = onsets[j].timeSeconds - onsets[i].timeSeconds;

            if (diff < 0.25 || diff > 2.0) continue;

            const bpm = normalizeBpm(60 / diff);
            if (bpm < 80 || bpm > 180) continue;

            const strengthScore = onsets[i].strength + onsets[j].strength;
            const tempoBonus = getDjTempoBonus(bpm);

            scores.set(bpm, (scores.get(bpm) || 0) + strengthScore * tempoBonus);
        }
    }

    return [...scores.entries()]
        .map(([bpm, score]) => ({ bpm, score }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
}

function uniqueBpms(candidates: BpmCandidate[]): number[] {
    return [...new Set(candidates.map((candidate) => candidate.bpm))];
}

function pickMedian(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

export function selectBestBpm(
    candidates: BpmCandidate[],
    tempogramCandidates: BpmCandidate[] = [],
): number | null {
    if (candidates.length === 0 && tempogramCandidates.length === 0) return null;

    const base = candidates[0]?.bpm ?? tempogramCandidates[0].bpm;
    const combined = uniqueBpms([...candidates, ...tempogramCandidates]);

    // Fall 1: Reggae/ruhiger 80er-Bereich
    // Wenn der Gewinner sehr niedrig ist, aber 88-96 im Tempogram auftaucht,
    // ist das für viele DJ-Tracks plausibler als 83.
    if (base >= 80 && base < 88) {
        const lowTempoMatch = combined
            .filter((bpm) => bpm >= 88 && bpm <= 96)
            .sort((a, b) => Math.abs(a - 90) - Math.abs(b - 90))[0];

        if (lowTempoMatch) return lowTempoMatch;
    }

    // Fall 2: Latin/Party/Pop
    // Wenn 90er BPM gewinnt, aber mehrere Kandidaten im 120-132 Bereich liegen,
    // nehmen wir die Mitte dieses Clusters.
    if (base >= 90 && base < 100) {
        const partyCluster = combined.filter((bpm) => bpm >= 120 && bpm <= 132);

        if (partyCluster.length >= 2) {
            return pickMedian(partyCluster);
        }
    }

    return base;
}
