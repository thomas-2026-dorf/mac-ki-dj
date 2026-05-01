/**
 * downbeatDetector.ts
 *
 * Schätzt automatisch, welcher Beat im 1-2-3-4 Raster die "1" (Downbeat) ist.
 *
 * Eingabe:  beats[] (Zeitstempel), bpm, durationSeconds
 * Ausgabe:  downbeatPhase 0..3, confidence 0..1, Debug-Info
 *
 * Heuristik:
 *   A) Abweichungs-Metrik:  Der echte Beat-1 wird vom Onset-Detector präziser
 *      getroffen (starke Kick-Onset → kleinere Grid-Abweichung). Pro Phase:
 *      score = mean|dev| off-beats  −  mean|dev| downbeats
 *
 *   B) IBI-Kompressions-Metrik:  Viele Tracks zeigen ein leichtes "Andrücken"
 *      vor dem Downbeat (IBI barPos 3→0 leicht kürzer als Durchschnitt).
 *      score = mean IBI others  −  mean IBI bar-boundary
 *
 *   Beide Metriken werden pro 32-Beat-Fenster ausgewertet und dann abgestimmt.
 *   Confidence = Anteil der Fenster, die mit dem Gewinner übereinstimmen.
 *
 * Grenzen:
 *   - Nur auf Beat-Zeitstempel basierend (keine Amplitude / kein Spektrum)
 *   - Signal ist schwach, besonders bei Kick auf 1 UND 3 → Phase 0 vs 2 bleibt oft unklar
 *   - Bei confidence < 0.45 → Ergebnis "unsicher", nicht automatisch anwenden
 */

export type DownbeatPhaseResult = {
    downbeatPhase: 0 | 1 | 2 | 3;
    confidence: number;        // 0..1
    reason: string;            // menschenlesbare Erklärung
    phaseScores: [number, number, number, number];  // normalisierte Scores pro Phase
    debugInfo: {
        coreBeats: number;
        introSkipped: number;
        outroSkipped: number;
        windows: number;
        windowVotes: number[];       // pro Fenster gewählte Phase (0-3)
        phaseTally: [number, number, number, number];  // Stimmen je Phase
        weightedVotes: [number, number, number, number];  // gewichtete Stimmen je Phase
        beatIntervalMs: number;
        metricA_scores: number[];    // Abweichungs-Metrik pro Phase
        metricB_scores: number[];    // IBI-Kompressions-Metrik pro Phase
        stableRegionUsed: boolean;
        stableRegionStartSec: number | null;
        stableRegionEndSec: number | null;
        stableRegionBeats: number;
        zoneUsed: boolean;
        zoneStartSeconds: number | null;
        zoneEndSeconds: number | null;
    };
};

