import { invoke } from "@tauri-apps/api/core";

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

async function fileExists(path: string) {
    return await invoke<boolean>("tkdj_file_exists", { path });
}

export async function convertToWav(inputPath: string, outputPath: string) {
    return await invoke<string>("convert_audio_to_wav", {
        inputPath,
        outputPath,
    });
}

export async function ensureWavCache(inputPath: string) {
    const paths = getTkdjCachePaths(inputPath);

    if (!(await fileExists(paths.wavPath))) {
        console.log("WAV Cache fehlt, erstelle:", paths.wavPath);
        await convertToWav(inputPath, paths.wavPath);
    } else {
        console.log("WAV Cache vorhanden:", paths.wavPath);
    }

    return paths.wavPath;
}

export async function stretchAudioFile(_options: {
    inputPath: string;
    outputPath: string;
    tempo: number;
}) {
    console.log("External analysis/stretch engine disabled (Superpowered migration)");
    return "disabled";
}

export async function convertAndStretch(options: {
    inputMp3: string;
    tempo: number;
}) {
    try {
        const paths = getTkdjCachePaths(options.inputMp3);

        const wavPath = await ensureWavCache(options.inputMp3);
        const stretchExists = await fileExists(paths.stretchedPath);

        if (!stretchExists) {
            console.log("Step 2: Stretch");
            await stretchAudioFile({
                inputPath: wavPath,
                outputPath: paths.stretchedPath,
                tempo: options.tempo,
            });
        } else {
            console.log("Stretch Cache vorhanden:", paths.stretchedPath);
        }

        return {
            success: true,
            wavPath,
            stretchedPath: paths.stretchedPath,
        };
    } catch (e) {
        console.error(e);
        return { success: false, error: String(e) };
    }
}
