export type Track = {
    id: string;
    title: string;
    artist: string;
    bpm: number;
    key: string;
    energy: number;
    duration: string;
    genre: string;
    url?: string; // 🔥 Audio-Datei
};