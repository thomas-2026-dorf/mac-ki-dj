export type BasicAudioInfo = {
    durationSeconds: number;
    sampleRate: number;
    numberOfChannels: number;
};

export async function analyzeAudioBuffer(
    audioData: ArrayBuffer | Uint8Array,
): Promise<BasicAudioInfo> {
    const arrayBuffer =
        audioData instanceof Uint8Array
            ? audioData.buffer.slice(
                audioData.byteOffset,
                audioData.byteOffset + audioData.byteLength,
            )
            : audioData;

    const audioContext = new AudioContext();

    try {
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        return {
            durationSeconds: audioBuffer.duration,
            sampleRate: audioBuffer.sampleRate,
            numberOfChannels: audioBuffer.numberOfChannels,
        };
    } finally {
        await audioContext.close();
    }
}

export async function analyzeAudioFile(file: File): Promise<BasicAudioInfo> {
    const arrayBuffer = await file.arrayBuffer();
    return analyzeAudioBuffer(arrayBuffer);
}