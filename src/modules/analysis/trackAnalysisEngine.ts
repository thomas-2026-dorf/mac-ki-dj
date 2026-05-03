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

        // External analysis disabled (Superpowered migration)
        console.log("External analysis/stretch engine disabled (Superpowered migration)");
        return { success: false, error: "External analysis/stretch engine disabled (Superpowered migration)" };
    } catch (e) {
        return { success: false, error: String(e) };
    }
}
