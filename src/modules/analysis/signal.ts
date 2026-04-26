import type { PreparedSignal } from "./types";

export function prepareSignal(audioBuffer: AudioBuffer): PreparedSignal {
    const { numberOfChannels, sampleRate, duration } = audioBuffer;
    const length = audioBuffer.length;
    const mono = new Float32Array(length);

    for (let ch = 0; ch < numberOfChannels; ch++) {
        const channelData = audioBuffer.getChannelData(ch);
        for (let i = 0; i < length; i++) {
            mono[i] += channelData[i] / numberOfChannels;
        }
    }

    let max = 0;
    for (let i = 0; i < mono.length; i++) {
        max = Math.max(max, Math.abs(mono[i]));
    }

    if (max > 0) {
        for (let i = 0; i < mono.length; i++) {
            mono[i] /= max;
        }
    }

    return { samples: mono, sampleRate, durationSeconds: duration };
}
