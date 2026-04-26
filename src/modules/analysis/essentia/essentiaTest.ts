import { Essentia, EssentiaWASM } from "essentia.js";

export async function testEssentia(audioBuffer: AudioBuffer) {
    const essentia = new Essentia(EssentiaWASM);

    const signal = Array.from(audioBuffer.getChannelData(0));

    const bpmResult = essentia.RhythmExtractor2013(signal);

    return {
        bpm: bpmResult.bpm,
        beats: bpmResult.beats,
    };
}
