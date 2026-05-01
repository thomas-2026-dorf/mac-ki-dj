import type { AlignedVocalRegion, VocalMixZone } from "./types";

export type { VocalMixZone };

const BEATS_WINDOW = 16 as const;

export function detectVocalMixZones(
    regions: AlignedVocalRegion[],
    beats: number[] | undefined,
): VocalMixZone[] {
    if (!beats || beats.length === 0 || regions.length === 0) return [];

    const zones: VocalMixZone[] = [];

    for (let idx = 0; idx < regions.length; idx++) {
        const region = regions[idx];

        // mix-in: 16 beats BEFORE vocal start
        const mixInAnchorIdx = region.startBeatIndex;
        const mixInStartIdx  = mixInAnchorIdx - BEATS_WINDOW;
        if (mixInAnchorIdx >= 0 && mixInStartIdx >= 0) {
            zones.push({
                type:                   "mix-in",
                startSeconds:           beats[mixInStartIdx],
                endSeconds:             beats[mixInAnchorIdx],
                anchorSeconds:          beats[mixInAnchorIdx],
                anchorBeatIndex:        mixInAnchorIdx,
                beatsBeforeOrAfter:     BEATS_WINDOW,
                sourceVocalRegionIndex: idx,
                confidence:             region.confidence,
                reason:                 `vocal-start beat[${mixInAnchorIdx}]`,
            });
        }

        // mix-out: 16 beats AFTER vocal end
        const mixOutAnchorIdx = region.endBeatIndex;
        const mixOutEndIdx    = mixOutAnchorIdx + BEATS_WINDOW;
        if (mixOutAnchorIdx >= 0 && mixOutEndIdx < beats.length) {
            zones.push({
                type:                   "mix-out",
                startSeconds:           beats[mixOutAnchorIdx],
                endSeconds:             beats[mixOutEndIdx],
                anchorSeconds:          beats[mixOutAnchorIdx],
                anchorBeatIndex:        mixOutAnchorIdx,
                beatsBeforeOrAfter:     BEATS_WINDOW,
                sourceVocalRegionIndex: idx,
                confidence:             region.confidence,
                reason:                 `vocal-end beat[${mixOutAnchorIdx}]`,
            });
        }
    }

    console.log(`[VocalMixZones] ${zones.length} Zone(n):`);
    for (const z of zones) {
        console.log(
            `  [${z.type}] ${z.startSeconds.toFixed(3)}s – ${z.endSeconds.toFixed(3)}s` +
            `  anchor=beat[${z.anchorBeatIndex}]=${z.anchorSeconds.toFixed(3)}s` +
            `  ±${z.beatsBeforeOrAfter} beats  conf=${z.confidence.toFixed(3)}` +
            `  (${z.reason})`
        );
    }

    return zones;
}