export function detectDownbeatPhase({
    beats,
    bpm,
    durationSeconds,
    zoneStartSeconds,
    zoneEndSeconds,
}: {
    beats: number[];
    bpm: number;
    durationSeconds: number;
    zoneStartSeconds?: number;
    zoneEndSeconds?: number;
}): DownbeatPhaseResult | null {
    if (!beats || beats.length < 16 || bpm <= 0 || durationSeconds <= 0) return null;

    const beatInterval = 60 / bpm;
    const gridRef = beats[0];   // globaler Grid-Anker

    // Zone: entweder explizit übergeben oder Intro/Outro-15%-Fallback
    const zoneValid =
        zoneStartSeconds !== undefined &&
        zoneEndSeconds !== undefined &&
        zoneEndSeconds > zoneStartSeconds;

    const introEnd   = zoneValid ? zoneStartSeconds! : durationSeconds * 0.15;
    const outroStart = zoneValid ? zoneEndSeconds!   : durationSeconds * 0.85;
    const coreBeats  = beats.filter(t => t >= introEnd && t <= outroStart);
    const introSkipped = beats.filter(t => t < introEnd).length;
    const outroSkipped = beats.filter(t => t > outroStart).length;

    if (coreBeats.length < 16) return null;

    // Stable-Region: stabilstes 32-Beat-Fenster nutzen (niedrigste IBI-Varianz)
    const stableRegion = findStableBeatRegion(coreBeats, beatInterval);
    const analysisBeats = stableRegion ? stableRegion.beats : coreBeats;

    // Globale Metriken über analyse-Beats (Stable-Region oder kompletter Core)
    const metricA = computeMetricA(analysisBeats, gridRef, beatInterval);
    const metricB = computeMetricB(analysisBeats, gridRef, beatInterval);

    // Kombinierten Score pro Phase
    const combined = [0, 1, 2, 3].map(p => metricA[p] + 0.5 * metricB[p]);

    // Normalisieren auf [-1, +1] relativ zum Maximum
    const maxCombined = Math.max(...combined);
    const minCombined = Math.min(...combined);
    const range = maxCombined - minCombined || 1;
    const normalizedScores = combined.map(s => (s - minCombined) / range) as
        [number, number, number, number];

    // Fenster-Abstimmung: alle 32-Beat-Fenster in coreBeats, Schritt 8
    // (Voting immer über den vollen Core/Zone-Bereich, nicht nur über stableRegion)
    const windowVotes: number[] = [];
    const tally: [number, number, number, number]         = [0, 0, 0, 0];
    const weightedTally: [number, number, number, number] = [0, 0, 0, 0];

    for (let start = 0; start + 32 <= coreBeats.length; start += 8) {
        const wBeats = coreBeats.slice(start, start + 32);
        const wA = computeMetricA(wBeats, gridRef, beatInterval);
        const wB = computeMetricB(wBeats, gridRef, beatInterval);
        const wCombined = [0, 1, 2, 3].map(p => wA[p] + 0.5 * wB[p]);
        const phase = wCombined.indexOf(Math.max(...wCombined));
        windowVotes.push(phase);
        tally[phase]++;

        // IBI-Varianz als Gewicht: niedrige Varianz → hohes Gewicht
        const ibis = wBeats.slice(1).map((t, i) => t - wBeats[i]);
        const meanIbi = ibis.reduce((s, v) => s + v, 0) / ibis.length;
        const ibiVar  = ibis.reduce((s, v) => s + (v - meanIbi) ** 2, 0) / ibis.length;
        const weight  = 1 / (ibiVar + 1e-6);
        weightedTally[phase] += weight;
    }

    const windowCount   = windowVotes.length;
    const maxWeighted   = Math.max(...weightedTally);
    const totalWeighted = weightedTally.reduce((s, v) => s + v, 0);
    const weightedWinner = weightedTally.indexOf(maxWeighted) as 0 | 1 | 2 | 3;

    // ungewichteter Fallback-Gewinner (für Tally-Anzeige im Debug)
    const maxVotes = Math.max(...tally);
    const winner   = tally.indexOf(maxVotes) as 0 | 1 | 2 | 3;
    void winner; // nur für Debug-Tally behalten

    // Confidence: < 3 Fenster → hart 40% (zu wenig Datenbasis)
    let confidence: number;
    if (windowCount < 3) {
        confidence = 0.4;
    } else {
        confidence = totalWeighted > 0 ? maxWeighted / totalWeighted : 0.4;
    }

    // Finale Phase: gewichtete Fenstermehrheit (bei genug Fenstern) oder Global-Score-Gewinner
    const finalPhase = windowCount >= 3
        ? weightedWinner
        : (combined.indexOf(Math.max(...combined)) as 0 | 1 | 2 | 3);

    // Erklärungstext
    let reason: string;
    if (windowCount < 3) {
        reason = `Nur ${windowCount} Fenster → unsicher, manuell prüfen`;
    } else if (confidence >= 0.65) {
        reason = `${Math.round(confidence * 100)}% der Fenster einig → Beat ${finalPhase + 1} ist wahrscheinlich die 1`;
    } else if (confidence >= 0.45) {
        reason = `Schwaches Signal (${Math.round(confidence * 100)}%) → unsicher, manuell prüfen`;
    } else {
        reason = `Kein klares Signal (${Math.round(confidence * 100)}%) → manuell prüfen`;
    }

    return {
        downbeatPhase: finalPhase,
        confidence,
        reason,
        phaseScores: normalizedScores,
        debugInfo: {
            coreBeats: coreBeats.length,
            introSkipped,
            outroSkipped,
            windows: windowCount,
            windowVotes,
            phaseTally: tally,
            weightedVotes: weightedTally.map(w => parseFloat(w.toFixed(3))) as [number, number, number, number],
            beatIntervalMs: Math.round(beatInterval * 1000),
            metricA_scores: metricA.map(s => parseFloat(s.toFixed(5))),
            metricB_scores: metricB.map(s => parseFloat(s.toFixed(5))),
            stableRegionUsed: stableRegion !== null,
            stableRegionStartSec: stableRegion ? stableRegion.startSec : null,
            stableRegionEndSec: stableRegion ? stableRegion.endSec : null,
            stableRegionBeats: stableRegion ? stableRegion.beats.length : 0,
            zoneUsed: zoneValid,
            zoneStartSeconds: zoneValid ? zoneStartSeconds! : null,
            zoneEndSeconds: zoneValid ? zoneEndSeconds! : null,
        },
    };
}

