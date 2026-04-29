/**
 * Isolierter Vergleichstest: Essentia.js vs. aktueller Stack
 * Kein Umbau, kein Einfluss auf MixEngine oder UI.
 * Aufruf: runEssentiaTest(audioPath, currentResult?)
 * Output: nur console.log
 */

import { invoke } from "@tauri-apps/api/core";
// @ts-expect-error – kein offizielles Paket-Level-TypeDecl
import { EssentiaWASM as EssentiaWASMInit } from "essentia.js/dist/essentia-wasm.es.js";
// @ts-expect-error
import EssentiaCore from "essentia.js/dist/essentia.js-core.es.js";
import { getCamelotKey } from "./key/keyTheory";

const TARGET_SR = 44100;

export type EssentiaTestResult = {
    bpm: number;
    bpmConfidence: number;
    beats: number[];
    firstBeatSeconds: number;
    key: string;
    scale: string;
    keyStrength: number;
    camelotKey: string;
    waveformPeaks: number[];
    durationSeconds: number;
    sampleRate: number;
    timings: {
        decode: number;
        wasmInit: number;
        rhythm: number;
        key: number;
        waveform: number;
        total: number;
    };
};

export type CurrentStackResult = {
    bpm?: number;
    detectedBpm?: number;
    beatGridStartSeconds?: number;
    key?: string;
};

// WASM-Singleton – EssentiaWASM ist im ES-Modul bereits initialisiert
let _essentiaInstance: unknown = null;
async function getEssentia() {
    if (_essentiaInstance) return _essentiaInstance as InstanceType<typeof EssentiaCore>;
    const t0 = performance.now();
    // EssentiaWASMInit ist das fertige Emscripten-Modul-Objekt, kein Konstruktor
    const essentia = new EssentiaCore(EssentiaWASMInit);
    console.log(`[EssentiaTest] Essentia bereit in ${(performance.now() - t0).toFixed(0)} ms`);
    _essentiaInstance = essentia;
    return essentia as InstanceType<typeof EssentiaCore>;
}

/** Mono Float32Array bei 44100 Hz aus rohen Audio-Bytes */
async function decodeToMono44k(audioBytes: Uint8Array): Promise<{ signal: Float32Array; duration: number }> {
    // Erst normal dekodieren, um die Länge zu kennen
    const tempCtx = new AudioContext();
    const tmpBuf = await tempCtx.decodeAudioData(audioBytes.buffer.slice(
        audioBytes.byteOffset,
        audioBytes.byteOffset + audioBytes.byteLength,
    ));
    await tempCtx.close();

    const numFrames = Math.ceil(tmpBuf.duration * TARGET_SR);
    const offCtx = new OfflineAudioContext(1, numFrames, TARGET_SR);
    const source = offCtx.createBufferSource();

    // Re-decode in OfflineAudioContext (resampled auf 44100)
    const srcBuf = await offCtx.decodeAudioData(audioBytes.buffer.slice(
        audioBytes.byteOffset,
        audioBytes.byteOffset + audioBytes.byteLength,
    ));
    source.buffer = srcBuf;
    source.connect(offCtx.destination);
    source.start(0);
    const rendered = await offCtx.startRendering();
    return { signal: rendered.getChannelData(0), duration: rendered.duration };
}

/** 128 normalisierte RMS-Peaks aus dem Signal */
function computeWaveformPeaks(signal: Float32Array, numBuckets = 128): number[] {
    const bucketSize = Math.floor(signal.length / numBuckets);
    const peaks: number[] = [];
    let maxPeak = 0;
    for (let i = 0; i < numBuckets; i++) {
        let sum = 0;
        const start = i * bucketSize;
        for (let j = start; j < start + bucketSize; j++) sum += signal[j] ** 2;
        const rms = Math.sqrt(sum / bucketSize);
        peaks.push(rms);
        if (rms > maxPeak) maxPeak = rms;
    }
    return maxPeak > 0 ? peaks.map(p => p / maxPeak) : peaks;
}

