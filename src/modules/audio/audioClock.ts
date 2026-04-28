export type AudioClockSnapshot = {
    audioTime: number;
    trackTime: number;
    playbackRate: number;
};

export function createAudioClockSnapshot(input: {
    audioTime: number;
    trackTime: number;
    playbackRate: number;
}): AudioClockSnapshot {
    return {
        audioTime: input.audioTime,
        trackTime: input.trackTime,
        playbackRate: input.playbackRate,
    };
}

export function getTrackTimeFromClock(input: {
    snapshot: AudioClockSnapshot;
    nowAudioTime: number;
}): number {
    const elapsed = input.nowAudioTime - input.snapshot.audioTime;

    return Math.max(
        0,
        input.snapshot.trackTime + elapsed * input.snapshot.playbackRate,
    );
}
