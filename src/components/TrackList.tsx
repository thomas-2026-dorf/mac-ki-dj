import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readDir } from "@tauri-apps/plugin-fs";

import { demoTracks } from "../data/demoTracks";
import type { Track } from "../types/track";

type Props = {
    onLoadA: (track: Track) => void;
    onLoadB: (track: Track) => void;
    onAddToQueue: (track: Track) => void;
};

export default function TrackList({
    onLoadA,
    onLoadB,
    onAddToQueue,
}: Props) {
    const [tracks, setTracks] = useState<Track[]>([]);

    async function handleSelectFolder() {
        try {
            const folder = await open({
                directory: true,
                multiple: false,
                title: "Musikordner wählen",
            });

            if (!folder || Array.isArray(folder)) return;

            const entries = await readDir(folder);
            console.log("Alle Dateien im Ordner:", entries);

            const mp3Files: Track[] = entries
                .filter((entry) => {
                    const name = entry.name || "";
                    return name.toLowerCase().includes(".mp3");
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
                    };
                });

            console.log("MP3s geladen:", mp3Files.length, mp3Files);
            setTracks(mp3Files);

            if (mp3Files.length === 0) {
                alert("Keine MP3-Dateien in diesem Ordner gefunden.");
            }
        } catch (err) {
            console.error("Fehler beim Lesen:", err);
            alert("Fehler beim Lesen: " + String(err));
        }
    }

    const list = tracks.length > 0 ? tracks : demoTracks;

    return (
        <div className="track-list">
            <div className="track-list-title-row">
                <h2>Songliste</h2>

                <button type="button" onClick={handleSelectFolder}>
                    Musikordner wählen
                </button>
            </div>

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
                    </div>

                    <span>{track.bpm}</span>
                    <span>{track.key}</span>
                    <span>{track.energy}</span>
                    <span>{track.duration}</span>

                    <div className="load-buttons">
                        <button type="button" onClick={() => onLoadA(track)}>A</button>
                        <button type="button" onClick={() => onLoadB(track)}>B</button>
                        <button type="button" onClick={() => onAddToQueue(track)}>+</button>
                    </div>
                </div>
            ))}
        </div>
    );
}