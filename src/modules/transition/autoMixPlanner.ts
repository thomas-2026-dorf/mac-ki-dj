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