/** Hauptfunktion */
export async function runEssentiaTest(
    audioPath: string,
    current?: CurrentStackResult,
): Promise<EssentiaTestResult> {
    const totalStart = performance.now();
    console.group("[EssentiaTest] ── Vergleichsanalyse ──────────────────────────────");
    console.log("Datei:", audioPath);

    // ── Audio laden & dekodieren ──────────────────────────────────────────
    const t_decode = performance.now();
    const rawBytes = await invoke<number[]>("tkdj_read_binary_file", { path: audioPath });
    const audioData = new Uint8Array(rawBytes);
    const { signal, duration } = await decodeToMono44k(audioData);
    const decodeMs = performance.now() - t_decode;

    // ── WASM / Essentia init ──────────────────────────────────────────────
    const t_wasm = performance.now();
    const essentia = await getEssentia();
    const wasmMs = performance.now() - t_wasm;

    const vec = (essentia as any).arrayToVector(signal);

    // ── Rhythmus: BPM + Beats ─────────────────────────────────────────────
    const t_rhythm = performance.now();
    // "degara" ~10× schneller als "multifeature", leicht weniger genau
    const rhythm = (essentia as any).RhythmExtractor2013(vec, 200, "degara", 60);
    const rhythmMs = performance.now() - t_rhythm;
    const beats: number[] = Array.from((essentia as any).vectorToArray(rhythm.ticks) as Float32Array);
    const bpm: number = rhythm.bpm;
    const bpmConfidence: number = rhythm.confidence;
    rhythm.ticks.delete?.();
    rhythm.estimates?.delete?.();
    rhythm.bpmIntervals?.delete?.();

    // ── Key ───────────────────────────────────────────────────────────────
    const t_key = performance.now();
    const keyResult = (essentia as any).KeyExtractor(vec);
    const keyMs = performance.now() - t_key;
    const key: string = keyResult.key;
    const scale: string = keyResult.scale;
    const keyStrength: number = keyResult.strength;
    const camelotKey = getCamelotKey(key, scale === "major" ? "major" : "minor") ?? "?";

    // ── Waveform Peaks ────────────────────────────────────────────────────
    const t_wave = performance.now();
    const waveformPeaks = computeWaveformPeaks(signal);
    const waveMs = performance.now() - t_wave;

    vec.delete?.();

    const totalMs = performance.now() - totalStart;

    // ── Vergleich ausgeben ────────────────────────────────────────────────
    const firstBeat = beats[0] ?? 0;

    console.log("\n📊 ERGEBNIS");
    console.table({
        "BPM (Essentia)":       bpm.toFixed(2),
        "BPM (aktuell)":        current?.detectedBpm?.toFixed(2) ?? current?.bpm ?? "–",
        "BPM-Konfidenz":        bpmConfidence.toFixed(2),
        "Beats erkannt":        beats.length,
        "Erster Beat (s)":      firstBeat.toFixed(4),
        "GridStart (aktuell)":  current?.beatGridStartSeconds?.toFixed(4) ?? "–",
        "Key (Essentia)":       `${key} ${scale}`,
        "Key (aktuell)":        current?.key ?? "–",
        "Camelot (Essentia)":   camelotKey,
        "Key-Stärke":           keyStrength.toFixed(3),
        "Dauer (s)":            duration.toFixed(1),
    });

    console.log("\n⏱ ZEITEN");
    console.table({
        "Decode+Resample":  `${decodeMs.toFixed(0)} ms`,
        "WASM Init":        wasmMs > 5 ? `${wasmMs.toFixed(0)} ms (Kaltstart)` : "cached",
        "RhythmExtractor":  `${rhythmMs.toFixed(0)} ms`,
        "KeyExtractor":     `${keyMs.toFixed(0)} ms`,
        "Waveform Peaks":   `${waveMs.toFixed(0)} ms`,
        "GESAMT":           `${totalMs.toFixed(0)} ms`,
    });

    console.log("\n🎵 Erste 16 Beats (s):", beats.slice(0, 16).map(b => b.toFixed(3)).join("  "));

    if (beats.length >= 8) {
        const intervals = beats.slice(1, 9).map((t, i) => t - beats[i]);
        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        console.log(`📐 Ø Beat-Interval: ${avgInterval.toFixed(4)} s → ${(60 / avgInterval).toFixed(2)} BPM`);
    }

    console.groupEnd();

    return {
        bpm, bpmConfidence, beats, firstBeatSeconds: firstBeat,
        key, scale, keyStrength, camelotKey,
        waveformPeaks, durationSeconds: duration, sampleRate: TARGET_SR,
        timings: {
            decode: decodeMs, wasmInit: wasmMs,
            rhythm: rhythmMs, key: keyMs, waveform: waveMs, total: totalMs,
        },
    };
}
