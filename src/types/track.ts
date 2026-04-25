export type TrackAnalysisStatus = "none" | "pending" | "done" | "error";

export type TrackCuePoint = {
    id: string;
    name: string;
    timeSeconds: number;
    type: "start" | "intro" | "drop" | "break" | "outro" | "loop";
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
    status: TrackAnalysisStatus;
    analyzedAt?: string;
    detectedBpm?: number;
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