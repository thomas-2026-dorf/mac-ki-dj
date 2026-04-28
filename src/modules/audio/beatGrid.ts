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
