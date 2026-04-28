import { invoke } from "@tauri-apps/api/core";

export async function convertToWav(inputPath: string, outputPath: string) {
    return await invoke<string>("convert_audio_to_wav", {
        inputPath,
        outputPath,
    });
}

export async function stretchAudioFile(options: {
    inputPath: string;
    outputPath: string;
    tempo: number;
}) {
    return await invoke<string>("test_rubberband_stretch", {
        inputPath: options.inputPath,
        outputPath: options.outputPath,
        tempo: options.tempo,
    });
}

// 🔥 Komplett-Test: MP3 → WAV → Stretch
export async function convertAndStretch(options: {
    inputMp3: string;
    wavPath: string;
    stretchedPath: string;
    tempo: number;
}) {
    try {
        console.log("Step 1: MP3 → WAV");
        await convertToWav(options.inputMp3, options.wavPath);

        console.log("Step 2: Stretch");
        await stretchAudioFile({
            inputPath: options.wavPath,
            outputPath: options.stretchedPath,
            tempo: options.tempo,
        });

        return { success: true };
    } catch (e) {
        console.error(e);
        return { success: false, error: String(e) };
    }
}
