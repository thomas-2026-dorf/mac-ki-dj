export type SyncRating = "ok" | "caution" | "bad";

export type SyncPlan = {
    masterBpm: number | null;
    targetBpm: number | null;
    pitchPercent: number | null;
    playbackRate: number | null;
    rating: SyncRating;
    reason: string;
};

type BuildSyncPlanInput = {
    masterBpm?: number | null;
    targetBpm?: number | null;
};

function isValidBpm(value?: number | null): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function buildSyncPlan(input: BuildSyncPlanInput): SyncPlan {
    const { masterBpm, targetBpm } = input;

    if (!isValidBpm(masterBpm) || !isValidBpm(targetBpm)) {
        return {
            masterBpm: isValidBpm(masterBpm) ? masterBpm : null,
            targetBpm: isValidBpm(targetBpm) ? targetBpm : null,
            pitchPercent: null,
            playbackRate: null,
            rating: "bad",
            reason: "Sync nicht möglich: Master-BPM oder Ziel-BPM fehlt.",
        };
    }

    const playbackRate = masterBpm / targetBpm;
    const pitchPercent = (playbackRate - 1) * 100;
    const absPitch = Math.abs(pitchPercent);

    if (absPitch <= 4) {
        return {
            masterBpm,
            targetBpm,
            pitchPercent,
            playbackRate,
            rating: "ok",
            reason: "BPM-Anpassung ist unkritisch.",
        };
    }

    if (absPitch <= 8) {
        return {
            masterBpm,
            targetBpm,
            pitchPercent,
            playbackRate,
            rating: "caution",
            reason: "BPM-Anpassung ist möglich, aber hörbar.",
        };
    }

    return {
        masterBpm,
        targetBpm,
        pitchPercent,
        playbackRate,
        rating: "bad",
        reason: "BPM-Sprung ist zu groß für sauberen Auto-Sync.",
    };
}

export function formatPitchPercent(value: number | null): string {
    if (value === null) return "—";

    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(1)}%`;
}

export function formatPlaybackRate(value: number | null): string {
    if (value === null) return "—";

    return `${value.toFixed(3)}x`;
}
