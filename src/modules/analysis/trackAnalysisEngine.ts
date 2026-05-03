import { loadAnalysisCache } from "./analysisCache";

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

export async function prepareTrackAnalysis(inputMp3: string, options?: { forceFresh?: boolean }) {
    try {
        if (!options?.forceFresh) {
            const cached = await loadAnalysisCache(inputMp3);
            if (cached) {
                return { success: true, analysis: cached, rustAnalysis: null, cached: true };
            }
        }
        return { success: false, error: "Analysis disabled" };
    } catch (e) {
        return { success: false, error: String(e) };
    }
}
