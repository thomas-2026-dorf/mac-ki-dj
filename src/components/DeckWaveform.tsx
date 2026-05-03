import type { TransitionPoint } from "../types/track";

type BeatMarker = {
    time: number;
    percent: number;
    beat: number;
};

type CuePoint = {
    id: string;
    timeSeconds: number;
    type?: string;
    name?: string;
};

type Props = {
    waveform: number[];
    beatMarkers: BeatMarker[];
    cuePoints: CuePoint[];
    transitionPoints?: TransitionPoint[];
    currentTime: number;
    visibleStart: number;
    visibleDuration: number;
    progressPercent: number;
    onSeek: (clientX: number, rect: DOMRect) => void;
    onPan?: (deltaX: number, viewWidth: number) => void;
};

export default function DeckWaveform(_props: Props) {
    return (
        <div className="dj-waveform-outer" style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#334155",
            fontSize: "12px",
            height: "80px",
            border: "1px dashed #1e3a5a",
            borderRadius: "4px",
        }}>
            Waveform disabled – waiting for Superpowered engine
        </div>
    );
}
