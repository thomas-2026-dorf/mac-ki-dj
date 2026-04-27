import type { Track } from "../types/track";

type Props = {
    trackA?: Track;
    trackB?: Track;
    timeA?: number;
    timeB?: number;
    durationA?: number;
    durationB?: number;
};

export default function SyncWaveCompare({
    trackA,
    trackB,
    timeA = 0,
    timeB = 0,
    durationA = 0,
    durationB = 0,
}: Props) {

    const waveformA = trackA?.analysis?.waveform ?? [];
    const waveformB = trackB?.analysis?.waveform ?? [];

    const duration = Math.max(durationA, durationB, 1);

    const visibleSeconds = 48;
    const halfWindow = visibleSeconds / 2;

    const masterTime = timeA; // Deck A = Referenz

    const visibleStart =
        duration > visibleSeconds
            ? Math.min(Math.max(0, masterTime - halfWindow), duration - visibleSeconds)
            : 0;

    const visibleEnd = Math.min(duration, visibleStart + visibleSeconds);
    const visibleDuration = Math.max(1, visibleEnd - visibleStart);

    function sliceWave(waveform: number[], durationSrc: number) {
        if (!durationSrc || waveform.length === 0) return [];

        const start = Math.floor((visibleStart / durationSrc) * waveform.length);
        const end = Math.ceil((visibleEnd / durationSrc) * waveform.length);

        return waveform.slice(start, end);
    }

    const waveA = sliceWave(waveformA, durationA);
    const waveB = sliceWave(waveformB, durationB);

    const playheadPercent =
        ((masterTime - visibleStart) / visibleDuration) * 100;

    const offsetSeconds = timeB - timeA;
    const offsetMs = Math.round(offsetSeconds * 1000);
    const offsetLabel =
        offsetMs === 0
            ? "0 ms"
            : offsetMs > 0
                ? `B +${offsetMs} ms`
                : `B ${offsetMs} ms`;

    return (
        <div className="sync-compare">

            {/* Deck A */}
            <div className="sync-layer sync-a">
                {waveA.map((v, i) => (
                    <div
                        key={`a-${i}`}
                        className="bar a"
                        style={{ height: `${Math.max(6, v * 120)}%` }}
                    />
                ))}
            </div>

            {/* Deck B */}
            <div className="sync-layer sync-b">
                {waveB.map((v, i) => (
                    <div
                        key={`b-${i}`}
                        className="bar b"
                        style={{ height: `${Math.max(6, v * 120)}%` }}
                    />
                ))}
            </div>

            <div className="sync-offset-label">
                Offset: {offsetLabel}
            </div>

            {/* Playhead */}
            <div
                className="sync-playhead"
                style={{ left: `${playheadPercent}%` }}
            />
        </div>
    );
}
