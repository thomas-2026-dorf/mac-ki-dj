export type WaveformPeaks = {
    min: number[];
    max: number[];
    rms: number[];
    maxRms: number;
    length: number;
};

export function buildWaveformPeaks(
    audioBuffer: AudioBuffer,
    samplesPerPixel = 512
): WaveformPeaks {
    const data = audioBuffer.getChannelData(0);
    const numSegments = Math.ceil(data.length / samplesPerPixel);
    const min: number[] = new Array(numSegments);
    const max: number[] = new Array(numSegments);
    const rms: number[] = new Array(numSegments);

    for (let i = 0; i < numSegments; i++) {
        const start = i * samplesPerPixel;
        const end = Math.min(start + samplesPerPixel, data.length);
        let segMin = Infinity, segMax = -Infinity, sumSq = 0;
        for (let j = start; j < end; j++) {
            const s = data[j];
            if (s < segMin) segMin = s;
            if (s > segMax) segMax = s;
            sumSq += s * s;
        }
        min[i] = segMin;
        max[i] = segMax;
        rms[i] = Math.sqrt(sumSq / (end - start));
    }

    let maxRms = 0;
    for (let i = 0; i < numSegments; i++) {
        if (rms[i] > maxRms) maxRms = rms[i];
    }

    return { min, max, rms, maxRms: maxRms || 1, length: numSegments };
}
