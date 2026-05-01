import type { VocalCandidateRegion, AlignedVocalRegion } from "./types";

export type { AlignedVocalRegion };

// Returns index of the last beat <= targetSeconds, or 0 if none found.
function beatFloor(beats: number[], targetSeconds: number): number {
    let idx = 0;
    for (let i = 0; i < beats.length; i++) {
        if (beats[i] <= targetSeconds) idx = i;
        else break;
    }
    return idx;
}

// Returns index of the first beat >= targetSeconds, or last index if none found.
function beatCeil(beats: number[], targetSeconds: number): number {
    for (let i = 0; i < beats.length; i++) {
        if (beats[i] >= targetSeconds) return i;
    }
    return beats.length - 1;
}

export function alignVocalRegionsToBeats(
    regions: VocalCandidateRegion[],
    beats: number[] | undefined,
): AlignedVocalRegion[] {
    const noBeats = (r: VocalCandidateRegion): AlignedVocalRegion => ({
        startSeconds:           r.startSeconds,
        endSeconds:             r.endSeconds,
        originalStartSeconds:   r.startSeconds,
        originalEndSeconds:     r.endSeconds,
        startBeatIndex:         -1,
        endBeatIndex:           -1,
        confidence:             r.confidence,
        phraseStart8BeatIndex:  null,
        phraseStart8Seconds:    null,
        phraseStart16BeatIndex: null,
        phraseStart16Seconds:   null,
        phraseEnd8BeatIndex:    null,
        phraseEnd8Seconds:      null,
        phraseEnd16BeatIndex:   null,
        phraseEnd16Seconds:     null,
    });

    if (!beats || beats.length === 0) {
        return regions.map(noBeats);
    }

    const aligned = regions.map(r => {
        const startIdx = beatFloor(beats, r.startSeconds);
        const endIdx   = beatCeil(beats, r.endSeconds);

        const ps8Idx  = startIdx - 8  >= 0 ? startIdx - 8  : null;
        const ps16Idx = startIdx - 16 >= 0 ? startIdx - 16 : null;
        const pe8Idx  = endIdx   - 8  >= 0 ? endIdx   - 8  : null;
        const pe16Idx = endIdx   - 16 >= 0 ? endIdx   - 16 : null;

        return {
            startSeconds:           beats[startIdx],
            endSeconds:             beats[endIdx],
            originalStartSeconds:   r.startSeconds,
            originalEndSeconds:     r.endSeconds,
            startBeatIndex:         startIdx,
            endBeatIndex:           endIdx,
            confidence:             r.confidence,
            phraseStart8BeatIndex:  ps8Idx,
            phraseStart8Seconds:    ps8Idx  !== null ? beats[ps8Idx]  : null,
            phraseStart16BeatIndex: ps16Idx,
            phraseStart16Seconds:   ps16Idx !== null ? beats[ps16Idx] : null,
            phraseEnd8BeatIndex:    pe8Idx,
            phraseEnd8Seconds:      pe8Idx  !== null ? beats[pe8Idx]  : null,
            phraseEnd16BeatIndex:   pe16Idx,
            phraseEnd16Seconds:     pe16Idx !== null ? beats[pe16Idx] : null,
        };
    });

    console.log("[AlignedVocalRegions]", aligned.length, "Region(en):");
    for (const r of aligned) {
        const snapStart = (r.startSeconds - r.originalStartSeconds) * 1000;
        const snapEnd   = (r.endSeconds   - r.originalEndSeconds)   * 1000;
        console.log(
            `  beats[${r.startBeatIndex}]=${r.startSeconds.toFixed(3)}s` +
            ` (snap ${snapStart >= 0 ? "+" : ""}${snapStart.toFixed(0)}ms)` +
            ` – beats[${r.endBeatIndex}]=${r.endSeconds.toFixed(3)}s` +
            ` (snap ${snapEnd >= 0 ? "+" : ""}${snapEnd.toFixed(0)}ms)` +
            `  conf=${r.confidence.toFixed(3)}` +
            `  |  phraseStart: -8=beats[${r.phraseStart8BeatIndex ?? "–"}]=${r.phraseStart8Seconds?.toFixed(3) ?? "–"}s` +
            ` -16=beats[${r.phraseStart16BeatIndex ?? "–"}]=${r.phraseStart16Seconds?.toFixed(3) ?? "–"}s` +
            `  |  phraseEnd: -8=beats[${r.phraseEnd8BeatIndex ?? "–"}]=${r.phraseEnd8Seconds?.toFixed(3) ?? "–"}s` +
            ` -16=beats[${r.phraseEnd16BeatIndex ?? "–"}]=${r.phraseEnd16Seconds?.toFixed(3) ?? "–"}s`
        );
    }

    return aligned;
}
