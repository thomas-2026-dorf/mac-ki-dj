import type { TransitionPoint } from "../../types/track";

export type MixPlanInput = {
    master: {
        bpm: number;
        firstBeatSeconds: number;
        vocalEndSeconds: number;
        transitionPoints?: TransitionPoint[];
    };
    slave: {
        bpm: number;
        firstBeatSeconds: number;
    };
    beatsBeforeVocalEnd?: number;
};

export type MixPlan = {
    mixStartBeat: number;
    mixStartTimeSeconds: number;
    slaveStartTimeSeconds: number;
    secondsPerBeatMaster: number;
    lengthBeats: number;
};

function getTimeFromBeat(beat: number, firstBeatSeconds: number, secondsPerBeat: number): number {
    return firstBeatSeconds + beat * secondsPerBeat;
}

export function createMixPlan(input: MixPlanInput): MixPlan {
    const { master, slave, beatsBeforeVocalEnd } = input;

    const secondsPerBeatMaster = 60 / master.bpm;

    const loopOutPoint = master.transitionPoints
        ?.filter((tp) => tp.role === "loop-out")
        .sort((a, b) => b.timeSeconds - a.timeSeconds)[0] ?? null;

    let lengthBeats: number;
    if (loopOutPoint?.lengthBeats != null) {
        lengthBeats = loopOutPoint.lengthBeats;
    } else if (loopOutPoint?.bars != null) {
        lengthBeats = loopOutPoint.bars;
    } else if (beatsBeforeVocalEnd != null) {
        lengthBeats = beatsBeforeVocalEnd;
    } else {
        lengthBeats = 16;
    }

    const vocalEndBeat = (master.vocalEndSeconds - master.firstBeatSeconds) / secondsPerBeatMaster;
    const mixStartBeat = vocalEndBeat - lengthBeats;
    const mixStartTimeSeconds = getTimeFromBeat(mixStartBeat, master.firstBeatSeconds, secondsPerBeatMaster);
    const slaveStartTimeSeconds = slave.firstBeatSeconds;

    console.log("Loop-Out gefunden:", !!loopOutPoint);
    console.log("Loop-Out Beats:", lengthBeats);
    if (loopOutPoint) {
        console.log("Loop-Out Time:", loopOutPoint.timeSeconds);
    }
    console.log("Mix Start Beat:", mixStartBeat);
    console.log("Mix Start Time:", mixStartTimeSeconds);

    return {
        mixStartBeat,
        mixStartTimeSeconds,
        slaveStartTimeSeconds,
        secondsPerBeatMaster,
        lengthBeats,
    };
}
