import { invoke } from "@tauri-apps/api/core";
import { getSharedAudioContext } from "./audioContext";

export type DeckAudio = {
    load(wavPath: string): Promise<void>;
    play(): void;
    pause(): void;
    seek(time: number): void;
    setRate(rate: number): void;
    setGain(value: number): void;
    setBassGain(gainDb: number): void;
    getTime(): number;
    getDuration(): number;
    isPlaying(): boolean;
    onEnded(cb: () => void): void;
    destroy(): void;
};

export function createDeckAudio(): DeckAudio {
    const ctx = getSharedAudioContext();

    let buffer: AudioBuffer | null = null;
    let source: AudioBufferSourceNode | null = null;
    let endedCallback: (() => void) | null = null;

    // Audio-Graph: source → bassFilter → gainNode → destination
    const gainNode = ctx.createGain();
    const bassFilter = ctx.createBiquadFilter();
    bassFilter.type = "lowshelf";
    bassFilter.frequency.value = 250;
    bassFilter.gain.value = 0;
    bassFilter.connect(gainNode);
    gainNode.connect(ctx.destination);

    // Clock: wie viel Track-Zeit ist bei welchem AudioContext-Zeitpunkt
    let clockBase = 0;
    let offsetBase = 0;
    let currentRate = 1.0;
    let playing = false;
    let stopGen = 0;

    function getTime(): number {
        if (!playing) return offsetBase;
        const elapsed = (ctx.currentTime - clockBase) * currentRate;
        const dur = buffer?.duration ?? 0;
        return dur > 0 ? Math.min(offsetBase + elapsed, dur) : offsetBase + elapsed;
    }

    function stopSource(): void {
        stopGen++;
        source?.stop();
        source = null;
    }

    function startSource(offset: number): void {
        if (!buffer) return;
        stopSource();

        const myGen = stopGen;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.playbackRate.value = currentRate;
        src.connect(bassFilter);
        src.onended = () => {
            if (playing && stopGen === myGen) {
                playing = false;
                endedCallback?.();
            }
        };

        clockBase = ctx.currentTime;
        offsetBase = Math.max(0, Math.min(offset, buffer.duration));
        src.start(0, offsetBase);
        source = src;
        playing = true;
    }

    return {
        async load(wavPath: string): Promise<void> {
            const bytes: number[] = await invoke("tkdj_read_binary_file", { path: wavPath });
            const arrayBuffer = new Uint8Array(bytes).buffer;
            buffer = await ctx.decodeAudioData(arrayBuffer);
            offsetBase = 0;
            playing = false;
        },

        play(): void {
            if (!buffer || playing) return;
            if (ctx.state === "suspended") {
                ctx.resume().then(() => startSource(offsetBase));
            } else {
                startSource(offsetBase);
            }
        },

        pause(): void {
            if (!playing) return;
            offsetBase = getTime();
            playing = false;
            stopSource();
        },

        seek(time: number): void {
            const wasPlaying = playing;
            if (playing) {
                playing = false;
                stopSource();
            }
            offsetBase = Math.max(0, Math.min(time, buffer?.duration ?? 0));
            if (wasPlaying) startSource(offsetBase);
        },

        setRate(rate: number): void {
            // Clock-Basis neu setzen damit getTime() korrekt bleibt
            offsetBase = getTime();
            clockBase = ctx.currentTime;
            currentRate = rate;
            if (source) source.playbackRate.value = rate;
        },

        setGain(value: number): void {
            gainNode.gain.value = Math.max(0, Math.min(1, value));
        },

        setBassGain(gainDb: number): void {
            bassFilter.gain.value = gainDb;
        },

        getTime,

        getDuration(): number {
            return buffer?.duration ?? 0;
        },

        isPlaying(): boolean {
            return playing;
        },

        onEnded(cb: () => void): void {
            endedCallback = cb;
        },

        destroy(): void {
            source?.stop();
            gainNode.disconnect();
            bassFilter.disconnect();
            buffer = null;
            source = null;
        },
    };
}
