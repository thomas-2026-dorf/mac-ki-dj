import { invoke } from "@tauri-apps/api/core";

import { getTkdjCachePaths } from "../audio/timeStretchEngine";
import type { AudioAnalysisResult } from "./types";

export function getAnalysisCachePath(inputPath: string) {
    const paths = getTkdjCachePaths(inputPath);
    const baseName = inputPath
        .split("/")
        .pop()
        ?.replace(/\.[^/.]+$/, "") || "track";

    return `${paths.cacheFolder}/${baseName}.analysis.json`;
}

async function fileExists(path: string) {
    return await invoke<boolean>("tkdj_file_exists", { path });
}

export async function loadAnalysisCache(inputPath: string) {
    const analysisPath = getAnalysisCachePath(inputPath);

    if (!(await fileExists(analysisPath))) {
        return null;
    }

    const raw = await invoke<string>("tkdj_read_text_file", { path: analysisPath });
    const parsed = JSON.parse(raw) as AudioAnalysisResult;
    console.log("[CacheLoadKeys]", Object.keys(parsed));
    return parsed;
}

export async function saveAnalysisCache(inputPath: string, analysis: AudioAnalysisResult) {
    const analysisPath = getAnalysisCachePath(inputPath);

    console.log("[CacheSaveKeys]", Object.keys(analysis));
    await invoke<string>("tkdj_write_text_file", {
        path: analysisPath,
        content: JSON.stringify(analysis, null, 2),
    });

    return analysisPath;
}
