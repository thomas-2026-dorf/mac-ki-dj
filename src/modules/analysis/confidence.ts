import type { BpmCandidate } from "./types";

export type BpmConfidence = "high" | "medium" | "low";

export function calculateBpmConfidence(
    selectedBpm: number | null,
    candidates: BpmCandidate[],
    tempogramCandidates: BpmCandidate[],
): BpmConfidence {
    if (!selectedBpm) return "low";

    const candidateBpms = candidates.map((candidate) => candidate.bpm);
    const tempogramBpms = tempogramCandidates.map((candidate) => candidate.bpm);

    const appearsInBoth =
        candidateBpms.includes(selectedBpm) && tempogramBpms.includes(selectedBpm);

    const nearbyTempogramMatch = tempogramBpms.some(
        (bpm) => Math.abs(bpm - selectedBpm) <= 2,
    );

    const topCandidate = candidates[0]?.bpm;
    const topTempogram = tempogramCandidates[0]?.bpm;

    const topSourcesAgree =
        topCandidate !== undefined &&
        topTempogram !== undefined &&
        Math.abs(topCandidate - topTempogram) <= 2;

    if (appearsInBoth && topSourcesAgree) return "high";
    if (appearsInBoth || nearbyTempogramMatch) return "medium";

    return "low";
}
