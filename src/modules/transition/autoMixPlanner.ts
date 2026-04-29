import { getClosestPhaseMatch, getNextBarStart } from "../audio/beatGrid";
import type { Track } from "../../types/track";

export type TransitionType = "cut" | "blend";

export type MixTransitionPlan = {
    type: TransitionType;
    outroStartSeconds: number;
    blendDurationSeconds: number;
    nextTrackOffset: number;
    playbackRate: number;
};

function parseDuration(duration: string): number {
    const parts = duration.split(":").map(Number);
    if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
    if (parts.length === 3) return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
    return 240;
}

export function planMixTransition(current: Track, next: Track): MixTransitionPlan {
    const curBpm = current.bpm || 0;
    const nextBpm = next.bpm || 0;

    const bpmDiff = curBpm > 0 && nextBpm > 0 ? Math.abs(curBpm - nextBpm) / curBpm : 1;
    const type: TransitionType = bpmDiff <= 0.08 ? "blend" : "cut";

    const barDuration = curBpm > 0 ? (4 * 60) / curBpm : 8;
    const blendBars = 8;
    const blendDurationSeconds = type === "blend" ? blendBars * barDuration : 0.05;

    const duration = parseDuration(current.duration);
    const rawOutro =
        current.outroStartSeconds ??
        current.analysis?.outroStartSeconds ??
        null;
    let outroStartSeconds = rawOutro ?? Math.max(60, duration - (blendBars + 8) * barDuration);

    const curGridStart = current.analysis?.beatGridStartSeconds ?? 0;
    if (curBpm > 0) {
        outroStartSeconds = getNextBarStart({
            time: outroStartSeconds,
            gridStart: curGridStart,
            bpm: curBpm,
        });
    }

    const nextGridStart = next.analysis?.beatGridStartSeconds ?? 0;
    const nextBpmForCalc = nextBpm || curBpm;
    let nextTrackOffset = nextGridStart;

    if (curBpm > 0 && nextBpmForCalc > 0) {
        const aligned = getClosestPhaseMatch({
            masterTime: outroStartSeconds,
            masterGridStart: curGridStart,
            masterBpm: curBpm,
            slaveTime: nextGridStart,
            slaveGridStart: nextGridStart,
            slaveBpm: nextBpmForCalc,
        });
        nextTrackOffset = Math.max(0, aligned);
    }

    const playbackRate =
        curBpm > 0 && nextBpm > 0
            ? Math.max(0.9, Math.min(1.1, curBpm / nextBpm))
            : 1.0;

    return {
        type,
        outroStartSeconds,
        blendDurationSeconds,
        nextTrackOffset,
        playbackRate,
    };
}

// ─── Automix-Entscheidungslogik ───────────────────────────────────────────────

export type AutoTransitionType = "cut" | "8" | "16" | "32" | "loop";

export type AutoTransitionDecision = {
    transitionType: AutoTransitionType;
    transitionStartTime: number; // Sekunden ab Start von trackA
};

/**
 * Entscheidet welche Übergangsart zwischen zwei Tracks gespielt wird.
 * Heuristik basierend auf BPM-Kompatibilität, Energie und Zufall.
 */
export function decideTransition(trackA: Track, trackB: Track): AutoTransitionDecision {
    const bpmA = trackA.bpm || 0;
    const bpmB = trackB.bpm || 0;
    const energyA = trackA.energy || 5;
    const energyB = trackB.energy || 5;
    const durationA = parseDuration(trackA.duration);

    const bpmDiff = bpmA > 0 && bpmB > 0 ? Math.abs(bpmA - bpmB) / bpmA : 1;
    const canBeatmatch = bpmDiff <= 0.08;
    const energyDiff = Math.abs(energyA - energyB);

    let transitionType: AutoTransitionType;

    if (!canBeatmatch) {
        // BPM zu unterschiedlich → harter Schnitt
        transitionType = "cut";
    } else if (energyA >= 8 && energyDiff >= 3) {
        // Peak-Energie mit großem Sprung → Cut oder Loop-Drop
        transitionType = Math.random() < 0.5 ? "cut" : "loop";
    } else if (energyA <= 4) {
        // Ruhiges Ende → langer Übergang
        transitionType = "32";
    } else if (energyDiff <= 2) {
        // Ähnliche Energie → mittlerer Übergang mit Variation
        const r = Math.random();
        if (r < 0.25) transitionType = "8";
        else if (r < 0.65) transitionType = "16";
        else transitionType = "32";
    } else {
        // Moderate Energie-Änderung → kurzer bis mittlerer Übergang
        transitionType = Math.random() < 0.5 ? "8" : "16";
    }

    const barDuration = bpmA > 0 ? (4 * 60) / bpmA : 8;
    const transitionBars =
        transitionType === "cut" ? 0
        : transitionType === "loop" ? 8
        : parseInt(transitionType, 10);
    const transitionDuration = transitionBars * barDuration;

    const outroStart =
        trackA.outroStartSeconds ??
        trackA.analysis?.outroStartSeconds ??
        null;

    let transitionStartTime: number;
    if (outroStart !== null) {
        transitionStartTime = outroStart;
    } else {
        const bufferBars = 2;
        transitionStartTime = Math.max(30, durationA - transitionDuration - bufferBars * barDuration);
    }

    return { transitionType, transitionStartTime };
}
