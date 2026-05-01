import { invoke } from "@tauri-apps/api/core";
// @ts-expect-error – kein offizielles Paket-Level-TypeDecl
import { EssentiaWASM as EssentiaWASMInit } from "essentia.js/dist/essentia-wasm.es.js";
// @ts-expect-error
import EssentiaCore from "essentia.js/dist/essentia.js-core.es.js";
import { getCamelotKey } from "./key/keyTheory";
import { detectActivityRegions, type ActivityRegion } from "./energy";
import { detectVocalCandidateRegions, detectMainVocalRegionsFromFrames, type VocalCandidateRegion } from "./vocalDetector";
import { alignVocalRegionsToBeats, type AlignedVocalRegion } from "./vocalPhraseAligner";
import { detectVocalMixZones, type VocalMixZone } from "./mixZoneDetector";

const TARGET_SR = 44100;

// Downsampled DFT spectral centroid (step=8 → Nyquist ~2756 Hz, O(N/8 * N/16) per frame)
function computeSpectralCentroid(signal: Float32Array, frameStart: number, frameSize: number): number {
    const STEP = 8;
    const N = Math.floor(frameSize / STEP);
    const half = Math.floor(N / 2);
    const freqPerBin = (TARGET_SR / STEP) / N;
    let weightedSum = 0;
    let totalMag = 0;
    for (let k = 1; k <= half; k++) {
        let re = 0, im = 0;
        for (let n = 0; n < N; n++) {
            const angle = (2 * Math.PI * k * n) / N;
            const s = signal[frameStart + n * STEP] ?? 0;
            re += s * Math.cos(angle);
            im -= s * Math.sin(angle);
        }
        const mag = Math.sqrt(re * re + im * im);
        weightedSum += k * freqPerBin * mag;
        totalMag += mag;
    }
    return totalMag > 0 ? weightedSum / totalMag : 0;
}

// Mid-band energy (300–3000 Hz) via downsampled DFT — same step=8 as centroid
function computeMidBandEnergy(signal: Float32Array, frameStart: number, frameSize: number): number {
    const STEP = 8;
    const N = Math.floor(frameSize / STEP);
    const half = Math.floor(N / 2);
    const freqPerBin = (TARGET_SR / STEP) / N;
    const kLow = Math.max(1, Math.round(300 / freqPerBin));
    const kHigh = Math.min(half, Math.round(3000 / freqPerBin));
    let sumMag = 0;
    let count = 0;
    for (let k = kLow; k <= kHigh; k++) {
        let re = 0, im = 0;
        for (let n = 0; n < N; n++) {
            const angle = (2 * Math.PI * k * n) / N;
            const s = signal[frameStart + n * STEP] ?? 0;
            re += s * Math.cos(angle);
            im -= s * Math.sin(angle);
        }
        sumMag += Math.sqrt(re * re + im * im);
        count++;
    }
    return count > 0 ? sumMag / (count * N) : 0;
}

function computeZCR(signal: Float32Array, frameStart: number, frameSize: number): number {
    const end = Math.min(frameStart + frameSize, signal.length);
    let crossings = 0;
    for (let i = frameStart + 1; i < end; i++) {
        if ((signal[i - 1] >= 0) !== (signal[i] >= 0)) crossings++;
    }
    const len = end - frameStart - 1;
    return len > 0 ? crossings / len : 0;
}

export type EssentiaAnalysisResult = {
    bpm: number;
    beats: number[];
    firstBeatSeconds: number;
    key: string | null;
    scale: string | null;
    camelotKey: string | null;
    durationSeconds: number;
    activityRegions: ActivityRegion[];
    vocalCandidateRegions: VocalCandidateRegion[];
    alignedVocalRegions: AlignedVocalRegion[];
    vocalMixZones: VocalMixZone[];
};

let _essentia: unknown = null;
async function getEssentia() {
    if (_essentia) return _essentia as InstanceType<typeof EssentiaCore>;
    _essentia = new EssentiaCore(EssentiaWASMInit);
    return _essentia as InstanceType<typeof EssentiaCore>;
}

async function decodeToMono(audioBytes: Uint8Array): Promise<{ signal: Float32Array; duration: number }> {
    const buf = audioBytes.buffer.slice(audioBytes.byteOffset, audioBytes.byteOffset + audioBytes.byteLength);

    const tempCtx = new AudioContext();
    const tmpBuf = await tempCtx.decodeAudioData(buf.slice(0));
    await tempCtx.close();

    const numFrames = Math.ceil(tmpBuf.duration * TARGET_SR);
    const offCtx = new OfflineAudioContext(1, numFrames, TARGET_SR);
    const srcBuf = await offCtx.decodeAudioData(buf.slice(0));
    const source = offCtx.createBufferSource();
    source.buffer = srcBuf;
    source.connect(offCtx.destination);
    source.start(0);
    const rendered = await offCtx.startRendering();
    return { signal: rendered.getChannelData(0), duration: rendered.duration };
}

