export type BasicAudioInfo = {
    durationSeconds: number;
    sampleRate: number;
    numberOfChannels: number;
};

export async function analyzeAudioFile(file: File): Promise<BasicAudioInfo> {
    const arrayBuffer = await file.arrayBuffer();

    const audioContext = new AudioContext();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const result: BasicAudioInfo = {
        durationSeconds: audioBuffer.duration,
        sampleRate: audioBuffer.sampleRate,
        numberOfChannels: audioBuffer.numberOfChannels,
    };

    await audioContext.close();

    return result;
}