import { invoke } from "@tauri-apps/api/core";

import { ensureWavCache } from "../audio/timeStretchEngine";
import { loadAnalysisCache, saveAnalysisCache } from "./analysisCache";
import { analyzeAudioBuffer } from "./audioAnalyzer";
import { analyzeTrackWithEssentia } from "./essentiaAnalyzer";
import type { AudioAnalysisResult, CuePoint } from "./types";

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

        // Primär: Essentia-Pfad direkt aus MP3 (kein WAV-Umweg, kein Rust)
        let analysis: AudioAnalysisResult;
        try {
            console.log(`[Essentia] Datei lesen / decodeAudioData / Essentia Analyse: ${inputMp3.split("/").slice(-1)[0]}`);
            const e = await analyzeTrackWithEssentia(inputMp3);

            const cuePoints: CuePoint[] = e.firstBeatSeconds > 0 ? [{
                id: "first_beat",
                label: "Erster Beat / Intro",
                timeSeconds: e.firstBeatSeconds,
                kind: "first_beat",
            }] : [];

            analysis = {
                key:              e.key      ?? undefined,
                scale:            e.scale    ?? undefined,
                camelotKey:       e.camelotKey ?? undefined,
                durationSeconds:  e.durationSeconds,
                sampleRate:       44100,
                numberOfChannels: 1,
                energyLevel:      0,
                bpm:              e.bpm,
                bpmConfidence:    "medium",
                bpmCandidates:    [],
                onsetCount:       0,
                waveform:         [],
                beats:            e.beats,
                cuePoints,
                beatGridStartSeconds: e.firstBeatSeconds,
                activityRegions:  e.activityRegions,
            };

            console.log(
                `[Analyse] Essentia-Pfad OK: BPM ${e.bpm.toFixed(2)} · Key ${e.key} ${e.scale}` +
                ` · firstBeat ${e.firstBeatSeconds.toFixed(3)}s · Dauer ${e.durationSeconds.toFixed(1)}s`
            );
        } catch (essentiaErr) {
            // Fallback: WAV-Pfad (optional, nur bei Essentia-Fehler)
            console.warn("[Analyse] Essentia fehlgeschlagen, WAV-Fallback:", essentiaErr);
            const wavPath = await ensureWavCache(inputMp3);
            const audioBytes = await invoke<number[]>("tkdj_read_binary_file", { path: wavPath });
            const audioData = new Uint8Array(audioBytes);
            analysis = await analyzeAudioBuffer(audioData);
        }

        const t0cache = performance.now();
        await saveAnalysisCache(inputMp3, analysis);
        console.log(`[Timing] Cache speichern:    ${(performance.now() - t0cache).toFixed(0)} ms`);

        return { success: true, analysis, rustAnalysis: null, cached: false };
    } catch (e) {
        return { success: false, error: String(e) };
    }
}
