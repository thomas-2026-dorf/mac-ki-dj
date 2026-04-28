import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
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

export async function loadAnalysisCache(inputPath: string) {
    const analysisPath = getAnalysisCachePath(inputPath);

    if (!(await exists(analysisPath))) {
        return null;
    }

    const raw = await readTextFile(analysisPath);
    return JSON.parse(raw) as AudioAnalysisResult;
}

export async function saveAnalysisCache(inputPath: string, analysis: AudioAnalysisResult) {
    const analysisPath = getAnalysisCachePath(inputPath);

    await writeTextFile(analysisPath, JSON.stringify(analysis, null, 2));

    return analysisPath;
}
