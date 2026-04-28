import { invoke } from "@tauri-apps/api/core";
import { exists } from "@tauri-apps/plugin-fs";

function getFolderPath(filePath: string) {
    return filePath.split("/").slice(0, -1).join("/");
}

function getFileNameWithoutExtension(filePath: string) {
    const fileName = filePath.split("/").pop() || "track";
    return fileName.replace(/\.[^/.]+$/, "");
}

export function getTkdjCachePaths(inputPath: string) {
    const folder = getFolderPath(inputPath);
    const baseName = getFileNameWithoutExtension(inputPath);
    const cacheFolder = `${folder}/.tkdj`;

    return {
        cacheFolder,
        wavPath: `${cacheFolder}/${baseName}.wav`,
        stretchedPath: `${cacheFolder}/${baseName}_stretch.wav`,
    };
}

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

export async function convertAndStretch(options: {
    inputMp3: string;
    tempo: number;
}) {
    try {
        const paths = getTkdjCachePaths(options.inputMp3);

        const wavExists = await exists(paths.wavPath);
        const stretchExists = await exists(paths.stretchedPath);

        if (!wavExists) {
            console.log("Step 1: MP3 → WAV");
            await convertToWav(options.inputMp3, paths.wavPath);
        } else {
            console.log("WAV Cache vorhanden:", paths.wavPath);
        }

        if (!stretchExists) {
            console.log("Step 2: Stretch");
            await stretchAudioFile({
                inputPath: paths.wavPath,
                outputPath: paths.stretchedPath,
                tempo: options.tempo,
            });
        } else {
            console.log("Stretch Cache vorhanden:", paths.stretchedPath);
        }

        return {
            success: true,
            wavPath: paths.wavPath,
            stretchedPath: paths.stretchedPath,
        };
    } catch (e) {
        console.error(e);
        return { success: false, error: String(e) };
    }
}
