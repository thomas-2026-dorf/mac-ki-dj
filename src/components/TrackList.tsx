import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readDir, readFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";

import { demoTracks } from "../data/demoTracks";
import type { Track } from "../types/track";
import { analyzeAudioBuffer } from "../modules/analysis/audioAnalyzer";

const MUSIC_FOLDER_STORAGE_KEY = "tk-dj-music-folder-v1";
const TRACK_LIBRARY_STORAGE_KEY = "tk-dj-track-library-v1";

type Props = {
    onLoadA: (track: Track) => void;
    onLoadB: (track: Track) => void;
    onAddToQueue: (track: Track) => void;
    onTrackUpdated?: (track: Track) => void;
};

function getAnalysisLabel(track: Track) {
    if (track.analysis?.status === "done") return "Analyse fertig";
    if (track.analysis?.status === "pending") return "Analyse geplant";
    if (track.analysis?.status === "error") return "Analyse Fehler";
    return "Nicht analysiert";
}

function getAnalysisColor(track: Track) {
    if (track.analysis?.status === "done") return "lightgreen";
    if (track.analysis?.status === "pending") return "orange";
    if (track.analysis?.status === "error") return "red";
    return "#aaa";
}

function formatDuration(seconds: number): string {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export default function TrackList({
    onLoadA,
    onLoadB,
    onAddToQueue,
    onTrackUpdated,
}: Props) {
    const [tracks, setTracks] = useState<Track[]>([]);
    const [musicFolder, setMusicFolder] = useState<string | null>(null);
    const [searchText, setSearchText] = useState("");
    const [editingBpmTrackId, setEditingBpmTrackId] = useState<string | null>(null);
    const [editingBpmValue, setEditingBpmValue] = useState("");

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

        const mp3Files: Track[] = entries
            .filter((entry) => {
                const name = entry.name || "";
                return name.toLowerCase().endsWith(".mp3");
            })
            .map((entry, index) => {
                const name = entry.name || "Unbekannt.mp3";

                return {
                    id: `${folder}-${index}`,
                    title: name.replace(/\.mp3$/i, ""),
                    artist: "Local",
                    bpm: 0,
                    key: "-",
                    energy: 0,
                    duration: "00:00",
                    genre: "Local",
                    url: `${folder}/${name}`,
                    analysis: {
                        status: "none",
                        cuePoints: [],
                        loops: [],
                    },
                };
            });

        setTracks(mp3Files);
        setMusicFolder(folder);
        saveLibrary(mp3Files, folder);
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

    async function markForAnalysis(trackId: string) {
        const track = tracks.find((t) => t.id === trackId);
        if (!track) return;

        const updated = tracks.map((t) => {
            if (t.id !== trackId) return t;

            return {
                ...t,
                analysis: {
                    ...(t.analysis || {
                        cuePoints: [],
                        loops: [],
                    }),
                    status: "pending" as const,
                },
            };
        });

        setTracks(updated);
        saveLibrary(updated, musicFolder);

        await runRealBasicAnalysis(track);
    }

    async function runRealBasicAnalysis(track: Track) {
        try {
            if (!track.url) {
                alert("Kein Dateipfad vorhanden");
                return;
            }

            const audioBytes = await readFile(track.url);
            const info = await analyzeAudioBuffer(audioBytes);

            const updated = tracks.map((t) => {
                if (t.id !== track.id) return t;

                return {
                    ...t,
                    duration: formatDuration(info.durationSeconds),
                    bpm: info.bpm ?? t.bpm,
                    key: info.camelotKey ?? info.key ?? t.key,
                    energy: info.energyLevel,

                    analysis: {
                        ...(t.analysis || {
                            cuePoints: [],
                            loops: [],
                        }),
                        status: "done" as const,
                        analyzedAt: new Date().toISOString(),
                        detectedBpm: info.bpm ?? undefined,
                        beatGridStartSeconds: info.cuePoints[0]?.timeSeconds ?? 0,
                        detectedKey: info.camelotKey ?? info.key ?? undefined,
                        bpmSource: "auto" as const,
                        bpmConfidence: info.bpmConfidence,
                        bpmConfirmed: false,
                        waveform: info.waveform,
                        debug: info.debug,
                        cuePoints: info.cuePoints.map((cue) => ({
                            id: cue.id,
                            name: cue.label,
                            timeSeconds: cue.timeSeconds,
                            type: cue.kind === "first_beat" ? "drum" as const : "transition" as const,
                        })),
                        loops: t.analysis?.loops || [],
                    },
                };
            });

            setTracks(updated);
            saveLibrary(updated, musicFolder);

            const updatedTrack = updated.find((t) => t.id === track.id);
            if (updatedTrack) {
                onTrackUpdated?.(updatedTrack);
            }

        } catch (err) {
            console.error("Echte Analyse Fehler:", err);
            alert("Analyse Fehler: " + String(err));
        }
    }

function runFakeAnalysis(track: Track): Track {
        return {
            ...track,
            bpm: track.bpm || 124,
            key: track.key === "-" ? "8A" : track.key,
            energy: track.energy || 7,
            analysis: {
                ...(track.analysis || {
                    cuePoints: [],
                    loops: [],
                }),
                status: "done" as const,
                analyzedAt: new Date().toISOString(),
                detectedBpm: track.bpm || 124,
                detectedKey: track.key === "-" ? "8A" : track.key,
                introEndSeconds: 16,
                outroStartSeconds: 165,
                hasDjOutro: false,
                note: "Fake-Analyse Batch",
                cuePoints: [
                    {
                        id: `${track.id}-start`,
                        name: "Start",
                        timeSeconds: 0,
                        type: "start" as const,
                    },
                ],
                loops: [],
            },
        };
    }

    function analyzeAll() {
        const updated = tracks.map((track) => {
            if (track.analysis?.status !== "done") {
                return runFakeAnalysis(track);
            }

            return track;
        });

        setTracks(updated);
        saveLibrary(updated, musicFolder);
    }

    const list =
        tracks.length > 0
            ? tracks
            : musicFolder
                ? []
                : demoTracks;

    function startEditBpm(track: Track) {
        setEditingBpmTrackId(track.id);
        setEditingBpmValue(String(track.bpm || ""));
    }

    function cancelEditBpm() {
        setEditingBpmTrackId(null);
        setEditingBpmValue("");
    }

    

function applyManualBpm(track: Track, bpm: number) {
    const roundedBpm = Math.round(bpm);

    const updatedTracks = tracks.map((t) => {
        if (t.id !== track.id) return t;

        return {
            ...t,
            bpm: roundedBpm,
            analysis: {
                ...(t.analysis || {
                    status: "done" as const,
                    cuePoints: [],
                    loops: [],
                }),
                detectedBpm: roundedBpm,
                manualBpm: roundedBpm,
                bpmSource: "manual" as const,
                bpmConfidence: "high" as const,
                bpmConfirmed: true,
                cuePoints: t.analysis?.cuePoints || [],
                loops: t.analysis?.loops || [],
            },
        };
    });

    setTracks(updatedTracks);
    saveLibrary(updatedTracks, musicFolder);
}

function openOnlineSongCheck(track: Track) {
    const query = [
        track.artist,
        track.title,
        "BPM key energy song"
    ]
        .filter(Boolean)
        .join(" ");

    const url = "https://www.google.com/search?q=" + encodeURIComponent(query);
    window.open(url, "_blank");
}

type BackendAudioAnalysisResult = {
    bpm: number;
    beat_interval_seconds: number;
    beats: number[];
    grid_start_seconds: number;
    file_size_bytes: number;
    sample_count: number;
};

async function testBackendAnalysis(track: Track) {
    if (!track.url) {
        alert("Kein Dateipfad vorhanden");
        return;
    }

    try {
        const result = await invoke<BackendAudioAnalysisResult>("analyze_audio_file", {
            path: track.url,
        });

        console.log("Backend Analyse Dummy:", result);

        const updatedTracks = tracks.map((currentTrack) => {
            if (currentTrack.id !== track.id) return currentTrack;

            return {
                ...currentTrack,
                bpm: currentTrack.bpm || Math.round(result.bpm),
                analysis: {
                    ...(currentTrack.analysis || {
                        cuePoints: [],
                        loops: [],
                    }),
                    status: "done" as const,
                    analyzedAt: new Date().toISOString(),
                    analysisVersion: "aubio-v1",
                    detectedBpm: Math.round(result.bpm),
                    beatGridStartSeconds: result.grid_start_seconds,
                    beats: result.beats,
                    bpmSource: "auto" as const,
                    bpmConfidence: "medium" as const,
                    bpmConfirmed: false,
                    cuePoints: [
                        ...(currentTrack.analysis?.cuePoints || []),
                        {
                            id: `${currentTrack.id}-backend-grid-start`,
                            name: "Backend Grid Start",
                            timeSeconds: result.grid_start_seconds,
                            type: "drum" as const,
                        },
                    ],
                    loops: currentTrack.analysis?.loops || [],
                    debug: {
                        onsetCount: currentTrack.analysis?.debug?.onsetCount || 0,
                        bpmCandidates: currentTrack.analysis?.debug?.bpmCandidates || [],
                        tempogramCandidates: currentTrack.analysis?.debug?.tempogramCandidates || [],
                        backendBeats: result.beats,
                        backendGridStartSeconds: result.grid_start_seconds,
                    },
                },
            };
        });

        setTracks(updatedTracks);
        saveLibrary(updatedTracks, musicFolder);

        const updatedTrack = updatedTracks.find((currentTrack) => currentTrack.id === track.id);
        if (updatedTrack) {
            onTrackUpdated?.(updatedTrack);
        }

        alert(
            "Backend Analyse gespeichert\n" +
            "BPM: " + result.bpm + "\n" +
            "Beat-Abstand: " + (60 / result.bpm).toFixed(3) + " Sekunden\n" +
            "Beats gespeichert: " + result.beats.length + "\n" +
            "Grid Start: " + result.grid_start_seconds
        );
    } catch (err) {
        console.error("Backend Analyse Fehler:", err);
        alert("Backend Analyse Fehler: " + String(err));
    }
}

function getRecommendedBpm(track: Track): number | null {
    const candidates = track.analysis?.debug?.bpmCandidates || [];
    const tempogram = track.analysis?.debug?.tempogramCandidates || [];

    if (candidates.length === 0) return null;

    const match = candidates.find((bpm) =>
        tempogram.some((t) => Math.abs(t - bpm) <= 2)
    );

    let bpm = match ?? tempogram[0] ?? candidates[0];

    if (!bpm) return null;

    while (bpm < 80) bpm *= 2;
    while (bpm > 160) bpm /= 2;

    return Math.round(bpm);
}

function saveEditedBpm(track: Track) {
        const parsedBpm = Number(editingBpmValue.replace(",", "."));

        if (!Number.isFinite(parsedBpm) || parsedBpm <= 0) {
            alert("Bitte eine gültige BPM-Zahl eingeben.");
            return;
        }

        const roundedBpm = Math.round(parsedBpm);

        const updatedTracks = tracks.map((currentTrack) => {
            if (currentTrack.id !== track.id) return currentTrack;

            return {
                ...currentTrack,
                bpm: roundedBpm,
                analysis: {
                    ...(currentTrack.analysis || {
                        status: "done" as const,
                        cuePoints: [],
                        loops: [],
                    }),
                    detectedBpm: roundedBpm,
                    manualBpm: roundedBpm,
                    bpmSource: "manual" as const,
                    bpmConfidence: "high" as const,
                    bpmConfirmed: true,
                    cuePoints: currentTrack.analysis?.cuePoints || [],
                    loops: currentTrack.analysis?.loops || [],
                },
            };
        });

        setTracks(updatedTracks);
        saveLibrary(updatedTracks, musicFolder);

        const updatedTrack = updatedTracks.find((currentTrack) => currentTrack.id === track.id);
        if (updatedTrack) {
            onTrackUpdated?.(updatedTrack);
        }

        cancelEditBpm();
    }

    const filteredTracks = list.filter((track) => {
        const query = searchText.trim().toLowerCase();
        if (!query) return true;

        return [
            track.title,
            track.artist,
            track.genre,
            String(track.bpm || ""),
            track.key,
        ]
            .join(" ")
            .toLowerCase()
            .includes(query);
    });

    return (
        <div className="track-list">
            <div className="track-list-title-row">
                <h2>Songliste</h2>

                <button type="button" onClick={handleSelectFolder}>
                    Musikordner wählen
                </button>

                <button type="button" onClick={analyzeAll} disabled={tracks.length === 0}>
                    Alle analysieren
                </button>
            </div>

            {musicFolder && (
                <div className="music-folder-info">
                    Musikordner: {musicFolder}
                </div>
            )}

            <input
                className="track-search"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Song, Interpret, Genre, BPM suchen..."
            />

            <div className="track-list-header">
                <span>Titel</span>
                <span>BPM</span>
                <span>Key</span>
                <span>Energy</span>
                <span>Länge</span>
                <span></span>
            </div>

            {filteredTracks.map((track) => (
                <div className="track-row" key={track.id}>
                    <div>
                        <strong>{track.title}</strong>
                        <small>
                            {track.artist} · {track.genre}
                        </small>
                        {track.analysis?.bpmConfidence && (
                            <small style={{ color: track.analysis.bpmConfidence === "high" ? "lightgreen" : track.analysis.bpmConfidence === "medium" ? "orange" : "red" }}>
                                BPM-Sicherheit: {track.analysis.bpmConfidence}
                            </small>
                        )}

                        {track.analysis?.debug && (
                            <small style={{ color: "#888" }}>
                                Onsets: {track.analysis.debug.onsetCount} · Kandidaten: {track.analysis.debug.bpmCandidates.join(", ")} · Tempogram: {track.analysis.debug.tempogramCandidates?.join(", ") || "-"}
                            </small>
                        )}

                        <div style={{ color: getAnalysisColor(track), fontSize: "12px" }}>
                            {getAnalysisLabel(track)}
                            {track.analysis?.status === "done" &&
                                ` · BPM ${track.analysis.detectedBpm} · Key ${track.analysis.detectedKey}`}
                        </div>
                    </div>

                    <span>
                        {editingBpmTrackId === track.id ? (
                            <span className="bpm-edit">
                                <input
                                    value={editingBpmValue}
                                    onChange={(event) => setEditingBpmValue(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter") saveEditedBpm(track);
                                        if (event.key === "Escape") cancelEditBpm();
                                    }}
                                    autoFocus
                                />
                                <button type="button" onClick={() => saveEditedBpm(track)}>
                                    OK
                                </button>
                                <button type="button" onClick={cancelEditBpm}>
                                    ×
                                </button>
                            </span>
                        ) : (
                            <button
                                type="button"
                                className="bpm-edit-button"
                                onClick={() => startEditBpm(track)}
                                title="BPM bearbeiten"
                            >
                                {track.bpm}
                            </button>
                        )}
                    </span>
                    <span>{track.key}</span>
                    <span>{track.energy}</span>
                    <span>{track.duration}</span>

                    <div className="load-buttons">
                        <button type="button" onClick={() => onLoadA(track)}>A</button>
                        <button type="button" onClick={() => onLoadB(track)}>B</button>
                        <button type="button" onClick={() => onAddToQueue(track)}>+</button>

<button type="button" onClick={() => openOnlineSongCheck(track)}>
    Online prüfen
</button>

<button
    type="button"
    onClick={() => {
        const recommended = getRecommendedBpm(track);
        if (!recommended) {
            alert("Kein Vorschlag verfügbar");
            return;
        }

        
applyManualBpm(track, recommended);
alert("BPM gesetzt auf " + recommended);

        cancelEditBpm();
    }}
>
    Empfohlen
</button>

                        {track.analysis?.status !== "done" && (
                            <button type="button" onClick={() => markForAnalysis(track.id)}>
                                Analyse vormerken
                            </button>
                        )}

                        <button type="button" onClick={() => runRealBasicAnalysis(track)}>
                            Audio testen
                        </button>

                        <button type="button" onClick={() => testBackendAnalysis(track)}>
                            Backend testen
                        </button>

                    </div>
                </div>
            ))}
        </div>
    );
}
