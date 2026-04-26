export type PreparedSignal = {
    samples: Float32Array;
    sampleRate: number;
    durationSeconds: number;
};

export type EnergyFrame = {
    index: number;
    timeSeconds: number;
    energy: number;
};

export type Onset = {
    timeSeconds: number;
    strength: number;
};

export type BpmCandidate = {
    bpm: number;
    score: number;
};

export type AudioAnalysisResult = {
    durationSeconds: number;
    sampleRate: number;
    numberOfChannels: number;

    bpm: number | null;

    bpmCandidates: BpmCandidate[];
    onsetCount: number;
};
