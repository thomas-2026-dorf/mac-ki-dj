export type BasicAudioInfo = {
    durationSeconds: number;
    sampleRate: number;
    numberOfChannels: number;
    estimatedBpm: number | null;
};

function normalizeBpm(bpm: number): number {
    let normalized = bpm;

    while (normalized < 90) normalized *= 2;
    while (normalized > 180) normalized /= 2;

    return Math.round(normalized);
}

function estimateSimpleBpm(audioBuffer: AudioBuffer): number | null {
    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;

    const windowSize = Math.floor(sampleRate * 0.04);
    const energies: number[] = [];

    for (let i = 0; i < channelData.length; i += windowSize) {
        let sum = 0;

        for (let j = i; j < i + windowSize && j < channelData.length; j++) {
            sum += Math.abs(channelData[j]);
        }

        energies.push(sum / windowSize);
    }

    if (energies.length < 10) return null;

    const averageEnergy =
        energies.reduce((sum, value) => sum + value, 0) / energies.length;

    const peaks: number[] = [];

    for (let i = 1; i < energies.length - 1; i++) {
        const isLocalPeak =
            energies[i] > energies[i - 1] &&
            energies[i] > energies[i + 1] &&
            energies[i] > averageEnergy * 1.35;

        if (isLocalPeak) {
            peaks.push(i * 0.04);
        }
    }

    if (peaks.length < 6) return null;

    const bpmScores = new Map<number, number>();

    for (let i = 0; i < peaks.length; i++) {
        for (let j = i + 1; j < Math.min(i + 8, peaks.length); j++) {
            const diff = peaks[j] - peaks[i];

            if (diff < 0.25 || diff > 2.0) continue;

            const rawBpm = 60 / diff;
            const bpm = normalizeBpm(rawBpm);

            if (bpm < 80 || bpm > 180) continue;

            bpmScores.set(bpm, (bpmScores.get(bpm) || 0) + 1);
        }
    }

    if (bpmScores.size === 0) return null;

    const best = [...bpmScores.entries()].sort((a, b) => b[1] - a[1])[0];

    return best[0];
}

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
            estimatedBpm: estimateSimpleBpm(audioBuffer),
        };
    } finally {
        await audioContext.close();
    }
}

export async function analyzeAudioFile(file: File): Promise<BasicAudioInfo> {
    const arrayBuffer = await file.arrayBuffer();
    return analyzeAudioBuffer(arrayBuffer);
}