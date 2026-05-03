export type TransitionPreset = {
    id: string;
    name: string;
    lengthBeats: number;
    fade: "none" | "fade" | "crossfade";
    eq: "none" | "bass-swap" | "hpf-filter" | "lpf-filter";
    effect: "none" | "echo-out" | "backspin" | "vinyl-brake";
    style: "soft" | "hard-cut";
    notes: string;
};

export const TRANSITION_PRESETS: TransitionPreset[] = [
    {
        id: "soft-32",
        name: "Soft 32 Beat Mix",
        lengthBeats: 32,
        fade: "crossfade",
        eq: "none",
        effect: "none",
        style: "soft",
        notes: "Langer weicher Übergang",
    },
    {
        id: "classic-16",
        name: "Classic 16 Beat Mix",
        lengthBeats: 16,
        fade: "crossfade",
        eq: "bass-swap",
        effect: "none",
        style: "soft",
        notes: "Standard DJ Übergang",
    },
    {
        id: "echo-out-8",
        name: "Echo Out",
        lengthBeats: 8,
        fade: "fade",
        eq: "none",
        effect: "echo-out",
        style: "hard-cut",
        notes: "Für harte oder unsaubere Übergänge",
    },
];

export function getTransitionPresetById(id: string): TransitionPreset | undefined {
    return TRANSITION_PRESETS.find((p) => p.id === id);
}
