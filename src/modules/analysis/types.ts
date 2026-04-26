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

export type AudioAnalysisResult = {
    debug?: {
        onsetCount: number;
        bpmCandidates: number[];
        tempogramCandidates: number[];
    };
    durationSeconds: number;
    sampleRate: number;
    numberOfChannels: number;

    bpm: number | null;
    bpmCandidates: BpmCandidate[];
    onsetCount: number;

    waveform: number[];
    cuePoints: CuePoint[];
};
