import type { VocalCandidateRegion } from "./types";

export type { VocalCandidateRegion };

export type VocalPrepFrame = {
    timeSeconds: number;
    energy: number;
    centroid: number;
    zcr: number;
    midEnergy: number;
};

const CENTROID_LOW_HZ  = 300;
const CENTROID_HIGH_HZ = 2500;
const MIN_REGION_SEC   = 1.5;
const MAX_GAP_SEC      = 0.6;

function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length)));
    return sorted[idx];
}

export function detectVocalCandidateRegions(frames: VocalPrepFrame[]): VocalCandidateRegion[] {
    if (frames.length < 2) return [];

    // Dynamic thresholds from distribution
    const sortedEnergy    = [...frames.map(f => f.energy)].sort((a, b) => a - b);
    const sortedMidEnergy = [...frames.map(f => f.midEnergy)].sort((a, b) => a - b);
    const zcrs            = frames.map(f => f.zcr);

    const energyThresh    = percentile(sortedEnergy, 40);
    const midEnergyThresh = percentile(sortedMidEnergy, 40);

    const meanZCR = zcrs.reduce((s, v) => s + v, 0) / zcrs.length;
    const stdZCR  = Math.sqrt(zcrs.reduce((s, v) => s + (v - meanZCR) ** 2, 0) / zcrs.length);
    const zcrThresh = meanZCR + 1.5 * stdZCR;

    console.log("[VocalCandidates] Schwellenwerte:",
        { energyThreshold: energyThresh.toFixed(6), midEnergyThreshold: midEnergyThresh.toFixed(6), zcrUpperLimit: zcrThresh.toFixed(4) });

    const frameDur  = frames[1].timeSeconds - frames[0].timeSeconds;
    const gapFrames = Math.ceil(MAX_GAP_SEC / frameDur);

    // Pass 1: raw candidate flags
    const isCand: boolean[] = frames.map(f =>
        f.energy    > energyThresh    &&
        f.midEnergy > midEnergyThresh &&
        f.centroid  >= CENTROID_LOW_HZ && f.centroid <= CENTROID_HIGH_HZ &&
        f.zcr       < zcrThresh
    );

    // Pass 2: close small gaps between candidate runs
    for (let i = 0; i < isCand.length; ) {
        if (!isCand[i]) { i++; continue; }
        let runEnd = i;
        while (runEnd < isCand.length && isCand[runEnd]) runEnd++;
        let nextStart = runEnd;
        while (nextStart < isCand.length && !isCand[nextStart]) nextStart++;
        const gap = nextStart - runEnd;
        if (gap > 0 && gap <= gapFrames && nextStart < isCand.length) {
            for (let j = runEnd; j < nextStart; j++) isCand[j] = true;
            i = nextStart;
        } else {
            i = runEnd;
        }
    }

    // Pass 3: extract runs, filter by min duration, compute confidence
    const regions: VocalCandidateRegion[] = [];
    let start = -1;

    for (let i = 0; i <= isCand.length; i++) {
        if (i < isCand.length && isCand[i]) {
            if (start === -1) start = i;
        } else if (start !== -1) {
            const startSec = frames[start].timeSeconds;
            const endSec   = frames[i - 1].timeSeconds + frameDur;
            if (endSec - startSec >= MIN_REGION_SEC) {
                const slice = frames.slice(start, i);
                const confidence = Math.min(1,
                    slice.reduce((s, f) =>
                        s + (f.midEnergy / midEnergyThresh * 0.6 + f.energy / energyThresh * 0.4), 0
                    ) / slice.length
                );
                regions.push({
                    startSeconds: startSec,
                    endSeconds:   endSec,
                    confidence:   Math.min(1, confidence),
                    reason:       "energy+midEnergy+centroid+zcr",
                });
            }
            start = -1;
        }
    }

    console.log(`[VocalCandidates] ${regions.length} Region(en) gefunden:`);
    for (const r of regions) {
        console.log(`  ${r.startSeconds.toFixed(2)}s – ${r.endSeconds.toFixed(2)}s` +
            `  (${(r.endSeconds - r.startSeconds).toFixed(2)}s)` +
            `  conf=${r.confidence.toFixed(3)}  [${r.reason}]`);
    }

    return regions;
}

const MAIN_PRE_FILTER_MIN_DURATION_SEC  = 8;
const MAIN_MIN_CONFIDENCE               = 0.6;
const MAIN_VOCAL_MERGE_GAP_SECONDS      = 20;
const MAIN_POST_MERGE_MIN_DURATION_SEC  = 20;
const MAIN_HIGH_CONFIDENCE_EXCEPTION    = 0.85;

