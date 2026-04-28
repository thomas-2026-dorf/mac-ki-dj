import { getClosestPhaseMatch } from "./beatGrid";

export type DeckSyncInput = {
    masterTime: number;
    masterBpm: number;
    masterGridStart: number;

    slaveTime: number;
    slaveBpm: number;
    slaveGridStart: number;
};

export type DeckSyncPlan = {
    playbackRate: number;
    pitchPercent: number;
    targetTime: number;
    reason: string;
};

export function buildDeckSyncPlan(input: DeckSyncInput): DeckSyncPlan | null {
    if (input.masterBpm <= 0 || input.slaveBpm <= 0) return null;

    const playbackRate = input.masterBpm / input.slaveBpm;
    const pitchPercent = (playbackRate - 1) * 100;

    const targetTime = getClosestPhaseMatch({
        masterTime: input.masterTime,
        masterGridStart: input.masterGridStart,
        slaveTime: input.slaveTime,
        slaveGridStart: input.slaveGridStart,
        bpm: input.masterBpm,
    });

    return {
        playbackRate,
        pitchPercent,
        targetTime,
        reason: "Slave wird auf gleiche 1-2-3-4-Phase wie Master gesetzt.",
    };
}
