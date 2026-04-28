import { invoke } from "@tauri-apps/api/core";

import { ensureWavCache } from "../audio/timeStretchEngine";
import { loadAnalysisCache, saveAnalysisCache } from "./analysisCache";
import { analyzeAudioBuffer } from "./audioAnalyzer";

export async function prepareTrackAnalysis(inputMp3: string) {
    try {
        const cached = await loadAnalysisCache(inputMp3);
        if (cached) {
            return { success: true, analysis: cached, cached: true };
        }

        const wavPath = await ensureWavCache(inputMp3);

        const audioBytes = await invoke<number[]>("tkdj_read_binary_file", {
            path: wavPath,
        });

        const audioData = new Uint8Array(audioBytes);
        const analysis = await analyzeAudioBuffer(audioData);

        await saveAnalysisCache(inputMp3, analysis);

        return { success: true, analysis, cached: false };
    } catch (e) {
        return { success: false, error: String(e) };
    }
}
