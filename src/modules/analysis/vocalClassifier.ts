import * as tf from "@tensorflow/tfjs";

// Result of a vocal/instrumental classification for one audio segment
export type VocalClassifierResult = {
    label: "vocal" | "instrumental" | "unknown";
    confidence: number;
    startSeconds: number;
    endSeconds: number;
};

// Input: a mono PCM segment at the model's expected sample rate
export type VocalClassifierInput = {
    samples: Float32Array;
    sampleRate: number;
    startSeconds: number;
    endSeconds: number;
};

// Placeholder — no model is loaded yet.
// Returns "unknown" for every segment until a real model is wired in.
export async function classifyVocalInstrumental(
    _input: VocalClassifierInput
): Promise<VocalClassifierResult> {
    // tf is imported so the dependency is resolved at build time; not called yet.
    void tf.version;

    return {
        label: "unknown",
        confidence: 0,
        startSeconds: _input.startSeconds,
        endSeconds: _input.endSeconds,
    };
}