/**
 * Metrik A: Abweichungs-Metrik
 * Für jeden Beat: Abstand vom Ideal-Grid (globales gridRef + n * beatInterval).
 * Score[p] = mean|dev| aller Off-Beats  −  mean|dev| der Downbeat-Positionen
 * Höherer Score: diese Phase hat präzisere Downbeat-Erkennung.
 */
function computeMetricA(beats: number[], gridRef: number, beatInterval: number): number[] {
    return [0, 1, 2, 3].map(p => {
        const downDev: number[] = [];
        const offDev:  number[] = [];

        for (const t of beats) {
            const n   = Math.round((t - gridRef) / beatInterval);
            const dev = Math.abs(t - (gridRef + n * beatInterval));
            const barPos = ((n + p) % 4 + 4) % 4;
            (barPos === 0 ? downDev : offDev).push(dev);
        }

        if (downDev.length < 2 || offDev.length < 4) return 0;
        const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
        return (mean(offDev) - mean(downDev)) / beatInterval;
    });
}

/**
 * Metrik B: IBI-Kompressions-Metrik
 * IBI vom Beat auf barPos=3 zum nächsten (Taktwechsel-IBI, barPos 3→0).
 * Score[p] = mean IBI (andere) − mean IBI (Taktwechsel)
 * Höherer Score: IBI vor dem Downbeat ist kürzer → micro-rush → wahrscheinlicher Downbeat.
 */
function computeMetricB(beats: number[], gridRef: number, beatInterval: number): number[] {
    return [0, 1, 2, 3].map(p => {
        const bbIbi:    number[] = [];   // bar-boundary IBIs (barPos 3 → 0)
        const otherIbi: number[] = [];

        for (let i = 0; i < beats.length - 1; i++) {
            const ibi  = beats[i + 1] - beats[i];
            const n    = Math.round((beats[i] - gridRef) / beatInterval);
            const barPos = ((n + p) % 4 + 4) % 4;
            (barPos === 3 ? bbIbi : otherIbi).push(ibi);
        }

        if (bbIbi.length < 2 || otherIbi.length < 4) return 0;
        const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
        return (mean(otherIbi) - mean(bbIbi)) / beatInterval;
    });
}

/**
 * findStableBeatRegion
 * Sucht das 32-Beat-Fenster mit der niedrigsten IBI-Varianz im übergebenen Beats-Array.
 * Stabiles Fenster = gleichmäßigstes Tempo → zuverlässigere Downbeat-Erkennung.
 * Gibt null zurück wenn weniger als 2 auswertbare Fenster vorhanden sind.
 */
export function findStableBeatRegion(
    beats: number[],
    beatInterval: number,
): { beats: number[]; startSec: number; endSec: number } | null {
    const WINDOW = 32;
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    const variance = (a: number[]) => {
        const m = mean(a);
        return a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length;
    };

    let bestVar = Infinity;
    let bestWindow: number[] | null = null;

    let validWindows = 0;
    for (let start = 0; start + WINDOW <= beats.length; start += 8) {
        const w = beats.slice(start, start + WINDOW);
        const ibis = w.slice(1).map((t, i) => t - w[i]);
        if (ibis.length < 8) continue;
        // Outlier-Filter: IBIs die mehr als 2× das Nominal-Interval abweichen ignorieren
        const filtered = ibis.filter(ibi => Math.abs(ibi - beatInterval) < beatInterval * 0.5);
        if (filtered.length < 8) continue;
        validWindows++;
        const v = variance(filtered);
        if (v < bestVar) {
            bestVar = v;
            bestWindow = w;
        }
    }

    if (validWindows < 2 || !bestWindow) return null;
    return {
        beats: bestWindow,
        startSec: bestWindow[0],
        endSec: bestWindow[bestWindow.length - 1],
    };
}
