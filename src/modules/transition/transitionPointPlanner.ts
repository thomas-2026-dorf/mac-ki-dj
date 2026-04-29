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
    "loop-out": { bg: "rgba(249,115,22,0.15)", border: "rgba(249,115,22,0.5)", text: "#fb923c" },
    "loop-in":  { bg: "rgba(34,197,94,0.15)",  border: "rgba(34,197,94,0.5)",  text: "#4ade80" },
    "cut-out":  { bg: "rgba(239,68,68,0.15)",   border: "rgba(239,68,68,0.5)",  text: "#f87171" },
    "cut-in":   { bg: "rgba(56,189,248,0.15)",  border: "rgba(56,189,248,0.5)", text: "#38bdf8" },
    "passage":  { bg: "rgba(148,163,184,0.15)", border: "rgba(148,163,184,0.4)", text: "#94a3b8" },
};

// Berechnet automatische Übergangspunkte nach DJ-Regeln: 8/16/32-Bar Loops, Cut-Out
export function suggestTransitionPoints(track: Track): TransitionPoint[] {
    const bpm = track.bpm || 0;
    if (bpm <= 0) return [];

    const barDur = (4 * 60) / bpm; // Sekunden pro 4/4-Takt
    const duration = parseDuration(track.duration);
    const points: TransitionPoint[] = [];

    const outroStart = track.outroStartSeconds ?? track.analysis?.outroStartSeconds;
    const introEnd = track.introEndSeconds ?? track.analysis?.introEndSeconds ?? 0;

    // Outro-Referenzpunkt: bekannt oder geschätzt (70% oder 64 Bars vor Ende)
    const outroRef = outroStart ?? Math.max(duration * 0.7, duration - 64 * barDur);

    // Loop-Out Punkte: 32/16/8 Bars vor dem Outro-Referenz
    // DJ aktiviert Loop hier um das Misch-Fenster zu verlängern
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

    // Cut-Out: direkt am Outro-Start (harter Schnitt möglich)
    if (outroStart && outroStart < duration - 8) {
        points.push({
            id: "auto-cut-out",
            role: "cut-out",
            bars: null,
            timeSeconds: outroStart,
            source: "auto",
            label: "Cut-Out",
        });
    }

    // Loop-In Punkte: 8/16 Bars nach dem Intro-Ende (Einstiegspunkt neuer Track)
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

    return points;
}
