export type TrackAnalysisStatus = "none" | "pending" | "done" | "error";

export type TrackCuePoint = {
    id: string;
    name: string;
    timeSeconds: number;
    type: "start" | "intro" | "drum" | "vocal" | "drop" | "break" | "outro" | "loop" | "transition";
};

export type TrackLoop = {
    id: string;
    name: string;
    startSeconds: number;
    endSeconds: number;
    beats: 8 | 16 | 32 | 64;
    purpose: "transition" | "outro-builder" | "emergency";
};

export type TrackAnalysis = {
    waveform?: number[];

    debug?: {
        onsetCount: number;
        bpmCandidates: number[];
        tempogramCandidates: number[];
    };

    status: TrackAnalysisStatus;
    analyzedAt?: string;
    detectedBpm?: number;
    beatGridStartSeconds?: number;

    bpmSource?: "auto" | "manual";
    bpmConfidence?: "high" | "medium" | "low";
    bpmConfirmed?: boolean;
    manualBpm?: number;

    detectedKey?: string;
    introEndSeconds?: number;
    outroStartSeconds?: number;
    cuePoints: TrackCuePoint[];
    loops: TrackLoop[];
    hasDjOutro?: boolean;
    outroEditPath?: string;
    note?: string;
};

export type Track = {
    id: string;
    title: string;
    artist: string;
    bpm: number;
    key: string;
    energy: number;
    duration: string;
    genre: string;
    url?: string;
    analysis?: TrackAnalysis;
};
