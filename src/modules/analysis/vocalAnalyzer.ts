import { convertFileSrc } from "@tauri-apps/api/core";
import { detectMainVocalRegionsFromFrames, type VocalPrepFrame } from "./vocalDetector";

const TARGET_SR = 44100;
const FRAME_SIZE = Math.floor(TARGET_SR * 0.04); // 40ms Fenster

// Downsampled DFT Spektral-Zentroid (STEP=8 → ~2756 Hz Nyquist)
function computeSpectralCentroid(signal: Float32Array, frameStart: number, frameSize: number): number {
    const STEP = 8;
    const N = Math.floor(frameSize / STEP);
    const half = Math.floor(N / 2);
    const freqPerBin = (TARGET_SR / STEP) / N;
    let weightedSum = 0, totalMag = 0;
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

// Mittenbandenergie 300–3000 Hz
function computeMidBandEnergy(signal: Float32Array, frameStart: number, frameSize: number): number {
    const STEP = 8;
    const N = Math.floor(frameSize / STEP);
    const half = Math.floor(N / 2);
    const freqPerBin = (TARGET_SR / STEP) / N;
    const kLow  = Math.max(1, Math.round(300  / freqPerBin));
    const kHigh = Math.min(half, Math.round(3000 / freqPerBin));
    let sumMag = 0, count = 0;
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

// Audio-Datei laden + dekodieren → mono Float32Array
async function decodeAudioFile(filePath: string): Promise<Float32Array> {
    const url = convertFileSrc(filePath);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Fetch fehlgeschlagen: ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();

    const ctx = new OfflineAudioContext(1, 1, TARGET_SR);
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

    // Downmix zu Mono
    const channels = audioBuffer.numberOfChannels;
    const length = audioBuffer.length;
    const mono = new Float32Array(length);
    for (let ch = 0; ch < channels; ch++) {
        const data = audioBuffer.getChannelData(ch);
        for (let i = 0; i < length; i++) mono[i] += data[i] / channels;
    }

    // Normalisieren
    let max = 0;
    for (let i = 0; i < mono.length; i++) max = Math.max(max, Math.abs(mono[i]));
    if (max > 0) for (let i = 0; i < mono.length; i++) mono[i] /= max;

    return mono;
}

// Vocal-Erkennung auf einem Audio-File ausführen
// Gibt die größte erkannte Hauptvocalregion zurück, oder null wenn nichts gefunden
export async function detectVocalRegion(
    filePath: string,
): Promise<{ startSeconds: number; endSeconds: number } | null> {
    console.log("[VocalAnalyzer] Starte Analyse:", filePath);
    const t0 = performance.now();

    const signal = await decodeAudioFile(filePath);
    console.log(`[VocalAnalyzer] Dekodiert in ${(performance.now() - t0).toFixed(0)}ms, ${signal.length} Samples`);

    const t1 = performance.now();
    const frames: VocalPrepFrame[] = [];
    for (let i = 0; i < signal.length; i += FRAME_SIZE) {
        const end = Math.min(i + FRAME_SIZE, signal.length);
        let sum = 0;
        for (let j = i; j < end; j++) sum += Math.abs(signal[j]);
        const energy = sum / (end - i);
        const centroid = computeSpectralCentroid(signal, i, end - i);
        const zcr = computeZCR(signal, i, end - i);
        const midEnergy = computeMidBandEnergy(signal, i, end - i);
        frames.push({ timeSeconds: i / TARGET_SR, energy, centroid, zcr, midEnergy });
    }
    console.log(`[VocalAnalyzer] Frames berechnet in ${(performance.now() - t1).toFixed(0)}ms (${frames.length} Frames)`);

    const regions = detectMainVocalRegionsFromFrames(frames);
    if (regions.length === 0) {
        console.log("[VocalAnalyzer] Keine Vocal-Region erkannt");
        return null;
    }

    // Längste Region wählen
    const main = regions.reduce((a, b) =>
        (b.endSeconds - b.startSeconds) > (a.endSeconds - a.startSeconds) ? b : a
    );
    console.log(`[VocalAnalyzer] Fertig in ${(performance.now() - t0).toFixed(0)}ms: ${main.startSeconds.toFixed(1)}s – ${main.endSeconds.toFixed(1)}s`);
    return { startSeconds: main.startSeconds, endSeconds: main.endSeconds };
}
