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

    const firstStrongOnset = [...onsets]
        .sort((a, b) => b.strength - a.strength)
        .find((onset) => onset.timeSeconds >= 0.5);

    if (!firstStrongOnset) return [];

    return [
        {
            id: "first-beat",
            label: "Erster Beat",
            timeSeconds: firstStrongOnset.timeSeconds,
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
