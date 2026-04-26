import type { Onset } from "./types";

export type CuePoint = {
    id: string;
    label: string;
    timeSeconds: number;
    kind:
        | "first_beat"
        | "vocal_in"
        | "vocal_minus_32"
        | "vocal_minus_16"
        | "vocal_minus_8"
        | "intro"
        | "outro"
        | "custom";
};

export function detectBasicCuePoints(onsets: Onset[]): CuePoint[] {
    if (onsets.length === 0) return [];

    const introOnsets = onsets.filter(
        (onset) => onset.timeSeconds >= 0.5 && onset.timeSeconds <= 20,
    );

    const fallbackOnsets = onsets.filter(
        (onset) => onset.timeSeconds >= 0.5 && onset.timeSeconds <= 40,
    );

    const candidates = introOnsets.length > 0 ? introOnsets : fallbackOnsets;

    if (candidates.length === 0) return [];

    const averageStrength =
        candidates.reduce((sum, onset) => sum + onset.strength, 0) / candidates.length;

    const firstUsableOnset =
        candidates.find((onset) => onset.strength >= averageStrength * 0.75) ?? candidates[0];

    return [
        {
            id: "first-beat",
            label: "Erster Beat / Intro",
            timeSeconds: firstUsableOnset.timeSeconds,
            kind: "first_beat",
        },
    ];
}

export function createVocalPreparationCuePoints(
    vocalInSeconds: number,
    bpm: number | null,
): CuePoint[] {
    if (!bpm || bpm <= 0) return [];

    const beatSeconds = 60 / bpm;

    const cueOffsets = [
        { beats: 32, kind: "vocal_minus_32" as const, label: "32 Beats vor Gesang" },
        { beats: 16, kind: "vocal_minus_16" as const, label: "16 Beats vor Gesang" },
        { beats: 8, kind: "vocal_minus_8" as const, label: "8 Beats vor Gesang" },
    ];

    return [
        {
            id: "vocal-in",
            label: "Erster Gesang",
            timeSeconds: vocalInSeconds,
            kind: "vocal_in",
        },
        ...cueOffsets
            .map((cue) => ({
                id: cue.kind,
                label: cue.label,
                timeSeconds: vocalInSeconds - cue.beats * beatSeconds,
                kind: cue.kind,
            }))
            .filter((cue) => cue.timeSeconds >= 0),
    ];
}
