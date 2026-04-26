import { calculateBpmCandidates, selectBestBpm } from "./bpm";
import { calculateEnergyFrames } from "./energy";
import { detectOnsets } from "./onsets";
import { prepareSignal } from "./signal";
import { generateWaveform } from "./waveform";
import { detectBasicCuePoints } from "./cuepoints";

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
        const bpmCandidates = calculateBpmCandidates(onsets);
        const bpm = selectBestBpm(bpmCandidates);

        const waveform = generateWaveform(signal);
        const cuePoints = detectBasicCuePoints(onsets);

        return {
            durationSeconds: audioBuffer.duration,
            sampleRate: audioBuffer.sampleRate,
            numberOfChannels: audioBuffer.numberOfChannels,

            bpm,
            bpmCandidates,
            onsetCount: onsets.length,

            waveform,
            cuePoints,
        };
    } finally {
        await audioContext.close();
    }
}
