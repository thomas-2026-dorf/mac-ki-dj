import { detectKey } from "./keyDetection";
import { calculateBpmCandidates, selectBestBpm } from "./bpm";
import { calculateEnergyFrames, calculateEnergyLevel } from "./energy";
import { detectOnsets } from "./onsets";
import { prepareSignal } from "./signal";
import { generateWaveform } from "./waveform";
import { detectBasicCuePoints } from "./cuepoints";
import { calculateTempogramBpmCandidates } from "./tempogram";
import { calculateBpmConfidence } from "./confidence";

import type { AudioAnalysisResult } from "./types";

export async function analyzeAudioBuffer(
    audioData: ArrayBuffer | Uint8Array,
): Promise<AudioAnalysisResult> {
    const arrayBuffer =
        audioData instanceof Uint8Array
            ? audioData.buffer.slice(
                  audioData.byteOffset,
                  audioData.byteOffset + audioData.byteLength,
              )
            : audioData;

    const audioContext = new AudioContext();

    try {
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        const signal = prepareSignal(audioBuffer);
        const energyFrames = calculateEnergyFrames(signal);
        const onsets = detectOnsets(energyFrames);
        const energyLevel = calculateEnergyLevel(energyFrames, onsets.length);

        const bpmCandidates = calculateBpmCandidates(onsets);
        const tempogramCandidates = calculateTempogramBpmCandidates(onsets);
        const bpm = selectBestBpm(bpmCandidates, tempogramCandidates);
        const bpmConfidence = calculateBpmConfidence(
            bpm,
            bpmCandidates,
            tempogramCandidates,
        );

        const waveform = generateWaveform(signal);
        const cuePoints = detectBasicCuePoints(onsets);

        const keyResult = detectKey(audioBuffer);

    return {
        key: keyResult?.keyName,
        camelotKey: keyResult?.camelotKey,
            durationSeconds: audioBuffer.duration,
            sampleRate: audioBuffer.sampleRate,
            numberOfChannels: audioBuffer.numberOfChannels,

            energyLevel,

            bpm,
            bpmConfidence,
            bpmCandidates,
            onsetCount: onsets.length,

            waveform,
            cuePoints,

            debug: {
                onsetCount: onsets.length,
                bpmCandidates: bpmCandidates.map((candidate) => candidate.bpm),
                tempogramCandidates: tempogramCandidates.map((candidate) => candidate.bpm),
            },
        };
    } finally {
        await audioContext.close();
    }
}