export async function analyzeTrackWithEssentia(audioPath: string): Promise<EssentiaAnalysisResult> {
    const t0file = performance.now();
    const rawBytes = await invoke<number[]>("tkdj_read_binary_file", { path: audioPath });
    const audioData = new Uint8Array(rawBytes);
    console.log(`[Timing] Datei lesen:        ${(performance.now() - t0file).toFixed(0)} ms`);

    const t0decode = performance.now();
    const { signal, duration } = await decodeToMono(audioData);
    console.log(`[Timing] decodeAudioData:    ${(performance.now() - t0decode).toFixed(0)} ms`);

    const t0essentia = performance.now();
    const essentia = await getEssentia();
    const vec = (essentia as any).arrayToVector(signal);

    const rhythm = (essentia as any).RhythmExtractor2013(vec, 200, "degara", 60);
    const beats: number[] = Array.from((essentia as any).vectorToArray(rhythm.ticks) as Float32Array);
    const bpm: number = rhythm.bpm;
    rhythm.ticks.delete?.();
    rhythm.estimates?.delete?.();
    rhythm.bpmIntervals?.delete?.();

    const keyResult = (essentia as any).KeyExtractor(vec);
    const key: string = keyResult.key;
    const scale: string = keyResult.scale;
    const camelotKey = getCamelotKey(key, scale === "major" ? "major" : "minor") ?? null;

    vec.delete?.();
    console.log(`[Timing] Essentia Analyse:   ${(performance.now() - t0essentia).toFixed(0)} ms`);

    // Energie-Frames aus Mono-Signal (40ms-Fenster, mittlerer Betrag)
    const FRAME_SIZE = Math.floor(TARGET_SR * 0.04);
    const energyFrames: { index: number; timeSeconds: number; energy: number }[] = [];
    const vocalPrepFrames: { timeSeconds: number; energy: number; centroid: number; zcr: number; midEnergy: number }[] = [];
    for (let i = 0, idx = 0; i < signal.length; i += FRAME_SIZE, idx++) {
        const end = Math.min(i + FRAME_SIZE, signal.length);
        let sum = 0;
        for (let j = i; j < end; j++) sum += Math.abs(signal[j]);
        const energy = sum / (end - i);
        energyFrames.push({ index: idx, timeSeconds: i / TARGET_SR, energy });
        const centroid = computeSpectralCentroid(signal, i, end - i);
        const zcr = computeZCR(signal, i, end - i);
        const midEnergy = computeMidBandEnergy(signal, i, end - i);
        vocalPrepFrames.push({ timeSeconds: i / TARGET_SR, energy, centroid, zcr, midEnergy });
    }
    console.log("[VocalPrep]", vocalPrepFrames.slice(0, 10).map(f =>
        ({ t: f.timeSeconds.toFixed(3), e: f.energy.toFixed(6), centroid: f.centroid.toFixed(1), zcr: f.zcr.toFixed(4), midE: f.midEnergy.toFixed(6) })));

    const vocalCandidateRegions = detectVocalCandidateRegions(vocalPrepFrames);
    const alignedVocalRegions = alignVocalRegionsToBeats(vocalCandidateRegions, beats);

    const mainVocalRegions = detectMainVocalRegionsFromFrames(vocalPrepFrames);
    const alignedMainVocalRegions = alignVocalRegionsToBeats(mainVocalRegions, beats);
    const vocalMixZones = detectVocalMixZones(alignedMainVocalRegions, beats);

    console.log("[VocalMixZonesSource]", {
        allAligned: alignedVocalRegions.length,
        mainAligned: alignedMainVocalRegions.length,
        zones: vocalMixZones.length,
    });

    const energies = energyFrames.map(f => f.energy);
    const avgEnergy = energies.reduce((s, v) => s + v, 0) / (energies.length || 1);
    console.log("[ActivityDebug] energyFrames:", energyFrames.length,
        "| min:", Math.min(...energies).toFixed(6),
        "| avg:", avgEnergy.toFixed(6),
        "| max:", Math.max(...energies).toFixed(6));
    console.log("[ActivityDebug] erste 5 Frames:", energyFrames.slice(0, 5).map(f =>
        ({ t: f.timeSeconds.toFixed(2), e: f.energy.toFixed(6) })));

    const activityRegions = detectActivityRegions(energyFrames);

    console.log("[ActivityDebug] activityRegions:", activityRegions.length);
    console.log("[ActivityDebug] erste 5 Regions:", activityRegions.slice(0, 5).map(r =>
        ({ start: r.startSeconds.toFixed(2), end: r.endSeconds.toFixed(2), conf: r.confidence.toFixed(3) })));

    const result = {
        bpm,
        beats,
        firstBeatSeconds: beats[0] ?? 0,
        key,
        scale,
        camelotKey,
        durationSeconds: duration,
        activityRegions,
        vocalCandidateRegions,
        alignedVocalRegions,
        vocalMixZones,
    };
    console.log("[AnalyzerReturnKeys]", Object.keys(result));
    return result;
}
