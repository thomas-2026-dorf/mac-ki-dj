import type { WaveformPeaks } from "../modules/analysis/waveformPeaks";
import type { ActivityRegion } from "../modules/analysis/types";

export type TrackAnalysisStatus = "none" | "pending" | "done" | "error";

export type TrackCuePoint = {
    id: string;
    name: string;
    timeSeconds: number;
    type:
    | "start"
    | "intro"
    | "drum"
    | "vocal"
    | "drop"
    | "break"
    | "outro"
    | "loop"
    | "transition";
};

export type TrackLoop = {
    id: string;
    name: string;
    startSeconds: number;
    endSeconds: number;
    beats: 8 | 16 | 32 | 64;
    purpose: "transition" | "outro-builder" | "emergency";
};

export type TransitionPointRole = "loop-out" | "loop-in" | "cut-out" | "cut-in" | "passage-out" | "passage-in";

export type TransitionPoint = {
    id: string;
    role: TransitionPointRole;
    bars: 8 | 16 | 32 | null; // null = cut (kein Loop)
    timeSeconds: number;
    source: "auto" | "manual";
    label?: string;
};

export type TrackExternalAnalysis = {
    source: "mixed-in-key" | "manual" | "other";
    importedAt?: string;

    bpm?: number;
    key?: string;
    energy?: number;

    genre?: string;
    year?: number;

    mood?: "warmup" | "dance" | "peak" | "cooldown";
    rating?: number;
    comment?: string;

    cuePoints?: TrackCuePoint[];
    loops?: TrackLoop[];

    mixInSeconds?: number;
    mixOutSeconds?: number;
    introEndSeconds?: number;
    outroStartSeconds?: number;
};

export type TrackGridOffset = {
    offsetSeconds: number;
    offsetMs: number;
    stability: "ja" | "nein" | "teilweise";
    source: "eng" | "wide fallback" | "keine";
    range: string | null;
    globalGridStartSeconds?: number;
    outroOffsetSeconds?: number;
};

export type TrackAnalysis = {
    status: TrackAnalysisStatus;
    analyzedAt?: string;

    /**
     * Altbestand / Übergang:
     * Diese Felder bleiben vorerst drin, damit bestehende Komponenten nicht brechen.
     * Wir nutzen sie später nicht mehr als Hauptstrategie.
     */
    waveform?: number[];
    waveformPeaks?: WaveformPeaks;
    detectedBpm?: number;
    detectedKey?: string;
    beatGridStartSeconds?: number;
    beats?: number[];
    analysisVersion?: string;

    // Essentia-Felder (neue Hauptquelle)
    durationSeconds?: number;
    firstBeatSeconds?: number;
    scale?: string;
    camelotKey?: string;
    gridOffset?: TrackGridOffset;
    energy?: number;
    beatCount?: number;

    debug?: {
        onsetCount: number;
        bpmCandidates: number[];
        tempogramCandidates: number[];
    };

    activityRegions?: ActivityRegion[];

    bpmSource?: "auto" | "manual" | "external";
    bpmConfidence?: "high" | "medium" | "low";
    bpmConfirmed?: boolean;
    manualBpm?: number;

    introEndSeconds?: number;
    outroStartSeconds?: number;
    cuePoints: TrackCuePoint[];
    loops: TrackLoop[];

    hasDjOutro?: boolean;
    outroEditPath?: string;
    note?: string;

    /**
     * Neue Hauptstrategie:
     * externe oder manuell gepflegte DJ-Daten.
     */
    external?: TrackExternalAnalysis;
};

export type Track = {
    id: string;
    title: string;
    artist: string;

    /**
     * Diese Hauptfelder sollen später aus Mixed in Key / manueller Pflege kommen.
     */
    bpm: number;
    key: string;
    energy: number;
    genre: string;

    duration: string;
    url?: string;

    year?: number;
    mood?: "warmup" | "dance" | "peak" | "cooldown";
    favorite?: boolean;
    rating?: number;

    mixInSeconds?: number;
    mixOutSeconds?: number;
    introEndSeconds?: number;
    outroStartSeconds?: number;

    cuePoints?: TrackCuePoint[];
    loops?: TrackLoop[];
    transitionPoints?: TransitionPoint[];

    analysis?: TrackAnalysis;
};