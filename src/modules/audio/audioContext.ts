let sharedAudioContext: AudioContext | null = null;

export function getSharedAudioContext(): AudioContext {
    if (sharedAudioContext) {
        return sharedAudioContext;
    }

    sharedAudioContext = new AudioContext();

    return sharedAudioContext;
}

export async function resumeSharedAudioContext(): Promise<AudioContext> {
    const context = getSharedAudioContext();

    if (context.state === "suspended") {
        await context.resume();
    }

    return context;
}

export function getAudioTime(): number {
    return getSharedAudioContext().currentTime;
}
