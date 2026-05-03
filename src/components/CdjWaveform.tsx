import type { WaveformPeaks } from "../modules/analysis/waveformPeaks";

const HEIGHT = 80;

type Props = {
    trackId: string;
    waveform: number[];
    waveformPeaks?: WaveformPeaks;
    duration: number;
    currentTime: number;
    onSeek: (time: number) => void;
    bpm?: number;
    beatGridStartSeconds?: number;
    beats?: number[];
    metroBeat?: { n: number; t: number } | null;
    phaseOffset?: number;
    mixInStartSeconds?: number;
    mixInEndSeconds?: number;
    mixOutStartSeconds?: number;
    mixOutEndSeconds?: number;
    activityRegions?: { startSeconds: number; endSeconds: number; confidence: number }[];
    preActivityBeatCount?: number;
    alignedVocalRegions?: { startSeconds: number; endSeconds: number }[];
    vocalMixZones?: { type: "mix-in" | "mix-out"; startSeconds: number; endSeconds: number }[];
};

export default function CdjWaveform(_props: Props) {
    return (
        <div style={{
            width: "100%",
            height: `${HEIGHT}px`,
            background: "#04090f",
            borderRadius: "4px",
            border: "1px dashed #1e3a5a",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#334155",
            fontSize: "12px",
        }}>
            Waveform disabled – waiting for Superpowered engine
        </div>
    );
}
