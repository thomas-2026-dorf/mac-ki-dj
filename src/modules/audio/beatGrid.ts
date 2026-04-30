export function getBeatDuration(bpm: number): number {
    if (bpm <= 0) return 0;
    return 60 / bpm;
}

export function getBarDuration(bpm: number): number {
    const beat = getBeatDuration(bpm);
    return beat * 4;
}

export function getPhaseInBar(input: {
    time: number;
    gridStart: number;
    bpm: number;
}): number {
    const bar = getBarDuration(input.bpm);
    if (bar === 0) return 0;

    const relative = input.time - input.gridStart;

    return ((relative % bar) + bar) % bar;
}

export function getNextBarStart(input: {
    time: number;
    gridStart: number;
    bpm: number;
}): number {
    const bar = getBarDuration(input.bpm);
    if (bar === 0) return input.time;

    const relative = input.time - input.gridStart;
    const index = Math.ceil(relative / bar);

    return input.gridStart + index * bar;
}

export function getClosestPhaseMatch(input: {
    masterTime: number;
    masterGridStart: number;
    masterBpm: number;
    slaveTime: number;
    slaveGridStart: number;
    slaveBpm: number;
}): number {
    const masterBar = getBarDuration(input.masterBpm);
    const slaveBar = getBarDuration(input.slaveBpm);
    if (masterBar === 0 || slaveBar === 0) return input.slaveTime;

    const masterPhaseSeconds = getPhaseInBar({
        time: input.masterTime,
        gridStart: input.masterGridStart,
        bpm: input.masterBpm,
    });

    // Anteil [0,1) im Master-Bar → gleicher Anteil im Slave-Bar
    const masterFraction = masterPhaseSeconds / masterBar;
    const slavePhaseTarget = masterFraction * slaveBar;

    const slaveBarIndex = Math.round(
        (input.slaveTime - input.slaveGridStart) / slaveBar
    );

    const candidates = [
        input.slaveGridStart + (slaveBarIndex - 1) * slaveBar + slavePhaseTarget,
        input.slaveGridStart + slaveBarIndex * slaveBar + slavePhaseTarget,
        input.slaveGridStart + (slaveBarIndex + 1) * slaveBar + slavePhaseTarget,
    ];

    let best = candidates[0];
    for (const c of candidates) {
        if (Math.abs(c - input.slaveTime) < Math.abs(best - input.slaveTime)) {
            best = c;
        }
    }

    return best;
}

export interface GridOffsetResult {
    offsetMs: number;
    matchCount: number;
}

export function calculateGridOffsetForWindow(input: {
    beats: number[];       // Aubio-Rohbeats in Sekunden
    bpm: number;
    gridStart: number;     // beatGridStartSeconds
    fromSec: number;
    toSec: number;
    maxOffsetMs?: number;  // Default: 120 ms
}): GridOffsetResult {
    const { beats, bpm, gridStart, fromSec, toSec } = input;
    const maxOffsetMs = input.maxOffsetMs ?? 120;
    const maxOffsetSec = maxOffsetMs / 1000;

    if (bpm <= 0 || beats.length === 0) return { offsetMs: 0, matchCount: 0 };

    const beatDuration = 60 / bpm;

    // Ersten Grid-Beat-Index im Fenster bestimmen
    const firstIndex = Math.ceil((fromSec - gridStart) / beatDuration);
    const lastIndex = Math.floor((toSec - gridStart) / beatDuration);

    let totalOffsetSec = 0;
    let matchCount = 0;

    for (let i = firstIndex; i <= lastIndex; i++) {
        const gridBeat = gridStart + i * beatDuration;

        // Nächstgelegenen Aubio-Beat finden
        let nearestDist = Infinity;
        let nearestBeat = 0;
        for (const b of beats) {
            const dist = Math.abs(b - gridBeat);
            if (dist < nearestDist) {
                nearestDist = dist;
                nearestBeat = b;
            }
        }

        if (nearestDist <= maxOffsetSec) {
            // Offset: positiv = Aubio-Beat kommt nach Grid-Beat
            totalOffsetSec += nearestBeat - gridBeat;
            matchCount++;
        }
    }

    if (matchCount === 0) return { offsetMs: 0, matchCount: 0 };

    const offsetMs = (totalOffsetSec / matchCount) * 1000;
    return { offsetMs, matchCount };
}
