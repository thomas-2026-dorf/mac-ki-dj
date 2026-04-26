import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readDir, readFile } from "@tauri-apps/plugin-fs";

import { demoTracks } from "../data/demoTracks";
import type { Track } from "../types/track";

const MUSIC_FOLDER_STORAGE_KEY = "tk-dj-music-folder-v1";
const TRACK_LIBRARY_STORAGE_KEY = "tk-dj-track-library-v1";

type Props = {
    onLoadA: (track: Track) => void;
    onLoadB: (track: Track) => void;
    onAddToQueue: (track: Track) => void;
    onTrackUpdated?: (track: Track) => void;
};

function formatDurationFromSeconds(seconds?: number): string {
    if (!seconds || !Number.isFinite(seconds)) return "00:00";

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

        let externalDataMap: Record<string, Partial<Track>> = {};

        try {
            const dataPath = `${folder}/tkdj-analysis.json`;
            const jsonBytes = await readFile(dataPath);
            const jsonText = new TextDecoder().decode(jsonBytes);
            const parsed = JSON.parse(jsonText);

            externalDataMap = parsed.tracks || {};
            console.log("Externe Songdaten geladen:", externalDataMap);
        } catch {
            console.log("Keine externen Songdaten gefunden");
        }

        const mp3Files: Track[] = entries
            .filter((entry) => {
                const name = entry.name || "";
                return name.toLowerCase().endsWith(".mp3");
            })
            .map((entry, index) => {
                const name = entry.name || "Unbekannt.mp3";
                const externalData = externalDataMap[name];

                return {
                    id: `${folder}-${index}`,
                    title: externalData?.title || name.replace(/\.mp3$/i, ""),
                    artist: externalData?.artist || "Local",
                    bpm: externalData?.bpm || 0,
                    key: externalData?.key || "-",
                    energy: externalData?.energy || 0,
                    duration:
                        externalData?.duration ||
                        formatDurationFromSeconds(
                            typeof externalData?.duration === "number"
                                ? externalData.duration
                                : undefined,
                        ),
                    genre: externalData?.genre || "Local",
                    url: `${folder}/${name}`,
                    year: externalData?.year,
                    mood: externalData?.mood,
                    favorite: externalData?.favorite,
                    rating: externalData?.rating,
                    mixInSeconds: externalData?.mixInSeconds,
                    mixOutSeconds: externalData?.mixOutSeconds,
                    introEndSeconds: externalData?.introEndSeconds,
                    outroStartSeconds: externalData?.outroStartSeconds,
                    cuePoints: externalData?.cuePoints || [],
                    loops: externalData?.loops || [],
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

    function openOnlineSongCheck(track: Track) {
        const query = [
            track.artist,
            track.title,
            "BPM key energy song",
        ]
            .filter(Boolean)
            .join(" ");

        const url = "https://www.google.com/search?q=" + encodeURIComponent(query);
        window.open(url, "_blank");
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
            String(track.energy || ""),
            String(track.year || ""),
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
                placeholder="Song, Interpret, Genre, BPM, Key suchen..."
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
                            {track.year ? ` · ${track.year}` : ""}
                        </small>
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
                                {track.bpm || "-"}
                            </button>
                        )}
                    </span>

                    <span>{track.key}</span>
                    <span>{track.energy}</span>
                    <span>{track.duration}</span>

                    <div className="load-buttons">
                        <button type="button" onClick={() => onLoadA(track)}>
                            A
                        </button>
                        <button type="button" onClick={() => onLoadB(track)}>
                            B
                        </button>
                        <button type="button" onClick={() => onAddToQueue(track)}>
                            +
                        </button>
                        <button type="button" onClick={() => openOnlineSongCheck(track)}>
                            Online prüfen
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}