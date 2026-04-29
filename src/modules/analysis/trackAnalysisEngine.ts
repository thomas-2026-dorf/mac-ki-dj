import { invoke } from "@tauri-apps/api/core";

import { ensureWavCache } from "../audio/timeStretchEngine";
import { loadAnalysisCache, saveAnalysisCache } from "./analysisCache";
import { analyzeAudioBuffer } from "./audioAnalyzer";

export type RustAnalysisResult = {
    bpm: number;
    beat_interval_seconds: number;
    beats: number[];
    grid_start_seconds: number;
    file_size_bytes: number;
    sample_count: number;
    stratum_bpm: number | null;
    stratum_downbeats: number[];
};

export async function prepareTrackAnalysis(inputMp3: string) {
    try {
        const cached = await loadAnalysisCache(inputMp3);

        if (cached) {
            // Cache-Treffer: kein WAV nötig — Rust-BPM parallel, aber kein Read-Overhead
            const rustAnalysis = await invoke<RustAnalysisResult>("analyze_audio_file", { path: inputMp3 })
                .catch(() => null);
            return { success: true, analysis: cached, rustAnalysis, cached: true };
        }

        // Kein Cache: vollständige Analyse (WAV konvertieren + einlesen + analysieren)
        const wavPath = await ensureWavCache(inputMp3);
        const audioBytes = await invoke<number[]>("tkdj_read_binary_file", { path: wavPath });
        const audioData = new Uint8Array(audioBytes);

        const [analysis, rustAnalysis] = await Promise.all([
            analyzeAudioBuffer(audioData),
            invoke<RustAnalysisResult>("analyze_audio_file", { path: inputMp3 }).catch(() => null),
        ]);

        await saveAnalysisCache(inputMp3, analysis);
        return { success: true, analysis, rustAnalysis, cached: false };
    } catch (e) {
        return { success: false, error: String(e) };
    }
}
