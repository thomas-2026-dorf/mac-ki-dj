import * as tf from "@tensorflow/tfjs";

export type VocalClassifierResult = {
    label: "vocal" | "instrumental" | "unknown";
    confidence: number;
    startSeconds: number;
    endSeconds: number;
};

export type VocalClassifierInput = {
    samples: Float32Array;
    sampleRate: number;
    startSeconds: number;
    endSeconds: number;
};

// YAMNet erwartet 16 kHz Mono, mindestens ~0.975 s (= 15 600 Samples)
const YAMNET_URL       = "https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1";
const CLASS_MAP_URL    = "/models/yamnet/yamnet_class_map.csv";
const YAMNET_SAMPLE_RATE = 16000;
const YAMNET_MIN_SAMPLES = 15600;

// ── Modell-Cache ──────────────────────────────────────────────────────────────
let modelCache: tf.GraphModel | null = null;

async function loadYAMNet(): Promise<tf.GraphModel> {
    if (modelCache) return modelCache;
    console.log("[VocalClassifier] Lade YAMNet von TF Hub...");
    modelCache = await tf.loadGraphModel(YAMNET_URL, { fromTFHub: true });
    console.log("[VocalClassifier] YAMNet geladen.");
    return modelCache;
}

// ── Klassen-Labels-Cache ──────────────────────────────────────────────────────
let classNamesCache: string[] | null = null;

async function loadClassNames(): Promise<string[]> {
    if (classNamesCache) return classNamesCache;
    try {
        const resp = await fetch(CLASS_MAP_URL);
        const text = await resp.text();
        // CSV-Format: index,mid,display_name  (display_name kann gequotet sein)
        const lines = text.trim().split("\n").slice(1);
        classNamesCache = lines.map(line => {
            const firstComma  = line.indexOf(",");
            const secondComma = line.indexOf(",", firstComma + 1);
            let name = line.slice(secondComma + 1).trim();
            if (name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1);
            return name;
        });
        console.log("[VocalClassifier] Klassen geladen:", classNamesCache.length);
    } catch (err) {
        console.warn("[VocalClassifier] Klassen-CSV nicht geladen:", err);
        classNamesCache = [];
    }
    return classNamesCache;
}

// ── Resample ──────────────────────────────────────────────────────────────────
function resampleTo16k(samples: Float32Array, sourceSampleRate: number): Float32Array {
    if (sourceSampleRate === YAMNET_SAMPLE_RATE) return samples;
    const ratio  = sourceSampleRate / YAMNET_SAMPLE_RATE;
    const outLen = Math.floor(samples.length / ratio);
    const out    = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) out[i] = samples[Math.floor(i * ratio)];
    return out;
}

// ── Inferenz ──────────────────────────────────────────────────────────────────
export async function classifyVocalInstrumental(
    input: VocalClassifierInput
): Promise<VocalClassifierResult> {
    const base: VocalClassifierResult = {
        label: "unknown",
        confidence: 0,
        startSeconds: input.startSeconds,
        endSeconds:   input.endSeconds,
    };

    try {
        const [model, classNames] = await Promise.all([loadYAMNet(), loadClassNames()]);
        const audio16k = resampleTo16k(input.samples, input.sampleRate);

        if (audio16k.length < YAMNET_MIN_SAMPLES) {
            console.warn("[VocalClassifier] Audio zu kurz:", audio16k.length, "Samples");
            return base;
        }

        const inputTensor = tf.tensor1d(audio16k);
        const rawOutput   = model.execute(inputTensor);
        const tensors     = (Array.isArray(rawOutput) ? rawOutput : [rawOutput]) as tf.Tensor[];

        // tensors[0] = scores [num_frames, 521]
        const scores     = tensors[0];
        const flat       = scores.dataSync() as Float32Array;
        const numFrames  = scores.shape.length >= 2 ? (scores.shape[0] ?? 1) : 1;
        const numClasses = scores.shape[scores.shape.length - 1] ?? 521;

        console.log("[VocalClassifierTest] Shapes:",
            tensors.map(t => JSON.stringify(t.shape)).join(" | "),
            `  Frames: ${numFrames}`);

        // Scores über alle Frames mitteln
        const meanScores = new Float32Array(numClasses);
        for (let c = 0; c < numClasses; c++) {
            let sum = 0;
            for (let f = 0; f < numFrames; f++) sum += flat[f * numClasses + c];
            meanScores[c] = sum / numFrames;
        }

        // Top 10
        const sorted = Array.from(meanScores)
            .map((score, i) => ({ i, score }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 10);

        const top10 = sorted.map(({ i, score }, rank) => ({
            rank:  rank + 1,
            class: classNames[i] ?? `class_${i}`,
            index: i,
            score: score.toFixed(4),
        }));

        const top10Labels = top10.map(e => `#${e.rank} ${e.score}  ${e.class}`);
        console.log("[YAMNetTopClasses]\n" + top10Labels.join("\n"));

        inputTensor.dispose();
        for (const t of tensors) t.dispose();

    } catch (err) {
        console.error("[VocalClassifier] Fehler:", err);
    }

    return base;
}