export function selectMainVocalRegions(regions: VocalCandidateRegion[]): VocalCandidateRegion[] {
    // Step 1: pre-filter — drop very short or low-confidence candidates
    const filtered = regions.filter(r =>
        (r.endSeconds - r.startSeconds) >= MAIN_PRE_FILTER_MIN_DURATION_SEC &&
        r.confidence >= MAIN_MIN_CONFIDENCE
    );

    if (filtered.length === 0) {
        console.log("[MainVocalRegions] 0 Regionen nach Filter (zu kurz oder zu niedrige Confidence)");
        return [];
    }

    // Step 2: merge regions whose gap is <= MAIN_VOCAL_MERGE_GAP_SECONDS
    type MergedRegion = VocalCandidateRegion & { gapMerged: boolean };
    const merged: MergedRegion[] = [];
    let current: MergedRegion = { ...filtered[0], gapMerged: false };

    for (let i = 1; i < filtered.length; i++) {
        const next = filtered[i];
        const gap = next.startSeconds - current.endSeconds;
        if (gap <= MAIN_VOCAL_MERGE_GAP_SECONDS) {
            current = {
                ...current,
                endSeconds:  next.endSeconds,
                confidence:  Math.max(current.confidence, next.confidence),
                gapMerged:   true,
            };
        } else {
            merged.push(current);
            current = { ...next, gapMerged: false };
        }
    }
    merged.push(current);

    // Step 3: post-merge filter — drop regions still too short, unless high confidence
    const result = merged.filter(r =>
        (r.endSeconds - r.startSeconds) >= MAIN_POST_MERGE_MIN_DURATION_SEC ||
        r.confidence >= MAIN_HIGH_CONFIDENCE_EXCEPTION
    );

    console.log(`[MainVocalRegions] ${result.length} Haupt-Region(en)` +
        ` (${regions.length} Kandidaten → ${filtered.length} nach Vorfilter → ${merged.length} nach Merge → ${result.length} nach Mindestdauer):`);
    for (const r of result) {
        const dur = r.endSeconds - r.startSeconds;
        console.log(
            `  ${r.startSeconds.toFixed(2)}s – ${r.endSeconds.toFixed(2)}s` +
            `  (${dur.toFixed(2)}s)` +
            `  conf=${r.confidence.toFixed(3)}` +
            `  gap-merge=${r.gapMerged ? "ja" : "nein"}`
        );
    }

    return result;
}

// Sliding-window-based main vocal region detector — works on raw frames, not on pre-merged candidates
const SLIDING_WINDOW_SEC     = 8;    // window length (~16 beats at 120 BPM)
const SLIDING_STEP_SEC       = 2;    // step between windows (~4 beats)
const VOCAL_DENSITY_THRESH   = 0.45; // min fraction of candidate frames per window
const WINDOW_MIN_CONFIDENCE  = 0.55; // min avg score per window

export function detectMainVocalRegionsFromFrames(frames: VocalPrepFrame[]): VocalCandidateRegion[] {
    if (frames.length < 2) return [];

    // Reuse same dynamic thresholds as detectVocalCandidateRegions
    const sortedEnergy    = [...frames.map(f => f.energy)].sort((a, b) => a - b);
    const sortedMidEnergy = [...frames.map(f => f.midEnergy)].sort((a, b) => a - b);
    const zcrs            = frames.map(f => f.zcr);
    const energyThresh    = percentile(sortedEnergy, 40);
    const midEnergyThresh = percentile(sortedMidEnergy, 40);
    const meanZCR = zcrs.reduce((s, v) => s + v, 0) / zcrs.length;
    const stdZCR  = Math.sqrt(zcrs.reduce((s, v) => s + (v - meanZCR) ** 2, 0) / zcrs.length);
    const zcrThresh = meanZCR + 1.5 * stdZCR;

    const frameDur     = frames[1].timeSeconds - frames[0].timeSeconds;
    const windowFrames = Math.round(SLIDING_WINDOW_SEC / frameDur);
    const stepFrames   = Math.round(SLIDING_STEP_SEC / frameDur);

    // Per-frame candidate flag and score
    const isCand = frames.map(f =>
        f.energy    > energyThresh    &&
        f.midEnergy > midEnergyThresh &&
        f.centroid  >= CENTROID_LOW_HZ && f.centroid <= CENTROID_HIGH_HZ &&
        f.zcr       < zcrThresh
    );
    const score = frames.map((f, i) => isCand[i]
        ? Math.min(1, f.midEnergy / midEnergyThresh * 0.6 + f.energy / energyThresh * 0.4)
        : 0
    );

    // Mark each frame as covered by at least one vocal-dense window
    const inVocalWindow = new Uint8Array(frames.length);
    for (let i = 0; i + windowFrames <= frames.length; i += stepFrames) {
        const end = i + windowFrames;
        let candCount = 0;
        let scoreSum  = 0;
        for (let j = i; j < end; j++) { if (isCand[j]) candCount++; scoreSum += score[j]; }
        const density  = candCount / windowFrames;
        const avgScore = scoreSum  / windowFrames;
        if (density >= VOCAL_DENSITY_THRESH && avgScore >= WINDOW_MIN_CONFIDENCE) {
            for (let j = i; j < end; j++) inVocalWindow[j] = 1;
        }
    }

    // Extract contiguous runs of covered frames → regions
    const regions: VocalCandidateRegion[] = [];
    let start = -1;
    for (let i = 0; i <= frames.length; i++) {
        if (i < frames.length && inVocalWindow[i]) {
            if (start === -1) start = i;
        } else if (start !== -1) {
            const regionScore = score.slice(start, i);
            const confidence  = Math.min(1,
                regionScore.reduce((s, v) => s + v, 0) / regionScore.length
            );
            regions.push({
                startSeconds: frames[start].timeSeconds,
                endSeconds:   frames[i - 1].timeSeconds + frameDur,
                confidence,
                reason:       "sliding-window-density",
            });
            start = -1;
        }
    }

    console.log(`[MainVocalRegions/SlidingWindow] ${regions.length} Region(en)` +
        ` (Fenster ${SLIDING_WINDOW_SEC}s / Schritt ${SLIDING_STEP_SEC}s / Dichte ≥${VOCAL_DENSITY_THRESH}):`);
    for (const r of regions) {
        console.log(
            `  ${r.startSeconds.toFixed(2)}s – ${r.endSeconds.toFixed(2)}s` +
            `  (${(r.endSeconds - r.startSeconds).toFixed(2)}s)` +
            `  conf=${r.confidence.toFixed(3)}`
        );
    }

    return regions;
}
