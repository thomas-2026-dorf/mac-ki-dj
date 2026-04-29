import type { Track, TransitionPoint, TransitionPointRole } from "../../types/track";

function parseDuration(duration: string): number {
    const parts = duration.split(":").map(Number);
    if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
    if (parts.length === 3) return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
    return 240;
}

export function formatTransitionTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
}

export const ROLE_COLORS: Record<TransitionPointRole, { bg: string; border: string; text: string }> = {
    "loop-out":    { bg: "rgba(249,115,22,0.15)",  border: "rgba(249,115,22,0.5)",  text: "#fb923c" }, // orange
    "loop-in":     { bg: "rgba(34,197,94,0.15)",   border: "rgba(34,197,94,0.5)",   text: "#4ade80" }, // grün
    "cut-out":     { bg: "rgba(239,68,68,0.15)",   border: "rgba(239,68,68,0.5)",   text: "#f87171" }, // rot
    "cut-in":      { bg: "rgba(239,68,68,0.15)",   border: "rgba(239,68,68,0.5)",   text: "#f87171" }, // rot
    "passage-out": { bg: "rgba(96,165,250,0.15)",  border: "rgba(96,165,250,0.5)",  text: "#60a5fa" }, // blau
    "passage-in":  { bg: "rgba(96,165,250,0.15)",  border: "rgba(96,165,250,0.5)",  text: "#60a5fa" }, // blau
};

export function suggestTransitionPoints(track: Track): TransitionPoint[] {
    const bpm = track.bpm || 0;
    if (bpm <= 0) return [];

    const barDur = (4 * 60) / bpm;
    const duration = parseDuration(track.duration);
    const points: TransitionPoint[] = [];

    const outroStart = track.outroStartSeconds ?? track.analysis?.outroStartSeconds;
    const introEnd = track.introEndSeconds ?? track.analysis?.introEndSeconds ?? 0;

    const outroRef = outroStart ?? Math.max(duration * 0.7, duration - 64 * barDur);

    // --- OUT-Punkte ---

    // Loop-Out: 8/16/32 Bars vor Outro-Referenz
    for (const bars of [32, 16, 8] as const) {
        const time = outroRef - bars * barDur;
        if (time > introEnd + barDur && time < outroRef - barDur) {
            points.push({
                id: `auto-loop-out-${bars}`,
                role: "loop-out",
                bars,
                timeSeconds: Math.round(time * 10) / 10,
                source: "auto",
                label: `Loop-Out ${bars}b`,
            });
        }
    }

    // Cut-Out: am Outro-Start wenn bekannt, sonst 8 Bars vor Ende
    const cutOutTime = outroStart ?? (duration - 8 * barDur);
    if (cutOutTime > introEnd + barDur && cutOutTime < duration - 2) {
        points.push({
            id: "auto-cut-out",
            role: "cut-out",
            bars: null,
            timeSeconds: Math.round(cutOutTime * 10) / 10,
            source: "auto",
            label: "Cut-Out",
        });
    }

    // Passage-Out: 24 Bars vor Outro-Referenz (sanfter Blend-Start)
    const passageOutTime = outroRef - 24 * barDur;
    if (passageOutTime > introEnd + barDur && passageOutTime < outroRef - barDur) {
        points.push({
            id: "auto-passage-out",
            role: "passage-out",
            bars: null,
            timeSeconds: Math.round(passageOutTime * 10) / 10,
            source: "auto",
            label: "Passage-Out",
        });
    }

    // --- IN-Punkte ---

    // Loop-In: 8/16 Bars nach Intro-Ende
    for (const bars of [8, 16] as const) {
        const time = introEnd + bars * barDur;
        if (time < duration * 0.45) {
            points.push({
                id: `auto-loop-in-${bars}`,
                role: "loop-in",
                bars,
                timeSeconds: Math.round(time * 10) / 10,
                source: "auto",
                label: `Loop-In ${bars}b`,
            });
        }
    }

    // Cut-In: direkt am Intro-Ende (Einstieg in Hauptteil)
    const cutInTime = introEnd > 0 ? introEnd : 4 * barDur;
    if (cutInTime < duration * 0.4) {
        points.push({
            id: "auto-cut-in",
            role: "cut-in",
            bars: null,
            timeSeconds: Math.round(cutInTime * 10) / 10,
            source: "auto",
            label: "Cut-In",
        });
    }

    // --- PASSAGE-Punkte ---

    // Passage-In: 32 Bars nach Intro (etablierter Abschnitt für sanften Einstieg)
    const passageInTime = introEnd + 32 * barDur;
    if (passageInTime < duration * 0.6) {
        points.push({
            id: "auto-passage-in",
            role: "passage-in",
            bars: null,
            timeSeconds: Math.round(passageInTime * 10) / 10,
            source: "auto",
            label: "Passage-In",
        });
    }

    return points;
}
