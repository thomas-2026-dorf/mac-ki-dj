import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readDir, readFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";

import { demoTracks } from "../data/demoTracks";
import { calculateTransitionScore } from "../modules/transition/transitionScore";
import { convertAndStretch } from "../modules/audio/timeStretchEngine";
import { prepareTrackAnalysis } from "../modules/analysis/trackAnalysisEngine";
import type { Track } from "../types/track";

const MUSIC_FOLDER_STORAGE_KEY = "tk-dj-music-folder-v1";
const TRACK_LIBRARY_STORAGE_KEY = "tk-dj-track-library-v1";

type Props = {
    onLoadA: (track: Track) => void;
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

    const match = comment.match(/\b(([1-9]|1[0-2])[AB])\b\s*[-|/]\s*(\d{2,3}(?:[.,]\d+)?)\s*[-|/]\s*(10|[1-9])\b/i);

    if (!match) return {};

    return {
        key: match[1].toUpperCase(),
        bpm: Math.round(Number(match[3].replace(",", "."))),
        energy: Number(match[4]),
    };
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

export default function TrackList({
    onLoadA,
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

    function saveLibrary(updatedTracks: Track[], folder: string | null) {
        localStorage.setItem(TRACK_LIBRARY_STORAGE_KEY, JSON.stringify(updatedTracks));

        if (folder) {
            localStorage.setItem(MUSIC_FOLDER_STORAGE_KEY, folder);
        }
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

                return (
                    <div
                        className="track-row"
                        key={track.id}
                        onClick={() => {
                            setSelectedTrackId(track.id);
                            onTrackSelected?.(track);
                        }}
                        onDoubleClick={() => onLoadA(track)}
                        title={
                            transitionScore
                                ? `Automix-Score: ${transitionScore.score} - ${transitionScore.label}`
                                : "Doppelklick fügt den Song zu Automix hinzu"
                        }
                        style={{
                            backgroundColor,
                            outline:
                                selectedTrackId === track.id
                                    ? "2px solid rgba(56, 189, 248, 0.8)"
                                    : "none",
                            cursor: "pointer",
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    selectTrack(track);
                                }}
                                style={{
                                    background: "transparent",
                                    border: "1px solid rgba(255,255,255,0.2)",
                                    borderRadius: "4px",
                                    cursor: "pointer",
                                    padding: "2px 6px",
                                    color: "#cbd5f5"
                                }}
                                title="Bearbeiten"
                            >
                                ✏️
                            </button>
                            <strong>{track.title}</strong>
                            <button
                                onClick={async (e) => {
                                    e.stopPropagation();

                                    if (!track.url) {
                                        setAnalysisDebugMessage("Kein Datei-Pfad vorhanden.");
                                        return;
                                    }

                                    setAnalysisDebugMessage("Analyse gestartet...");
                                    const analysisResult = await prepareTrackAnalysis(track.url);

                                    if (analysisResult.success && analysisResult.analysis) {
                                        const a = analysisResult.analysis;
                                        const r = analysisResult.rustAnalysis;

                                        // Float-BPM: Stratum > Aubio > JS (in dieser Reihenfolge)
                                        const floatBpm = r?.stratum_bpm ?? r?.bpm ?? a.bpm ?? undefined;
                                        // Downbeat (Bar-Start): Stratum-Downbeat > Aubio-Grid > JS-Onset
                                        const gridStart = (r?.stratum_downbeats?.[0] ?? r?.grid_start_seconds ?? a.beatGridStartSeconds) as number | undefined;

                                        const updatedTrack: Track = {
                                            ...track,
                                            bpm: floatBpm ? Math.round(floatBpm) : track.bpm,
                                            key: a.camelotKey || a.key || track.key,
                                            energy: a.energyLevel ? Math.round(a.energyLevel) : track.energy,
                                            analysis: {
                                                ...(track.analysis ?? { cuePoints: [], loops: [] }),
                                                status: "done",
                                                waveform: a.waveform,
                                                detectedBpm: floatBpm,
                                                beatGridStartSeconds: gridStart,
                                                beats: r?.beats,
                                                bpmConfidence: a.bpmConfidence,
                                                bpmSource: "auto",
                                                cuePoints: track.analysis?.cuePoints ?? [],
                                                loops: track.analysis?.loops ?? [],
                                            },
                                        };
                                        const updatedTracks = tracks.map((t) =>
                                            t.id === updatedTrack.id ? updatedTrack : t
                                        );
                                        setTracks(updatedTracks);
                                        saveLibrary(updatedTracks, musicFolder);
                                        onTrackUpdated?.(updatedTrack);
                                        setAnalysisDebugMessage(
                                            (analysisResult.cached ? "Cache: " : "Neu: ") +
                                            `BPM ${updatedTrack.bpm} · Key ${updatedTrack.key} · Energy ${updatedTrack.energy}`
                                        );
                                    } else {
                                        setAnalysisDebugMessage("Analyse Fehler: " + analysisResult.error);
                                    }
                                }}
                                style={{
                                    marginLeft: "6px",
                                    background: "rgba(34,197,94,0.2)",
                                    border: "1px solid rgba(34,197,94,0.5)",
                                    borderRadius: "4px",
                                    cursor: "pointer",
                                    padding: "2px 6px",
                                    color: "#86efac"
                                }}
                                title="Track analysieren"
                            >
                                ⚡
                            </button>
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