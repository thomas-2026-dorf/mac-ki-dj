import { detectKey } from "./keyDetection";
import { calculateBpmCandidates, selectBestBpm } from "./bpm";
import { calculateEnergyFrames, calculateEnergyLevel, detectActivityRegions } from "./energy";
import { detectOnsets } from "./onsets";
import { prepareSignal } from "./signal";
import { generateWaveform } from "./waveform";
import { detectBasicCuePoints } from "./cuepoints";
import { calculateTempogramBpmCandidates } from "./tempogram";
import { calculateBpmConfidence } from "./confidence";
import { classifyVocalInstrumental } from "./vocalClassifier";

import type { AudioAnalysisResult } from "./types";

// --- Isolierter YAMNet-Test (temporär, läuft parallel zur Analyse) ---
async function runYAMNetTest(audioBuffer: AudioBuffer): Promise<void> {
    const sr = audioBuffer.sampleRate;
    const ch0 = audioBuffer.getChannelData(0);
    const dur = audioBuffer.duration;

    const clips: Array<{ label: string; start: number; end: number }> = [
        { label: "Vocal (131–134s)",        start: 131, end: 134 },
        { label: "Intro/Instr (20–23s)",    start: 20,  end: 23  },
    ];

    for (const clip of clips) {
        if (clip.end > dur) {
            console.log(`[YAMNetRealTest] ${clip.label} — Track zu kurz (${dur.toFixed(1)}s), übersprungen`);
            continue;
        }
        const startIdx = Math.floor(clip.start * sr);
        const endIdx   = Math.min(Math.floor(clip.end * sr), ch0.length);
        const samples  = ch0.slice(startIdx, endIdx);

        console.log(`[YAMNetRealTest] Starte Clip: ${clip.label}  (${samples.length} Samples @ ${sr} Hz)`);
        const result = await classifyVocalInstrumental({
            samples,
            sampleRate: sr,
            startSeconds: clip.start,
            endSeconds:   clip.end,
        });
        console.log(`[YAMNetRealTest] Ergebnis: ${clip.label}`, result);
    }
}
// --- Ende YAMNet-Test ---

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
        void runYAMNetTest(audioBuffer);

        const signal = prepareSignal(audioBuffer);
        const energyFrames = calculateEnergyFrames(signal);
        const onsets = detectOnsets(energyFrames);
        const energyLevel = calculateEnergyLevel(energyFrames, onsets.length);

        const activityRegions = detectActivityRegions(energyFrames);
        console.log("[ActivityRegions] Anzahl:", activityRegions.length);
        console.log("[ActivityRegions] Erste 5:", activityRegions.slice(0, 5).map(r => ({
            start: r.startSeconds.toFixed(2),
            end:   r.endSeconds.toFixed(2),
            confidence: r.confidence.toFixed(3),
        })));

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

        const firstBeat = cuePoints.find(c => c.kind === "first_beat");
        const beatGridStartSeconds = firstBeat?.timeSeconds ?? 0;

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
            beatGridStartSeconds,

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
