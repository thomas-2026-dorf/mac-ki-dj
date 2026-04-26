import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readDir, readFile } from "@tauri-apps/plugin-fs";

import { demoTracks } from "../data/demoTracks";
import type { Track } from "../types/track";

const MUSIC_FOLDER_STORAGE_KEY = "tk-dj-music-folder-v1";
const TRACK_LIBRARY_STORAGE_KEY = "tk-dj-track-library-v1";

type Props = {
    onLoadA: (track: Track) => void;
    onTrackUpdated?: (track: Track) => void;
};

type EditFields = {
    title: string;
    artist: string;
    genre: string;
    year: string;
    bpm: string;
    key: string;
    energy: string;
    mood: "" | "warmup" | "dance" | "peak" | "cooldown";
    favorite: boolean;
    rating: string;
    mixInSeconds: string;
    mixOutSeconds: string;
    introEndSeconds: string;
    outroStartSeconds: string;
};

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
        mood: track.mood || "",
        favorite: !!track.favorite,
        rating: track.rating ? String(track.rating) : "",
        mixInSeconds: track.mixInSeconds ? String(track.mixInSeconds) : "",
        mixOutSeconds: track.mixOutSeconds ? String(track.mixOutSeconds) : "",
        introEndSeconds: track.introEndSeconds ? String(track.introEndSeconds) : "",
        outroStartSeconds: track.outroStartSeconds ? String(track.outroStartSeconds) : "",
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
        // .mp3 entfernen
        .replace(/\.mp3$/i, "")

        // führende Nummern entfernen (08 - / 01_ / 12.)
        .replace(/^\d+\s*[-_.]\s*/, "")

        // alles ab _UUID oder -UUID entfernen
        .replace(/[_-][a-f0-9]{8,}.*$/i, "")

        // doppelte Leerzeichen
        .replace(/\s+/g, " ")

        // trim
        .trim();
}
export default function TrackList({
    onLoadA,
    onTrackUpdated,
}: Props) {

    const [tracks, setTracks] = useState<Track[]>([]);
    const [musicFolder, setMusicFolder] = useState<string | null>(null);
    const [searchText, setSearchText] = useState("");

    const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
    const [editFields, setEditFields] = useState<EditFields | null>(null);

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
                    title: externalData?.title || cleanAmazonTitle(name),
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
            artist: editFields.artist.trim() || "Local",
            genre: editFields.genre.trim() || "Local",
            year: parseOptionalNumber(editFields.year),
            bpm: Math.round(parseOptionalNumber(editFields.bpm) || 0),
            key: editFields.key.trim() || "-",
            energy: Math.round(parseOptionalNumber(editFields.energy) || 0),
            mood: editFields.mood || undefined,
            favorite: editFields.favorite,
            rating: parseOptionalNumber(editFields.rating),
            mixInSeconds: parseOptionalNumber(editFields.mixInSeconds),
            mixOutSeconds: parseOptionalNumber(editFields.mixOutSeconds),
            introEndSeconds: parseOptionalNumber(editFields.introEndSeconds),
            outroStartSeconds: parseOptionalNumber(editFields.outroStartSeconds),
        };

        const updatedTracks = tracks.map((track) =>
            track.id === updatedTrack.id ? updatedTrack : track,
        );

        setTracks(updatedTracks);
        saveLibrary(updatedTracks, musicFolder);
        onTrackUpdated?.(updatedTrack);
        setEditFields(toEditFields(updatedTrack));
    }

    function clearSelection() {
        setSelectedTrackId(null);
        setEditFields(null);
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
            track.mood || "",
            String(track.rating || ""),
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

                <button
                    type="button"
                    onClick={() => {
                        const cleanedTracks = tracks.map((track) => ({
                            ...track,
                            title: cleanAmazonTitle(track.title),
                        }));

                        setTracks(cleanedTracks);
                        saveLibrary(cleanedTracks, musicFolder);
                    }}
                    disabled={tracks.length === 0}
                >
                    Titel bereinigen
                </button>
            </div>

            {musicFolder && (
                <div className="music-folder-info">
                    Musikordner: {musicFolder}
                </div>
            )}

            <div className="track-edit-panel">
                <strong>
                    {selectedTrack ? `Bearbeiten: ${selectedTrack.title}` : "Kein Song ausgewählt"}
                </strong>

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
                            Interpret
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

                        <label>
                            Phase
                            <select
                                value={editFields.mood}
                                onChange={(event) =>
                                    updateEditField("mood", event.target.value as EditFields["mood"])
                                }
                            >
                                <option value="">Keine</option>
                                <option value="warmup">Warmup</option>
                                <option value="dance">Dance</option>
                                <option value="peak">Peak</option>
                                <option value="cooldown">Cooldown</option>
                            </select>
                        </label>

                        <label>
                            Rating
                            <input
                                value={editFields.rating}
                                onChange={(event) => updateEditField("rating", event.target.value)}
                            />
                        </label>

                        <label>
                            Mix-In
                            <input
                                value={editFields.mixInSeconds}
                                onChange={(event) =>
                                    updateEditField("mixInSeconds", event.target.value)
                                }
                            />
                        </label>

                        <label>
                            Mix-Out
                            <input
                                value={editFields.mixOutSeconds}
                                onChange={(event) =>
                                    updateEditField("mixOutSeconds", event.target.value)
                                }
                            />
                        </label>

                        <label>
                            Intro Ende
                            <input
                                value={editFields.introEndSeconds}
                                onChange={(event) =>
                                    updateEditField("introEndSeconds", event.target.value)
                                }
                            />
                        </label>

                        <label>
                            Outro Start
                            <input
                                value={editFields.outroStartSeconds}
                                onChange={(event) =>
                                    updateEditField("outroStartSeconds", event.target.value)
                                }
                            />
                        </label>

                        <label>
                            <input
                                type="checkbox"
                                checked={editFields.favorite}
                                onChange={(event) =>
                                    updateEditField("favorite", event.target.checked)
                                }
                            />
                            Favorit
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
                placeholder="Song, Interpret, Genre, BPM, Key suchen..."
            />

            <div className="track-list-header">
                <span>Titel</span>
                <span>BPM</span>
                <span>Key</span>
                <span>Energy</span>
                <span>Phase</span>
                <span>Mix</span>
                <span>Länge</span>
                <span>Laden</span>
            </div>

            {filteredTracks.map((track) => (
                <div
                    className="track-row"
                    key={track.id}
                    onClick={() => selectTrack(track)}
                    onDoubleClick={() => onLoadA(track)}
                    title="Doppelklick lädt in Deck A"
                    style={{
                        outline:
                            selectedTrackId === track.id
                                ? "2px solid rgba(56, 189, 248, 0.8)"
                                : "none",
                        cursor: "pointer",
                    }}
                >
                    <div>
                        <strong>
                            {track.favorite ? "★ " : ""}
                            {track.title}
                        </strong>
                        <small>
                            {track.artist} · {track.genre}
                            {track.year ? ` · ${track.year}` : ""}
                            {track.rating ? ` · Rating ${track.rating}` : ""}
                        </small>
                    </div>

                    <span>{track.bpm || "-"}</span>
                    <span>{track.key}</span>
                    <span>{track.energy || "-"}</span>
                    <span>{track.mood || "-"}</span>
                    <span>
                        IN {track.mixInSeconds ?? "-"} / OUT {track.mixOutSeconds ?? "-"}
                    </span>
                    <span>{track.duration}</span>

                    <span style={{ color: "#64748b", fontSize: "11px" }}>
                        Doppelklick → Deck A
                    </span>
                </div>
            ))}
        </div>
    );
}