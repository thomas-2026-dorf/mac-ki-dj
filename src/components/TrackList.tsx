import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readDir, readFile } from "@tauri-apps/plugin-fs";

import { demoTracks } from "../data/demoTracks";
import type { Track } from "../types/track";
import { analyzeAudioBuffer } from "../modules/analysis/audioAnalyzer";

const MUSIC_FOLDER_STORAGE_KEY = "tk-dj-music-folder-v1";
const TRACK_LIBRARY_STORAGE_KEY = "tk-dj-track-library-v1";

type Props = {
    onLoadA: (track: Track) => void;
    onLoadB: (track: Track) => void;
    onAddToQueue: (track: Track) => void;
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
}: Props) {
    const [tracks, setTracks] = useState<Track[]>([]);
    const [musicFolder, setMusicFolder] = useState<string | null>(null);

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

    function markForAnalysis(trackId: string) {
        const updated = tracks.map((track) => {
            if (track.id !== trackId) return track;

            return {
                ...track,
                analysis: {
                    ...(track.analysis || {
                        cuePoints: [],
                        loops: [],
                    }),
                    status: "pending" as const,
                },
            };
        });

        setTracks(updated);
        saveLibrary(updated, musicFolder);
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
                    bpm: info.estimatedBpm ?? t.bpm,

                    analysis: {
                        ...(t.analysis || {
                            cuePoints: [],
                            loops: [],
                        }),
                        ...(t.analysis || {
                            cuePoints: [],
                            loops: [],
                        }),
                        status: "done" as const,
                        analyzedAt: new Date().toISOString(),
                        durationSeconds: info.durationSeconds,
                        sampleRate: info.sampleRate,
                        cchannels: info.numberOfChannels,
                        detectedBpm: info.estimatedBpm ?? undefined,
                    },
                };
            });

            setTracks(updated);
            saveLibrary(updated, musicFolder);

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

            <div className="track-list-header">
                <span>Titel</span>
                <span>BPM</span>
                <span>Key</span>
                <span>Energy</span>
                <span>Länge</span>
                <span></span>
            </div>

            {list.map((track) => (
                <div className="track-row" key={track.id}>
                    <div>
                        <strong>{track.title}</strong>
                        <small>
                            {track.artist} · {track.genre}
                        </small>

                        <div style={{ color: getAnalysisColor(track), fontSize: "12px" }}>
                            {getAnalysisLabel(track)}
                            {track.analysis?.status === "done" &&
                                ` · BPM ${track.analysis.detectedBpm} · Key ${track.analysis.detectedKey}`}
                        </div>
                    </div>

                    <span>{track.bpm}</span>
                    <span>{track.key}</span>
                    <span>{track.energy}</span>
                    <span>{track.duration}</span>

                    <div className="load-buttons">
                        <button type="button" onClick={() => onLoadA(track)}>A</button>
                        <button type="button" onClick={() => onLoadB(track)}>B</button>
                        <button type="button" onClick={() => onAddToQueue(track)}>+</button>

                        {track.analysis?.status !== "done" && (
                            <button type="button" onClick={() => markForAnalysis(track.id)}>
                                Analyse vormerken
                            </button>
                        )}

                        <button type="button" onClick={() => runRealBasicAnalysis(track)}>
                            Audio testen
                        </button>

                        {track.analysis?.status === "done" && (
                            <button type="button" disabled>
                                Analysiert
                            </button>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}