import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readDir, readFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";

import { demoTracks } from "../data/demoTracks";
import { calculateTransitionScore } from "../modules/transition/transitionScore";
import { suggestTransitionPoints, formatTransitionTime, ROLE_COLORS } from "../modules/transition/transitionPointPlanner";
import { convertAndStretch } from "../modules/audio/timeStretchEngine";
import { prepareTrackAnalysis } from "../modules/analysis/trackAnalysisEngine";
import { computeGridOffset } from "../modules/analysis/gridOffsetAnalyzer";
import type { Track, TrackGridOffset, TransitionPoint } from "../types/track";

const MUSIC_FOLDER_STORAGE_KEY = "tk-dj-music-folder-v1";
const TRACK_LIBRARY_STORAGE_KEY = "tk-dj-track-library-v1";

type Props = {
    onLoadA: (track: Track) => void;   // Doppelklick / Automix-Queue
    onLoadP1?: (track: Track) => void; // ▶1 Button → direkt in Player 1
    onLoadB?: (track: Track) => void;  // ▶2 Button → direkt in Player 2
    onTrackSelected?: (track: Track) => void;
    onTrackUpdated?: (track: Track) => void;
    referenceTrack?: Track | null;
};

type EditFields = {
    title: string;
    artist: string;
    genre: string;
    year: string;
    bpm: string;
    key: string;
    energy: string;
};

type Mp3TagInfo = {
    title?: string;
    artist?: string;
    album?: string;
    genre?: string;
    year?: number;
    comment?: string;
    duration_seconds?: number;
};

function parseMixedInKeyComment(comment?: string): Partial<Pick<Track, "bpm" | "key" | "energy">> {
    if (!comment) return {};

    const result: Partial<Pick<Track, "bpm" | "key" | "energy">> = {};

    // Kombiniertes MIK-Format: "8A / 128 / 7" oder "8A - 128 - 7"
    const combined = comment.match(/\b(([1-9]|1[0-2])[AB])\b\s*[-|/]\s*(\d{2,3}(?:[.,]\d+)?)\s*[-|/]\s*(10|[1-9])\b/i);
    if (combined) {
        result.key    = combined[1].toUpperCase();
        result.bpm    = Math.round(Number(combined[3].replace(",", ".")));
        result.energy = Number(combined[4]);
    }

    // Standalone Energy: "Energy 8", "Energy: 8", "Energy=8"
    if (!result.energy) {
        const energyMatch = comment.match(/\benergy\s*[=:]?\s*(10|[1-9])\b/i);
        if (energyMatch) result.energy = Number(energyMatch[1]);
    }

    return result;
}

