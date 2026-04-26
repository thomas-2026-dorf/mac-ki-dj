export type KeyMode = "major" | "minor";

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
export const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export function scoreProfile(chroma: number[], profile: number[], rootIndex: number): number {
    let score = 0;

    for (let i = 0; i < 12; i++) {
        const shiftedIndex = (i + rootIndex) % 12;
        score += chroma[shiftedIndex] * profile[i];
    }

    return score / profile.reduce((sum, value) => sum + value, 0);
}

export function getCamelotKey(rootNote: string, mode: KeyMode): string {
    const camelotMap: Record<string, string> = {
        "G# minor": "1A",
        "B major": "1B",
        "D# minor": "2A",
        "F# major": "2B",
        "A# minor": "3A",
        "C# major": "3B",
        "F minor": "4A",
        "G# major": "4B",
        "C minor": "5A",
        "D# major": "5B",
        "G minor": "6A",
        "A# major": "6B",
        "D minor": "7A",
        "F major": "7B",
        "A minor": "8A",
        "C major": "8B",
        "E minor": "9A",
        "G major": "9B",
        "B minor": "10A",
        "D major": "10B",
        "F# minor": "11A",
        "A major": "11B",
        "C# minor": "12A",
        "E major": "12B",
    };

    return camelotMap[`${rootNote} ${mode}`] ?? "-";
}
