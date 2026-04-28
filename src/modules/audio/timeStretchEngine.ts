import { invoke } from "@tauri-apps/api/core";

export async function stretchAudioFile(options: {
    inputPath: string;
    outputPath: string;
    tempo: number;
}) {
    try {
        const result = await invoke<string>("test_rubberband_stretch", {
            inputPath: options.inputPath,
            outputPath: options.outputPath,
            tempo: options.tempo,
        });

        console.log("Stretch Ergebnis:", result);

        return {
            success: true,
            message: result,
        };
    } catch (error) {
        console.error("Stretch Fehler:", error);

        return {
            success: false,
            error: String(error),
        };
    }
}
