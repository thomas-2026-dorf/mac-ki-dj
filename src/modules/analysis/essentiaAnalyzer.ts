import { invoke } from "@tauri-apps/api/core";
// @ts-expect-error – kein offizielles Paket-Level-TypeDecl
import { EssentiaWASM as EssentiaWASMInit } from "essentia.js/dist/essentia-wasm.es.js";
// @ts-expect-error
import EssentiaCore from "essentia.js/dist/essentia.js-core.es.js";
import { getCamelotKey } from "./key/keyTheory";

const TARGET_SR = 44100;

export type EssentiaAnalysisResult = {
    bpm: number;
    beats: number[];
    firstBeatSeconds: number;
    key: string | null;
    scale: string | null;
    camelotKey: string | null;
    durationSeconds: number;
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

    return {
        bpm,
        beats,
        firstBeatSeconds: beats[0] ?? 0,
        key,
        scale,
        camelotKey,
        durationSeconds: duration,
    };
}
