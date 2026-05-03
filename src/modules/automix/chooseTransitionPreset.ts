import { TRANSITION_PRESETS } from "./transitionPresets";
import type { TransitionPreset } from "./transitionPresets";

type ChooseContext = {
    masterBpm: number;
    slaveBpm: number;
    masterHasVocal: boolean;
    slaveHasVocal: boolean;
};

export function chooseTransitionPreset(context: ChooseContext): TransitionPreset {
    const { masterBpm, slaveBpm, masterHasVocal, slaveHasVocal } = context;

    const bpmDiff = Math.abs(masterBpm - slaveBpm);

    if (bpmDiff > 5) {
        return TRANSITION_PRESETS.find((p) => p.id === "echo-out-8")!;
    }

    if (masterHasVocal && slaveHasVocal) {
        return TRANSITION_PRESETS.find((p) => p.id === "classic-16")!;
    }

    return TRANSITION_PRESETS.find((p) => p.id === "soft-32")!;
}
