import {
    getCamelotKey,
    MAJOR_PROFILE,
    MINOR_PROFILE,
    NOTE_NAMES,
    scoreProfile,
    type KeyMode,
} from "./key/keyTheory";

export type DetectedKeyResult = {
    rootNote: string;
    mode: KeyMode;
    keyName: string;
    camelotKey: string;
    confidence: number;
};

type SegmentKeyResult = {
    rootIndex: number;
    mode: KeyMode;
    score: number;
    difference: number;
};

export function detectKey(audioBuffer: AudioBuffer): DetectedKeyResult | null {
    const signal = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const duration = audioBuffer.duration;

    const segmentStarts = buildSegmentStarts(duration);
    const votes = new Map<string, number>();

    for (const startSecond of segmentStarts) {
        const chroma = buildSegmentChroma(signal, sampleRate, startSecond);
        const segmentResult = detectSegmentKey(chroma);

        if (!segmentResult) continue;

        const voteKey = `${segmentResult.rootIndex}:${segmentResult.mode}`;
        const currentVote = votes.get(voteKey) ?? 0;
        votes.set(voteKey, currentVote + Math.max(0.1, segmentResult.difference * 10));
    }

    if (votes.size === 0) return null;

    const sortedVotes = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    const [winnerKey, winnerScore] = sortedVotes[0];
    const secondScore = sortedVotes[1]?.[1] ?? 0;

    const [rootIndexText, modeText] = winnerKey.split(":");
    const rootIndex = Number(rootIndexText);
    const mode = modeText as KeyMode;
    const rootNote = NOTE_NAMES[rootIndex];

    const confidence = Math.max(
        1,
        Math.min(10, Math.round((winnerScore - secondScore) * 2)),
    );

    return {
        rootNote,
        mode,
        keyName: `${rootNote} ${mode === "major" ? "Major" : "Minor"}`,
        camelotKey: getCamelotKey(rootNote, mode),
        confidence,
    };
}

function buildSegmentStarts(durationSeconds: number): number[] {
    const preferredStarts = [20, 45, 70, 95, 120, 150];
    const validStarts = preferredStarts.filter((start) => start + 12 < durationSeconds);

    if (validStarts.length > 0) return validStarts;

    return [Math.max(0, Math.floor(durationSeconds * 0.25))];
}

function detectSegmentKey(chroma: number[]): SegmentKeyResult | null {
    if (chroma.every((value) => value === 0)) return null;

    let bestScore = -Infinity;
    let secondBestScore = -Infinity;
    let bestRootIndex = 0;
    let bestMode: KeyMode = "major";

    for (let rootIndex = 0; rootIndex < 12; rootIndex++) {
        const results = [
            { score: scoreProfile(chroma, MAJOR_PROFILE, rootIndex), mode: "major" as const },
            { score: scoreProfile(chroma, MINOR_PROFILE, rootIndex), mode: "minor" as const },
        ];

        for (const result of results) {
            if (result.score > bestScore) {
                secondBestScore = bestScore;
                bestScore = result.score;
                bestRootIndex = rootIndex;
                bestMode = result.mode;
            } else if (result.score > secondBestScore) {
                secondBestScore = result.score;
            }
        }
    }

    return {
        rootIndex: bestRootIndex,
        mode: bestMode,
        score: bestScore,
        difference: Math.max(0, bestScore - secondBestScore),
    };
}

function buildSegmentChroma(signal: Float32Array, sampleRate: number, startSecond: number): number[] {
    const chroma = new Array(12).fill(0) as number[];

    const frameSize = 4096;
    const framesPerSegment = 5;
    const hopSeconds = 2;

    for (let frame = 0; frame < framesPerSegment; frame++) {
        const start = Math.floor((startSecond + frame * hopSeconds) * sampleRate);
        if (start + frameSize >= signal.length) break;

        for (let noteIndex = 0; noteIndex < 12; noteIndex++) {
            for (let octave = 2; octave <= 5; octave++) {
                const midi = 12 * (octave + 1) + noteIndex;
                const frequency = 440 * Math.pow(2, (midi - 69) / 12);

                if (frequency < 80 || frequency > 1200) continue;

                const magnitude = goertzelMagnitude(signal, start, frameSize, sampleRate, frequency);
                const bassWeight = frequency < 220 ? 1.8 : frequency < 440 ? 1.25 : 0.7;

                chroma[noteIndex] += magnitude * bassWeight;
            }
        }
    }

    const maxValue = Math.max(...chroma);
    if (maxValue === 0) return chroma;

    return chroma.map((value) => value / maxValue);
}

function goertzelMagnitude(
    signal: Float32Array,
    start: number,
    frameSize: number,
    sampleRate: number,
    targetFrequency: number,
): number {
    const k = Math.round((frameSize * targetFrequency) / sampleRate);
    const omega = (2 * Math.PI * k) / frameSize;
    const coeff = 2 * Math.cos(omega);

    let q0 = 0;
    let q1 = 0;
    let q2 = 0;

    for (let i = 0; i < frameSize; i++) {
        const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frameSize - 1));
        q0 = coeff * q1 - q2 + signal[start + i] * window;
        q2 = q1;
        q1 = q0;
    }

    return Math.sqrt(q1 * q1 + q2 * q2 - q1 * q2 * coeff);
}
