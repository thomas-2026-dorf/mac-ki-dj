import { calculateGridOffsetForWindow, type GridOffsetResult } from "../audio/beatGrid";

export type GridOffsetSource = "eng" | "wide fallback" | "keine";
export type GridOffsetStabil = "ja" | "nein" | "teilweise";

export interface GridOffsetAnalysis {
    stabil: GridOffsetStabil;
    bereich: string | null;
    source: GridOffsetSource;
    medianMs: number;
    medianSec: number;
    correctedGridStart: number;
    beatMs: number;
    outroFrom: number;
    outroTo: number;
    intro: GridOffsetResult;
    outro: GridOffsetResult;
    introWide: GridOffsetResult;
    outroWide: GridOffsetResult;
}

export const GRID_OFFSET_TOL_ENG   = 120;
export const GRID_OFFSET_TOL_WIDE  = 400;
const MIN_MATCH = 8;
const MAX_PHASE = 0.45;
const MAX_DRIFT = 80;

export function computeGridOffset(input: {
    beats: number[];
    bpm: number;
    gridStart: number;
    durationSeconds: number;
}): GridOffsetAnalysis {
    const { beats, bpm, gridStart, durationSeconds } = input;

    const outroFrom = durationSeconds - 30;
    const outroTo   = durationSeconds;
    const beatMs    = (60 / bpm) * 1000;

    const intro     = calculateGridOffsetForWindow({ beats, bpm, gridStart, fromSec: 0,        toSec: 30,      maxOffsetMs: GRID_OFFSET_TOL_ENG  });
    const outro     = calculateGridOffsetForWindow({ beats, bpm, gridStart, fromSec: outroFrom, toSec: outroTo, maxOffsetMs: GRID_OFFSET_TOL_ENG  });
    const introWide = calculateGridOffsetForWindow({ beats, bpm, gridStart, fromSec: 0,        toSec: 30,      maxOffsetMs: GRID_OFFSET_TOL_WIDE });
    const outroWide = calculateGridOffsetForWindow({ beats, bpm, gridStart, fromSec: outroFrom, toSec: outroTo, maxOffsetMs: GRID_OFFSET_TOL_WIDE });

    const engIntroOk = intro.matchCount >= MIN_MATCH;
    const engOutroOk = outro.matchCount >= MIN_MATCH;
    const wideOk = (r: GridOffsetResult) =>
        r.matchCount >= MIN_MATCH && Math.abs(r.offsetMs) < MAX_PHASE * beatMs;
    const wIntroOk = wideOk(introWide);
    const wOutroOk = wideOk(outroWide);

    type EvalResult = { source: GridOffsetSource; stabil: GridOffsetStabil; bereich: string | null; chosenValues: number[] };

    function evalWindows(iOk: boolean, oOk: boolean, iMs: number, oMs: number, src: GridOffsetSource): EvalResult {
        if (iOk && oOk) {
            const s: GridOffsetStabil = Math.abs(iMs - oMs) <= MAX_DRIFT ? "ja" : "nein";
            return { source: src, stabil: s, bereich: null, chosenValues: [iMs, oMs] };
        }
        return { source: src, stabil: "teilweise", bereich: iOk ? "nur Intro" : "nur Outro", chosenValues: [iOk ? iMs : oMs] };
    }

    const result: EvalResult = (engIntroOk || engOutroOk)
        ? evalWindows(engIntroOk, engOutroOk, intro.offsetMs, outro.offsetMs, "eng")
        : (wIntroOk || wOutroOk)
            ? evalWindows(wIntroOk, wOutroOk, introWide.offsetMs, outroWide.offsetMs, "wide fallback")
            : { source: "keine", stabil: "nein", bereich: null, chosenValues: [] };

    const { source, stabil, bereich, chosenValues } = result;

    const medianMs = (() => {
        if (chosenValues.length === 0) return 0;
        const s = [...chosenValues].sort((a, b) => a - b);
        const m = Math.floor(s.length / 2);
        return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
    })();
    const medianSec = medianMs / 1000;

    return {
        stabil,
        bereich,
        source,
        medianMs,
        medianSec,
        correctedGridStart: gridStart + medianSec,
        beatMs,
        outroFrom,
        outroTo,
        intro,
        outro,
        introWide,
        outroWide,
    };
}
