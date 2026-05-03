const WAVEFORM_HEIGHT = 80;

type Props = {
    trackId: string;
    waveform: number[];
    duration: number;
    currentTime: number;
    onSeek: (time: number) => void;
    bpm?: number;
    beatGridStartSeconds?: number;
    showZoom?: boolean;
};

export default function PlayerWaveform(_props: Props) {
    return (
        <div style={{
            width: "100%",
            height: `${WAVEFORM_HEIGHT}px`,
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
