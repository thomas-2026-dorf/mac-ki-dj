import type { TransitionPoint } from "../../types/track";
import { chooseTransitionPreset } from "./chooseTransitionPreset";

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
        vocalStartSeconds?: number;
    };
    beatsBeforeVocalEnd?: number;
};

export type MixPlan = {
    mixStartBeat: number;
    mixStartTimeSeconds: number;
    slaveStartBeat: number;
    slaveStartTimeSeconds: number;
    slaveVocalStartBeat?: number;
    secondsPerBeatMaster: number;
    lengthBeats: number;
    presetId: string;
    presetName: string;
};

function getTimeFromBeat(beat: number, firstBeatSeconds: number, secondsPerBeat: number): number {
    return firstBeatSeconds + beat * secondsPerBeat;
}

export function createMixPlan(input: MixPlanInput): MixPlan {
    const { master, slave } = input;

    const secondsPerBeatMaster = 60 / master.bpm;

    const preset = chooseTransitionPreset({
        masterBpm: master.bpm,
        slaveBpm: slave.bpm,
        masterHasVocal: typeof master.vocalEndSeconds === "number",
        slaveHasVocal: typeof slave.vocalStartSeconds === "number",
    });

    const loopOutPoint = master.transitionPoints
        ?.filter((tp) => tp.role === "loop-out")
        .sort((a, b) => b.timeSeconds - a.timeSeconds)[0] ?? null;

    let lengthBeats: number;
    if (loopOutPoint?.lengthBeats != null) {
        lengthBeats = loopOutPoint.lengthBeats;
    } else if (loopOutPoint?.bars != null) {
        lengthBeats = loopOutPoint.bars;
    } else {
        lengthBeats = preset.lengthBeats;
    }

    const secondsPerBeatSlave = 60 / slave.bpm;

    const vocalEndBeat = (master.vocalEndSeconds - master.firstBeatSeconds) / secondsPerBeatMaster;
    const mixStartBeat = vocalEndBeat - lengthBeats;
    const mixStartTimeSeconds = getTimeFromBeat(mixStartBeat, master.firstBeatSeconds, secondsPerBeatMaster);

    let slaveVocalStartBeat: number | undefined;
    let slaveStartBeat: number;

    if (typeof slave.vocalStartSeconds === "number") {
        slaveVocalStartBeat = (slave.vocalStartSeconds - slave.firstBeatSeconds) / secondsPerBeatSlave;
        slaveStartBeat = Math.max(1, slaveVocalStartBeat - lengthBeats);
    } else {
        slaveStartBeat = 1;
    }

    const slaveStartTimeSeconds = getTimeFromBeat(slaveStartBeat, slave.firstBeatSeconds, secondsPerBeatSlave);

    console.log("Preset gewählt:", preset.name);
    console.log("Preset Beats:", preset.lengthBeats);
    console.log("Loop-Out gefunden:", !!loopOutPoint);
    if (loopOutPoint) {
        console.log("Loop-Out Time:", loopOutPoint.timeSeconds);
        console.log("→ verwendet lengthBeats vom Punkt");
    } else {
        console.log("→ verwendet Preset");
    }
    console.log("Loop-Out Beats:", lengthBeats);
    console.log("Mix Start Beat:", mixStartBeat);
    console.log("Mix Start Time:", mixStartTimeSeconds);
    console.log("Slave Vocal Start vorhanden:", typeof slave.vocalStartSeconds === "number");
    console.log("Slave Vocal Start Beat:", slaveVocalStartBeat);
    console.log("Slave Start Beat:", slaveStartBeat);
    console.log("Slave Start Time (s):", slaveStartTimeSeconds.toFixed(2));

    return {
        mixStartBeat,
        mixStartTimeSeconds,
        slaveStartBeat,
        slaveStartTimeSeconds,
        slaveVocalStartBeat,
        secondsPerBeatMaster,
        lengthBeats,
        presetId: preset.id,
        presetName: preset.name,
    };
}