function formatDurationFromSeconds(seconds?: number): string {
    if (!seconds || !Number.isFinite(seconds)) return "00:00";
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function toEditFields(track: Track): EditFields {
    return {
        title: track.title || "",
        artist: track.artist || "",
        genre: track.genre || "",
        year: track.year ? String(track.year) : "",
        bpm: track.bpm ? String(track.bpm) : "",
        key: track.key || "",
        energy: track.energy ? String(track.energy) : "",
    };
}

function parseOptionalNumber(value: string): number | undefined {
    const trimmed = value.trim();
    if (!trimmed) return undefined;

    const parsed = Number(trimmed.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : undefined;
}

function cleanAmazonTitle(title: string): string {
    return title
        .replace(/\.mp3$/i, "")
        .replace(/^\d+\s*[-_.]\s*/, "")
        .replace(/[_-][a-f0-9]{8,}.*$/i, "")
        .replace(/\s+/g, " ")
        .trim();
}

const _loggedMissingFields = new Set<string>();

// Liest einen Feldwert mit Fallback auf alternative Namen (Altbestand-Kompatibilität)
function anyField(obj: unknown, ...keys: string[]): unknown {
    if (!obj || typeof obj !== "object") return undefined;
    const rec = obj as Record<string, unknown>;
    for (const k of keys) {
        if (rec[k] !== undefined && rec[k] !== null) return rec[k];
    }
    return undefined;
}

function getAnalysisMissingFields(track: Track): string[] {
    const a = track.analysis;
    if (!a) return ["analysis"];
    const missing: string[] = [];

    // durationSeconds — Fallback auf "duration" (Altbestand)
    const dur = a.durationSeconds ?? Number(anyField(a, "duration") ?? 0);
    if (!(dur > 0)) missing.push("durationSeconds");

    if (!(track.bpm > 0)) missing.push("bpm");

    // beats — Fallback auf beatCount (kompakte Speicherung) oder alternative Namen
    const beatCount = (Array.isArray(a.beats) ? a.beats.length : 0)
        || (a.beatCount ?? 0)
        || Number(anyField(a, "beatPositions", "beatList") !== undefined
            ? (anyField(a, "beatPositions", "beatList") as unknown[]).length ?? 0
            : 0);
    if (!(beatCount > 0)) missing.push("beats");

    if (!track.key && !a.camelotKey) missing.push("key/camelotKey");

    if (!a.gridOffset) missing.push("gridOffset");

    // energy — Fallback auf "energyLevel" (Altbestand runtime-only)
    const energyValue =
        (track.energy ?? 0) ||
        (a.energy ?? 0) ||
        Number(anyField(a, "energyLevel") ?? 0) ||
        (a.external?.energy ?? 0);
    if (!(energyValue > 0)) missing.push("energy");

    return missing;
}

function logTrackDebugSnapshot(track: Track, missing: string[], err?: unknown): void {
    const a = track.analysis as Record<string, unknown> | undefined;
    const t = track as unknown as Record<string, unknown>;
    console.group(`[Debug] "${track.title}" – fehlend: [${missing.join(", ")}]`);
    if (err) console.error("  Fehler:", err instanceof Error ? err.stack ?? err.message : String(err));
    console.log("  track.bpm          :", track.bpm);
    console.log("  track.key          :", track.key);
    console.log("  track.energy       :", track.energy);
    console.log("  track.energyLevel  :", t["energyLevel"]);
    console.log("  track.duration     :", track.duration);
    console.log("  track.durationSec  :", t["durationSeconds"]);
    console.log("  analysis?          :", !!a);
    if (a) {
        console.log("  a.status           :", a["status"]);
        console.log("  a.analyzedAt       :", a["analyzedAt"] ?? a["analysedAt"]);
        console.log("  a.analysisVersion  :", a["analysisVersion"] ?? a["version"]);
        console.log("  a.durationSeconds  :", a["durationSeconds"] ?? a["duration"]);
        console.log("  a.beats?.length    :", Array.isArray(a["beats"]) ? (a["beats"] as unknown[]).length : `(keine) beatCount=${a["beatCount"]}`);
        console.log("  a.gridOffset       :", a["gridOffset"] ? JSON.stringify(a["gridOffset"]).slice(0, 80) : undefined);
        console.log("  a.energy           :", a["energy"]);
        console.log("  a.energyLevel      :", a["energyLevel"]);
        console.log("  a.camelotKey       :", a["camelotKey"]);
        console.log("  a.external?.energy :", (a["external"] as Record<string, unknown> | undefined)?.["energy"]);
    }
    console.groupEnd();
}

function getAnalysisBadge(track: Track): { label: string; color: string; bg: string; border: string } {
    if (!track.analysis) {
        return { label: "⏳ fehlt", color: "#94a3b8", bg: "rgba(148,163,184,0.1)", border: "rgba(148,163,184,0.3)" };
    }
    const missing = getAnalysisMissingFields(track);
    const logKey = `${track.id}:${missing.join(",")}`;
    if (!_loggedMissingFields.has(logKey) && missing.length > 0) {
        _loggedMissingFields.add(logKey);
        console.log(`[Badge] "${track.title}" – fehlende Felder: ${missing.join(", ")}`);
    }
    if (missing.length === 0) {
        return { label: "✅ analysiert", color: "#86efac", bg: "rgba(34,197,94,0.1)", border: "rgba(34,197,94,0.3)" };
    }
    if (missing.length === 1 && missing[0] === "energy") {
        return { label: "⚠️ Energy fehlt", color: "#fbbf24", bg: "rgba(251,191,36,0.1)", border: "rgba(251,191,36,0.3)" };
    }
    return { label: "⚠️ unvollständig", color: "#fbbf24", bg: "rgba(251,191,36,0.1)", border: "rgba(251,191,36,0.3)" };
}

export default function TrackList({
    onLoadA,
    onLoadP1,
    onLoadB,
    onTrackSelected,
    onTrackUpdated,
    referenceTrack,
}: Props) {
    const [tracks, setTracks] = useState<Track[]>([]);
    const [musicFolder, setMusicFolder] = useState<string | null>(null);
    const [searchText, setSearchText] = useState("");

    const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
    const [editFields, setEditFields] = useState<EditFields | null>(null);
    const [analysisDebugMessage, setAnalysisDebugMessage] = useState<string>("");
    const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
    const [suggestMenuTrackId, setSuggestMenuTrackId] = useState<string | null>(null);
    const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);

    function sanitizeTrackForStorage(track: Track): Track {
        if (!track.analysis) return track;
        const { beats, waveform, ...compactAnalysis } = track.analysis;
        return {
            ...track,
            analysis: {
                ...compactAnalysis,
                beatCount: beats ? beats.length : (track.analysis.beatCount ?? 0),
            },
        };
    }

    function saveLibrary(updatedTracks: Track[], folder: string | null) {
        try {
            const compact = updatedTracks.map(sanitizeTrackForStorage);
            localStorage.setItem(TRACK_LIBRARY_STORAGE_KEY, JSON.stringify(compact));
        } catch (err) {
            if (err instanceof DOMException && err.name === "QuotaExceededError") {
                console.error("[saveLibrary] QuotaExceededError — localStorage voll. Tracks:", updatedTracks.length, err);
            } else {
                console.error("[saveLibrary] Fehler beim Speichern:", err);
            }
        }
        if (folder) {
            localStorage.setItem(MUSIC_FOLDER_STORAGE_KEY, folder);
        }
    }

    function buildGridOffset(beats: number[], bpm: number, gridStart: number, durationSeconds: number): TrackGridOffset | undefined {
        const goResult = computeGridOffset({ beats, bpm, gridStart, durationSeconds });
        if (goResult.source === "keine") return undefined;
        return {
            offsetSeconds: goResult.medianSec,
            offsetMs:      goResult.medianMs,
            stability:     goResult.stabil,
            source:        goResult.source,
            range:         goResult.bereich,
            ...(goResult.stabil === "ja" ? { globalGridStartSeconds: goResult.correctedGridStart } : {}),
            ...(goResult.stabil === "teilweise" && goResult.bereich === "nur Outro" ? { outroOffsetSeconds: goResult.medianSec } : {}),
        };
    }

    // Einzelnen Track vollständig analysieren
    async function analyzeTrack(track: Track, currentTracks: Track[]): Promise<{ tracks: Track[]; essentiaRan: boolean }> {
        if (!track.url) { console.warn(`[analyzeTrack] kein audioPath: "${track.title}"`); return { tracks: currentTracks, essentiaRan: false }; }
        console.group(`[Timing] Track: ${track.title}`);
        const t0total = performance.now();
        const audioPathShort = track.url.split("/").slice(-2).join("/");

        let analysisResult = await prepareTrackAnalysis(track.url);
        if (!analysisResult.success || !analysisResult.analysis) {
            console.warn(`[analyzeTrack] prepareTrackAnalysis fehlgeschlagen: "${track.title}"`);
            console.groupEnd();
            return { tracks: currentTracks, essentiaRan: false };
        }

        // Cache-Bypass: wenn Cache beats leer liefert, Essentia neu ausführen
        if (analysisResult.cached && !((analysisResult.analysis.beats?.length ?? 0) > 0)) {
            console.warn(`[analyzeTrack] Cache hat leere beats → forceFresh für "${track.title}"`);
            const fresh = await prepareTrackAnalysis(track.url, { forceFresh: true });
            if (fresh.success && fresh.analysis) analysisResult = fresh;
        }

        const a = analysisResult.analysis;
        const beatsLen = a.beats?.length ?? 0;
        console.log(`[analyzeTrack] audioPath=…/${audioPathShort} cached=${analysisResult.cached} beats=${beatsLen} bpm=${a.bpm?.toFixed(2) ?? "–"} dur=${a.durationSeconds?.toFixed(1) ?? "–"}s`);

        if (beatsLen === 0) {
            console.warn(`[analyzeTrack] Essentia lieferte keine Beats — Track wird nicht als analysiert gezählt: "${track.title}"`);
        }

        const floatBpm = a.bpm ?? undefined;
        const gridStart = a.beatGridStartSeconds as number | undefined;
        let gridOffset: TrackGridOffset | undefined;
        if (beatsLen > 0 && floatBpm && gridStart !== undefined && a.durationSeconds > 0) {
            const t0go = performance.now();
            gridOffset = buildGridOffset(a.beats!, floatBpm, gridStart, a.durationSeconds);
            console.log(`[Timing] GridOffset Berechnung: ${(performance.now() - t0go).toFixed(0)} ms · result=${gridOffset ? "ok" : "keine"}`);
        }
        // Energy: 1. MP3-Tag-Kommentar (MIK), 2. vorhandener track.energy, 3. Audio-Fallback
        let tagEnergy = 0;
        try {
            const tagData = await invoke<Mp3TagInfo>("read_mp3_tags", { path: track.url });
            tagEnergy = parseMixedInKeyComment(tagData.comment).energy ?? 0;
            if (tagEnergy > 0) console.log(`[analyzeTrack] Energy aus Tag: ${tagEnergy}`);
        } catch { /* Tag-Lesefehler ignorieren */ }
        const rawEnergyLevel = a.energyLevel ?? 0;
        const computedEnergy = rawEnergyLevel > 0 ? Math.min(10, Math.max(1, Math.round(rawEnergyLevel * 10))) : 0;
        const finalEnergy = tagEnergy || track.energy || computedEnergy || 0;
        console.log(`[Timing] Gesamt Track: ${(performance.now() - t0total).toFixed(0)} ms`);
        console.groupEnd();
        const updatedTrack: Track = {
            ...track,
            bpm: floatBpm ? Math.round(floatBpm) : track.bpm,
            key: a.camelotKey || a.key || track.key,
            energy: finalEnergy,
            analysis: {
                ...(track.analysis ?? { cuePoints: [], loops: [] }),
                status: "done",
                analysisVersion: "1.0",
                analyzedAt: new Date().toISOString(),
                durationSeconds: a.durationSeconds,
                firstBeatSeconds: gridStart,
                scale: a.scale,
                camelotKey: a.camelotKey ?? undefined,
                gridOffset,
                waveform: a.waveform,
                detectedBpm: floatBpm,
                beatGridStartSeconds: gridStart,
                beats: a.beats,
                beatCount: beatsLen,
                bpmConfidence: a.bpmConfidence,
                bpmSource: "auto",
                energy: finalEnergy || undefined,
                cuePoints: track.analysis?.cuePoints ?? [],
                loops: track.analysis?.loops ?? [],
            },
        };
        const updatedTracks = currentTracks.map(t => t.id === updatedTrack.id ? updatedTrack : t);
        setTracks(updatedTracks);
        onTrackUpdated?.(updatedTrack);
        return { tracks: updatedTracks, essentiaRan: !analysisResult.cached };
    }

    async function handleAnalyzeAll() {
        // Vollständigkeitsprüfung: status:"done" reicht nicht — echte Felder prüfen
        const todo = tracks.filter(t => t.url && getAnalysisMissingFields(t).length > 0);
        if (todo.length === 0) {
            setAnalysisDebugMessage("Alle Tracks vollständig analysiert.");
            return;
        }
        setBatchProgress({ done: 0, total: todo.length });
        let currentTracks = tracks;
        const times: number[] = [];
        let fullAnalyzed = 0, energyFixed = 0, gridFixed = 0, migrated = 0, skipped = 0, errors = 0, detailedLogs = 0;
        const t0total = performance.now();
        const fmtTime = (s: number) => s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${s.toFixed(1)} s`;

        let traceCount = 0;

        for (let i = 0; i < todo.length; i++) {
            const track = todo[i];
            const missing = getAnalysisMissingFields(track);

            const onlyEnergyMissing = missing.length === 1 && missing[0] === "energy";
            const onlyGridMissing   = missing.length === 1 && missing[0] === "gridOffset";
            // GRID_ONLY nur wenn beats tatsächlich im Speicher vorliegen (nicht nur beatCount)
            const hasBeatsInMemory  = (track.analysis?.beats?.length ?? 0) > 0;
            const path = onlyEnergyMissing ? "ENERGY_ONLY"
                       : (onlyGridMissing && hasBeatsInMemory) ? "GRID_ONLY"
                       : "FULL";

            const t0 = performance.now();

            try {
                if (path === "FULL") {
                    const { tracks: newTracks, essentiaRan } = await analyzeTrack(track, currentTracks);
                    const replaced = newTracks !== currentTracks;
                    const hadGridOffset = !!track.analysis?.gridOffset;
                    const after = replaced ? newTracks.find(t => t.id === track.id)?.analysis : undefined;
                    const beatCountAfter = after?.beatCount ?? (after?.beats?.length ?? 0);
                    const durAfter       = after?.durationSeconds ?? 0;

                    let subPath: string;
                    if (!replaced) {
                        subPath = "ERROR";
                        errors++;
                    } else if (essentiaRan && beatCountAfter > 0 && durAfter > 0) {
                        subPath = "FULL_AUDIO";
                        times.push((performance.now() - t0) / 1000);
                        currentTracks = newTracks;
                        saveLibrary(currentTracks, musicFolder);
                        fullAnalyzed++;
                    } else if (essentiaRan) {
                        subPath = "FULL_AUDIO";
                        console.warn(`[handleAnalyzeAll] Essentia lieferte keine Beats: "${track.title}" beatCount=${beatCountAfter} dur=${durAfter}`);
                        currentTracks = newTracks;
                        saveLibrary(currentTracks, musicFolder);
                        errors++;
                    } else if (!hadGridOffset && !!after?.gridOffset) {
                        subPath = "GRID_ONLY";
                        currentTracks = newTracks;
                        saveLibrary(currentTracks, musicFolder);
                        gridFixed++;
                    } else if (onlyGridMissing) {
                        // gridOffset fehlt, Cache-Daten wurden übernommen, aber gridOffset nicht berechenbar → SKIP
                        subPath = "SKIP";
                        currentTracks = newTracks;
                        saveLibrary(currentTracks, musicFolder);
                        skipped++;
                    } else {
                        subPath = "MIGRATION_ONLY";
                        currentTracks = newTracks;
                        saveLibrary(currentTracks, musicFolder);
                        migrated++;
                    }
                    if (traceCount < 5) {
                        traceCount++;
                        console.log(
                            `[Trace #${traceCount}] "${track.title}"`,
                            `\n  missing vorher   : [${missing.join(", ")}]`,
                            `\n  pfad             : ${subPath}`,
                            `\n  Essentia gelaufen: ${essentiaRan ? "ja" : "nein"}`,
                            `\n  duration         : ${durAfter > 0 ? durAfter.toFixed(1) + " s" : "–"}`,
                            `\n  beatCount        : ${beatCountAfter}`,
                            `\n  gridOffset       : ${after?.gridOffset ? "ja" : "nein"}`,
                            `\n  energy           : ${after?.energy ?? "–"}`,
                        );
                    }
                } else if (path === "GRID_ONLY") {
                    // beats liegen im Speicher → gridOffset direkt berechnen, kein Essentia-Lauf
                    const an = track.analysis!;
                    const beats = an.beats!;
                    const bpm = (track.bpm || an.detectedBpm) ?? 0;
                    const gridStart = an.beatGridStartSeconds ?? an.firstBeatSeconds ?? 0;
                    const dur = an.durationSeconds ?? 0;
                    const builtGridOffset = (bpm > 0 && dur > 0) ? buildGridOffset(beats, bpm, gridStart, dur) : undefined;
                    if (builtGridOffset) {
                        const updatedTrack: Track = { ...track, analysis: { ...an, gridOffset: builtGridOffset } };
                        currentTracks = currentTracks.map(t => t.id === updatedTrack.id ? updatedTrack : t);
                        setTracks(currentTracks);
                        saveLibrary(currentTracks, musicFolder);
                        gridFixed++;
                    } else {
                        skipped++;
                    }
                    if (traceCount < 5) {
                        traceCount++;
                        console.log(
                            `[Trace #${traceCount}] "${track.title}"`,
                            `\n  missing vorher   : [${missing.join(", ")}]`,
                            `\n  pfad             : GRID_ONLY`,
                            `\n  Essentia gelaufen: nein`,
                            `\n  duration         : ${dur > 0 ? dur.toFixed(1) + " s" : "–"}`,
                            `\n  beatCount        : ${beats.length}`,
                            `\n  gridOffset       : ${builtGridOffset ? "ja" : "nein (Berechnung fehlgeschlagen)"}`,
                            `\n  energy           : ${an.energy ?? track.energy ?? "–"}`,
                        );
                    }
                } else {
                    // ENERGY_ONLY: nur Energy aus Tag übernehmen, kein Essentia-Lauf
                    const an = track.analysis!;
                    let sourceEnergy = (track.energy ?? 0) || (an.external?.energy ?? 0);
                    if (!sourceEnergy && track.url) {
                        try {
                            const tagData = await invoke<Mp3TagInfo>("read_mp3_tags", { path: track.url });
                            sourceEnergy = parseMixedInKeyComment(tagData.comment).energy ?? 0;
                        } catch { /* ignorieren */ }
                    }
                    if (sourceEnergy > 0) {
                        const updatedTrack: Track = { ...track, analysis: { ...an, energy: sourceEnergy } };
                        currentTracks = currentTracks.map(t => t.id === updatedTrack.id ? updatedTrack : t);
                        setTracks(currentTracks);
                        saveLibrary(currentTracks, musicFolder);
                        energyFixed++;
                    } else {
                        skipped++;
                    }
                    if (traceCount < 5) {
                        traceCount++;
                        const an2 = track.analysis;
                        console.log(
                            `[Trace #${traceCount}] "${track.title}"`,
                            `\n  missing vorher   : [${missing.join(", ")}]`,
                            `\n  pfad             : ${sourceEnergy > 0 ? "ENERGY_ONLY" : "SKIP"}`,
                            `\n  Essentia gelaufen: nein`,
                            `\n  duration         : ${an2?.durationSeconds ? an2.durationSeconds.toFixed(1) + " s" : "–"}`,
                            `\n  beatCount        : ${an2?.beatCount ?? (Array.isArray(an2?.beats) ? an2.beats.length : 0)}`,
                            `\n  gridOffset       : ${an2?.gridOffset ? "ja" : "nein"}`,
                            `\n  energy           : ${sourceEnergy > 0 ? sourceEnergy : "nicht gefunden"}`,
                        );
                    }
                }
            } catch (err) {
                errors++;
                if (detailedLogs < 10) {
                    detailedLogs++;
                    logTrackDebugSnapshot(track, missing, err);
                } else if (detailedLogs === 10) {
                    detailedLogs++;
                    console.warn("[Analyse] Weitere Fehler werden nur gezählt (max. 10 Details erreicht).");
                }
            }
            setBatchProgress({ done: i + 1, total: todo.length });
        }

        setBatchProgress(null);
        _loggedMissingFields.clear();

        const totalSec = (performance.now() - t0total) / 1000;
        const avgSec = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0;

        console.log(`[Analyse] ── Zusammenfassung ──────────────────────────────`);
        console.log(`[Analyse] FULL_AUDIO (neu):  ${fullAnalyzed}  (⌀ ${avgSec.toFixed(1)} s)`);
        console.log(`[Analyse] ENERGY_ONLY:       ${energyFixed}`);
        console.log(`[Analyse] GRID_ONLY:         ${gridFixed}`);
        console.log(`[Analyse] MIGRATION_ONLY:    ${migrated}`);
        console.log(`[Analyse] SKIP:              ${skipped}`);
        console.log(`[Analyse] Fehler:            ${errors}`);
        console.log(`[Analyse] Gesamtzeit:        ${fmtTime(totalSec)}`);

        setAnalysisDebugMessage(
            `Neu: ${fullAnalyzed} · Energy: ${energyFixed} · Grid: ${gridFixed} · Migration: ${migrated} · Skip: ${skipped} · Fehler: ${errors} · ${fmtTime(totalSec)}`
        );
    }

    useEffect(() => {
        const savedTracks = localStorage.getItem(TRACK_LIBRARY_STORAGE_KEY);
        const savedFolder = localStorage.getItem(MUSIC_FOLDER_STORAGE_KEY);

        if (savedTracks) {
            try {
                const parsed = JSON.parse(savedTracks) as Track[];
                setTracks(parsed);
            } catch (e) {
                console.error("Fehler beim Laden der Library:", e);
            }
        }

        if (savedFolder) {
            setMusicFolder(savedFolder);
        }
    }, []);

    async function loadTracksFromFolder(folder: string) {
        const entries = await readDir(folder);

        let externalDataMap: Record<string, Partial<Track>> = {};

        try {
            const dataPath = `${folder}/tkdj-analysis.json`;
            const jsonBytes = await readFile(dataPath);
            const jsonText = new TextDecoder().decode(jsonBytes);
            const parsed = JSON.parse(jsonText);

            externalDataMap = parsed.tracks || {};
        } catch {
            console.log("Keine externen Songdaten gefunden");
        }

        const mp3Entries = entries.filter((entry) => {
            const name = entry.name || "";
            return name.toLowerCase().endsWith(".mp3");
        });

        // Bestehende Analysen aus localStorage holen damit sie beim Ordner-Reload erhalten bleiben
        const savedRaw = localStorage.getItem(TRACK_LIBRARY_STORAGE_KEY);
        const savedByUrl = new Map<string, Track>(
            (savedRaw ? (JSON.parse(savedRaw) as Track[]) : []).map(t => [t.url ?? "", t])
        );

        const mp3Files: Track[] = [];

        for (const [index, entry] of mp3Entries.entries()) {
            const name = entry.name || "Unbekannt.mp3";
            const externalData = externalDataMap[name];
            const url = `${folder}/${name}`;

            let tagData: Mp3TagInfo = {};

            try {
                tagData = await invoke<Mp3TagInfo>("read_mp3_tags", { path: url });
            } catch (error) {
                console.warn("MP3 Tags konnten nicht gelesen werden:", name, error);
            }

            const mixedInKeyData = parseMixedInKeyComment(tagData.comment);
            const existingAnalysis = savedByUrl.get(url)?.analysis;

            mp3Files.push({
                id: `${folder}-${index}`,
                title: externalData?.title || tagData.title || cleanAmazonTitle(name),
                artist: externalData?.artist || tagData.artist || "-",
                bpm: externalData?.bpm || mixedInKeyData.bpm || 0,
                key: externalData?.key || mixedInKeyData.key || "-",
                energy: externalData?.energy || mixedInKeyData.energy || 0,
                duration:
                    externalData?.duration ||
                    formatDurationFromSeconds(tagData.duration_seconds),
                genre: externalData?.genre || tagData.genre || "-",
                url,
                year: externalData?.year || tagData.year,
                analysis: existingAnalysis ?? externalData?.analysis,
            });
        }

        setTracks(mp3Files);
        setMusicFolder(folder);
        saveLibrary(mp3Files, folder);
        setSelectedTrackId(null);
        setEditFields(null);
    }

    async function handleSelectFolder() {
        try {
            const folder = await open({
                directory: true,
                multiple: false,
                title: "Musikordner wählen",
            });

            if (!folder || Array.isArray(folder)) return;

            await loadTracksFromFolder(folder);
        } catch (err) {
            console.error("Fehler beim Lesen:", err);
            alert("Fehler beim Lesen: " + String(err));
        }
    }

    const list =
        tracks.length > 0
            ? tracks
            : musicFolder
                ? []
                : demoTracks;

    const selectedTrack = list.find((track) => track.id === selectedTrackId);

    function selectTrack(track: Track) {
        setSelectedTrackId(track.id);
        setEditFields(toEditFields(track));
        onTrackSelected?.(track);
    }

    function updateEditField<K extends keyof EditFields>(key: K, value: EditFields[K]) {
        setEditFields((current) => {
            if (!current) return current;
            return { ...current, [key]: value };
        });
    }

    function saveSelectedTrack() {
        if (!selectedTrack || !editFields) return;

        const updatedTrack: Track = {
            ...selectedTrack,
            title: editFields.title.trim() || selectedTrack.title,
            artist: editFields.artist.trim() || "-",
            genre: editFields.genre.trim() || "-",
            year: parseOptionalNumber(editFields.year),
            bpm: Math.round(parseOptionalNumber(editFields.bpm) || 0),
            key: editFields.key.trim() || "-",
            energy: Math.round(parseOptionalNumber(editFields.energy) || 0),
        };

        const updatedTracks = tracks.map((track) =>
            track.id === updatedTrack.id ? updatedTrack : track,
        );

        setTracks(updatedTracks);
        saveLibrary(updatedTracks, musicFolder);
        onTrackUpdated?.(updatedTrack);
        setSelectedTrackId(null);
        setEditFields(null);
    }

    function clearSelection() {
        setSelectedTrackId(null);
        setEditFields(null);
    }

    function acceptSuggestion(track: Track, point: TransitionPoint) {
        const existing = track.transitionPoints ?? [];
        if (existing.some(p => p.id === point.id)) return;
        const saved: TransitionPoint = { ...point, source: "manual" };
        const updatedTrack: Track = { ...track, transitionPoints: [...existing, saved] };
        const updatedTracks = tracks.map(t => t.id === updatedTrack.id ? updatedTrack : t);
        setTracks(updatedTracks);
        saveLibrary(updatedTracks, musicFolder);
        onTrackUpdated?.(updatedTrack);
    }

    function removeTransitionPoint(track: Track, pointId: string) {
        const updatedTrack: Track = {
            ...track,
            transitionPoints: (track.transitionPoints ?? []).filter(p => p.id !== pointId),
        };
        const updatedTracks = tracks.map(t => t.id === updatedTrack.id ? updatedTrack : t);
        setTracks(updatedTracks);
        saveLibrary(updatedTracks, musicFolder);
        onTrackUpdated?.(updatedTrack);
        setSelectedPointId(null);
    }

    function parseDurationToSeconds(dur: string): number {
        const p = dur.split(":").map(Number);
        if (p.length === 2) return (p[0] ?? 0) * 60 + (p[1] ?? 0);
        if (p.length === 3) return (p[0] ?? 0) * 3600 + (p[1] ?? 0) * 60 + (p[2] ?? 0);
        return 0;
    }

    const filteredTracks = list
        .filter((track) => {
            const query = searchText.trim().toLowerCase();
            if (!query) return true;

            return [
                track.title,
                track.artist,
                track.genre,
                String(track.bpm || ""),
                track.key,
                String(track.energy || ""),
                String(track.year || ""),
            ]
                .join(" ")
                .toLowerCase()
                .includes(query);
        })
        .sort((a, b) => {
            if (!referenceTrack) return 0;
            if (a.id === referenceTrack.id) return -1;
            if (b.id === referenceTrack.id) return 1;

            const scoreA = calculateTransitionScore(referenceTrack, a).score;
            const scoreB = calculateTransitionScore(referenceTrack, b).score;

            return scoreB - scoreA;
        });

    return (
        <div className="track-list">
            <div className="track-list-title-row">
                <h2>Songliste</h2>
                {referenceTrack && (
                    <span className="track-list-reference">
                        Automix-Referenz: {referenceTrack.title}
                    </span>
                )}

                <button className="library-action-button" type="button" onClick={handleSelectFolder}>
                    Musikordner wählen
                </button>
                <button
                    className="library-action-button"
                    type="button"
                    onClick={handleAnalyzeAll}
                    disabled={!!batchProgress}
                    title="Alle nicht analysierten Tracks analysieren (3 parallel)"
                >
                    {batchProgress
                        ? `Analysiere… ${batchProgress.done}/${batchProgress.total}`
                        : "Alle analysieren"}
                </button>
            </div>

            <div className="track-edit-panel">
                <strong>
                    {selectedTrack ? `Bearbeiten: ${selectedTrack.title}` : "Kein Song ausgewählt"}
                </strong>

                {selectedTrack && (
                    <button
                        type="button"
                        onClick={async () => {
                            setAnalysisDebugMessage("Analyse gestartet...");

                            if (!selectedTrack.url) {
                                setAnalysisDebugMessage("Kein Datei-Pfad vorhanden.");
                                return;
                            }

                            const stretchResult = await convertAndStretch({
                                inputMp3: selectedTrack.url,
                                tempo: 0.95,
                            });

                            if (!stretchResult.success) {
                                setAnalysisDebugMessage("Stretch Fehler: " + stretchResult.error);
                                return;
                            }

                            const analysisResult = await prepareTrackAnalysis(selectedTrack.url);

                            if (analysisResult.success) {
                                setAnalysisDebugMessage(analysisResult.cached ? "Analyse aus Cache geladen" : "Analyse neu berechnet");
                            } else {
                                setAnalysisDebugMessage("Analyse Fehler: " + analysisResult.error);
                            }
                        }}
                    >
                        Analyse Debug testen
                    </button>
                )}


                {analysisDebugMessage && (
                    <div style={{ marginTop: "8px", color: "#86efac", fontWeight: "bold", display: "flex", alignItems: "center", gap: "8px" }}>
                        {analysisDebugMessage}
                        <button
                            type="button"
                            onClick={() => setAnalysisDebugMessage("")}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: "12px", padding: "0" }}
                        >
                            ✕
                        </button>
                    </div>
                )}

                {editFields && (
                    <>
                        <label>
                            Titel
                            <input
                                value={editFields.title}
                                onChange={(event) => updateEditField("title", event.target.value)}
                            />
                        </label>

                        <label>
                            Artist
                            <input
                                value={editFields.artist}
                                onChange={(event) => updateEditField("artist", event.target.value)}
                            />
                        </label>

                        <label>
                            Genre
                            <input
                                value={editFields.genre}
                                onChange={(event) => updateEditField("genre", event.target.value)}
                            />
                        </label>

                        <label>
                            Jahr
                            <input
                                value={editFields.year}
                                onChange={(event) => updateEditField("year", event.target.value)}
                            />
                        </label>

                        <label>
                            BPM
                            <input
                                value={editFields.bpm}
                                onChange={(event) => updateEditField("bpm", event.target.value)}
                            />
                        </label>

                        <label>
                            Key
                            <input
                                value={editFields.key}
                                onChange={(event) => updateEditField("key", event.target.value)}
                            />
                        </label>

                        <label>
                            Energy
                            <input
                                value={editFields.energy}
                                onChange={(event) => updateEditField("energy", event.target.value)}
                            />
                        </label>

                        <div className="track-edit-actions">
                            <button type="button" onClick={saveSelectedTrack}>
                                Speichern
                            </button>
                            <button type="button" onClick={clearSelection}>
                                Abbrechen
                            </button>
                        </div>
                    </>
                )}
            </div>

            <input
                className="track-search"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Song, Artist, Genre, BPM, Key suchen..."
            />

            <div className="track-list-header">
                <span>Titel</span>
                <span>Artist</span>
                <span>BPM</span>
                <span>Key</span>
                <span>Energy</span>
                <span>Genre</span>
                <span>Jahr</span>
                <span>Länge</span>
            </div>

            {filteredTracks.map((track) => {
                const transitionScore =
                    referenceTrack && referenceTrack.id !== track.id
                        ? calculateTransitionScore(referenceTrack, track)
                        : null;

                const backgroundColor =
                    transitionScore && transitionScore.score >= 85
                        ? "rgba(34, 197, 94, 0.25)" // grün = gut
                        : transitionScore && transitionScore.score >= 70
                            ? "rgba(234, 179, 8, 0.15)" // leicht gelb
                            : undefined;

                const savedPoints = track.transitionPoints ?? [];
                const totalSeconds = parseDurationToSeconds(track.duration);
                const suggestions = suggestMenuTrackId === track.id ? suggestTransitionPoints(track) : [];
                const suggestOut = suggestions.filter(p => p.role === "loop-out" || p.role === "cut-out");
                const suggestIn = suggestions.filter(p => p.role === "loop-in" || p.role === "cut-in");
                const suggestPassage = suggestions.filter(p => p.role === "passage-out" || p.role === "passage-in");

                return (
                    <div
                        className="track-row"
                        key={track.id}
                        onClick={() => { setSelectedTrackId(track.id); onTrackSelected?.(track); }}
                        onDoubleClick={() => onLoadA(track)}
                        title={transitionScore ? `Automix-Score: ${transitionScore.score} - ${transitionScore.label}` : "Doppelklick fügt den Song zu Automix hinzu"}
                        style={{
                            backgroundColor,
                            outline: selectedTrackId === track.id ? "2px solid rgba(56, 189, 248, 0.8)" : "none",
                            cursor: "pointer",
                        }}
                    >
                        {/* Titel-Spalte */}
                        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                <button
                                    onClick={(e) => { e.stopPropagation(); (onLoadP1 ?? onLoadA)(track); }}
                                    style={{ background: "rgba(56,189,248,0.15)", border: "1px solid rgba(56,189,248,0.5)", borderRadius: "4px", cursor: "pointer", padding: "2px 7px", color: "#38bdf8", fontWeight: 700, fontSize: "11px" }}
                                    title="In Player 1 laden"
                                >
                                    ▶1
                                </button>
                                {onLoadB && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); onLoadB(track); }}
                                        style={{ background: "rgba(167,139,250,0.15)", border: "1px solid rgba(167,139,250,0.5)", borderRadius: "4px", cursor: "pointer", padding: "2px 7px", color: "#a78bfa", fontWeight: 700, fontSize: "11px" }}
                                        title="In Player 2 laden (Next)"
                                    >
                                        ▶2
                                    </button>
                                )}
                                <button
                                    onClick={(e) => { e.stopPropagation(); selectTrack(track); }}
                                    style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "4px", cursor: "pointer", padding: "2px 6px", color: "#cbd5f5" }}
                                    title="Bearbeiten"
                                >
                                    ✏️
                                </button>
                                <strong>{track.title}</strong>
                                {(() => { const b = getAnalysisBadge(track); return <span style={{ fontSize: "10px", padding: "1px 5px", borderRadius: "4px", background: b.bg, border: `1px solid ${b.border}`, color: b.color, whiteSpace: "nowrap" }}>{b.label}</span>; })()}
                                <button
                                    onClick={e => { e.stopPropagation(); setSuggestMenuTrackId(suggestMenuTrackId === track.id ? null : track.id); }}
                                    style={{ marginLeft: "2px", background: suggestMenuTrackId === track.id ? "rgba(56,189,248,0.25)" : "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.4)", borderRadius: "4px", cursor: "pointer", padding: "2px 6px", color: "#38bdf8" }}
                                    title="Übergangspunkte Vorschläge"
                                >
                                    🎛
                                </button>
                            </div>

                            {/* Mini-Timeline: nur gespeicherte/manuell bestätigte Punkte */}
                            {savedPoints.length > 0 && totalSeconds > 0 && (
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                    <div style={{ flex: 1, position: "relative", height: "10px" }}>
                                        <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: "1px", background: "rgba(148,163,184,0.2)", transform: "translateY(-50%)" }} />
                                        {savedPoints.map(p => {
                                            const pct = Math.min(97, Math.max(2, (p.timeSeconds / totalSeconds) * 100));
                                            const c = ROLE_COLORS[p.role];
                                            const selKey = `${track.id}:${p.id}`;
                                            const isSel = selectedPointId === selKey;
                                            return (
                                                <div
                                                    key={p.id}
                                                    onClick={e => {
                                                        e.stopPropagation();
                                                        if (isSel) {
                                                            removeTransitionPoint(track, p.id);
                                                        } else {
                                                            setSelectedPointId(selKey);
                                                        }
                                                    }}
                                                    title={isSel ? `${p.label ?? p.role} — nochmal klicken zum Entfernen` : `${p.label ?? p.role} @ ${formatTransitionTime(p.timeSeconds)}`}
                                                    style={{
                                                        position: "absolute", left: `${pct}%`, top: "50%",
                                                        transform: "translate(-50%, -50%)",
                                                        width: "8px", height: "8px", borderRadius: "50%",
                                                        background: isSel ? "#fff" : c.text,
                                                        border: isSel ? `2px solid ${c.text}` : "1px solid transparent",
                                                        boxShadow: isSel ? `0 0 6px ${c.text}` : "none",
                                                        cursor: "pointer", zIndex: 2,
                                                    }}
                                                />
                                            );
                                        })}
                                    </div>
                                    <div style={{ display: "flex", gap: "4px", fontSize: "8px", flexShrink: 0, color: "#475569" }}>
                                        <span style={{ color: "#fb923c" }}>⬤ Out</span>
                                        <span style={{ color: "#4ade80" }}>⬤ In</span>
                                        <span style={{ color: "#f87171" }}>⬤ Cut</span>
                                        <span style={{ color: "#60a5fa" }}>⬤ Pass</span>
                                    </div>
                                </div>
                            )}

                            {/* Vorschlag-Menü: nur sichtbar wenn 🎛 gedrückt */}
                            {suggestMenuTrackId === track.id && (() => {
                                const renderGroup = (label: string, pts: typeof suggestions) => {
                                    if (pts.length === 0) return null;
                                    return (
                                        <div style={{ marginBottom: "5px" }}>
                                            <span style={{ fontSize: "9px", color: "#64748b", display: "block", marginBottom: "3px", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
                                            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                                                {pts.map(p => {
                                                    const alreadySaved = savedPoints.some(sp => sp.id === p.id);
                                                    const c = ROLE_COLORS[p.role];
                                                    return (
                                                        <button
                                                            key={p.id}
                                                            disabled={alreadySaved}
                                                            onClick={e => { e.stopPropagation(); acceptSuggestion(track, p); }}
                                                            title={`${p.label} @ ${formatTransitionTime(p.timeSeconds)}`}
                                                            style={{
                                                                background: alreadySaved ? "rgba(255,255,255,0.04)" : c.bg,
                                                                border: `1px solid ${alreadySaved ? "rgba(255,255,255,0.1)" : c.border}`,
                                                                borderRadius: "4px",
                                                                color: alreadySaved ? "#334155" : c.text,
                                                                padding: "2px 7px",
                                                                fontSize: "10px",
                                                                cursor: alreadySaved ? "default" : "pointer",
                                                            }}
                                                        >
                                                            {alreadySaved ? "✓ " : ""}{p.label} · {formatTransitionTime(p.timeSeconds)}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                };
                                return (
                                    <div
                                        onClick={e => e.stopPropagation()}
                                        style={{ marginTop: "4px", padding: "6px 8px", background: "rgba(15,23,42,0.9)", border: "1px solid rgba(56,189,248,0.3)", borderRadius: "6px" }}
                                    >
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "5px" }}>
                                            <span style={{ fontSize: "9px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>Vorschläge — Klick = Übernehmen</span>
                                            <button
                                                onClick={e => { e.stopPropagation(); setSuggestMenuTrackId(null); }}
                                                style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", fontSize: "11px", padding: "0 2px" }}
                                            >✕</button>
                                        </div>
                                        {suggestions.length === 0
                                            ? <span style={{ fontSize: "10px", color: "#475569" }}>Keine Vorschläge (BPM fehlt?)</span>
                                            : <>
                                                {renderGroup("OUT", suggestOut)}
                                                {renderGroup("IN", suggestIn)}
                                                {renderGroup("PASSAGE", suggestPassage)}
                                            </>
                                        }
                                    </div>
                                );
                            })()}
                        </div>

                        <span>{track.artist}</span>
                        <span>{track.bpm || "-"}</span>
                        <span>{track.key}</span>
                        <span>{track.energy || "-"}</span>
                        <span>{track.genre}</span>
                        <span>{track.year || "-"}</span>
                        <span>{track.duration}</span>
                    </div>
                );
            })}
        </div>
    );
}