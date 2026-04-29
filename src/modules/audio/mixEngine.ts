import { createDeckAudio, type DeckAudio } from "./deckAudio";
import { ensureWavCache } from "./timeStretchEngine";
import type { Track } from "../../types/track";
import type { MixTransitionPlan } from "../transition/autoMixPlanner";

export type MixStatus = "idle" | "loading" | "playing" | "transitioning" | "paused";

export type MixState = {
    status: MixStatus;
    currentTrack: Track | null;
    nextTrack: Track | null;
    currentTime: number;
    currentDuration: number;
    transitionPlan: MixTransitionPlan | null;
    timeToTransition: number | null;
};

type Slot = {
    audio: DeckAudio;
    track: Track | null;
    plan: MixTransitionPlan | null;
};

export class MixEngine {
    private slots: [Slot, Slot];
    private activeSlot = 0;
    private status: MixStatus = "idle";
    private tickInterval: number | null = null;
    private transitionStarted = false;
    private prepareGen = 0;

    private stateCallback: ((state: MixState) => void) | null = null;
    private transitionCallback: ((prev: Track, next: Track) => void) | null = null;
    private queueEmptyCallback: (() => void) | null = null;

    constructor() {
        this.slots = [
            { audio: createDeckAudio(), track: null, plan: null },
            { audio: createDeckAudio(), track: null, plan: null },
        ];
    }

    onStateChange(cb: (state: MixState) => void) { this.stateCallback = cb; }
    onTransition(cb: (prev: Track, next: Track) => void) { this.transitionCallback = cb; }
    onQueueEmpty(cb: () => void) { this.queueEmptyCallback = cb; }

    private get cur(): Slot { return this.slots[this.activeSlot]; }
    private get nxt(): Slot { return this.slots[1 - this.activeSlot]; }

    async loadAndPlay(track: Track): Promise<void> {
        if (!track.url) return;
        this.status = "loading";
        this.emitState();

        try {
            const wavPath = await ensureWavCache(track.url);
            this.cur.audio.setGain(1);
            await this.cur.audio.load(wavPath);
            this.cur.track = track;
            this.cur.plan = null;
            this.transitionStarted = false;
        } catch (e) {
            console.error("loadAndPlay failed:", e);
            this.status = "idle";
            this.emitState();
            return;
        }

        this.status = "playing";
        this.cur.audio.play();
        this.cur.audio.onEnded(() => this.handleTrackEnded());
        this.startTick();
        this.emitState();
    }

    async prepareNext(track: Track, plan: MixTransitionPlan): Promise<void> {
        if (!track.url) return;
        const myGen = ++this.prepareGen;

        try {
            const wavPath = await ensureWavCache(track.url);
            if (myGen !== this.prepareGen) return;

            await this.nxt.audio.load(wavPath);
            if (myGen !== this.prepareGen) return;

            this.nxt.track = track;
            this.nxt.audio.setGain(0);
            this.nxt.audio.setRate(plan.playbackRate);
            this.cur.plan = plan;
        } catch (e) {
            console.error("prepareNext failed:", e);
            return;
        }

        this.emitState();
    }

    private startTick(): void {
        if (this.tickInterval !== null) return;
        this.tickInterval = window.setInterval(() => this.tick(), 50);
    }

    private stopTick(): void {
        if (this.tickInterval !== null) {
            clearInterval(this.tickInterval);
            this.tickInterval = null;
        }
    }

    private tick(): void {
        if (this.status !== "playing") return;
        const t = this.cur.audio.getTime();
        const plan = this.cur.plan;

        if (!this.transitionStarted && plan && this.nxt.track && t >= plan.outroStartSeconds) {
            this.startTransition(plan);
        }

        this.emitState();
    }

    private startTransition(plan: MixTransitionPlan): void {
        this.transitionStarted = true;
        this.status = "transitioning";

        const prevTrack = this.cur.track!;
        const nextTrack = this.nxt.track!;

        this.nxt.audio.seek(plan.nextTrackOffset);
        this.nxt.audio.play();
        this.nxt.audio.onEnded(() => this.handleTrackEnded());

        if (plan.type === "cut") {
            this.cur.audio.setGain(0);
            this.cur.audio.pause();
            this.nxt.audio.setGain(1);
            this.completeTransition(prevTrack, nextTrack);
        } else {
            const STEPS = 30;
            const stepMs = (plan.blendDurationSeconds * 1000) / STEPS;
            let step = 0;

            const fadeInterval = window.setInterval(() => {
                step++;
                const progress = step / STEPS;
                this.cur.audio.setGain(1 - progress);
                this.nxt.audio.setGain(progress);

                if (step >= STEPS) {
                    clearInterval(fadeInterval);
                    this.cur.audio.setGain(0);
                    this.cur.audio.pause();
                    this.cur.audio.setGain(1);
                    this.completeTransition(prevTrack, nextTrack);
                }
            }, stepMs);
        }
    }

    private completeTransition(prevTrack: Track, nextTrack: Track): void {
        this.activeSlot = 1 - this.activeSlot;
        this.transitionStarted = false;
        this.status = "playing";
        this.transitionCallback?.(prevTrack, nextTrack);
        this.emitState();
    }

    private handleTrackEnded(): void {
        if (this.status === "transitioning") return;
        this.status = "idle";
        this.stopTick();
        this.emitState();
        this.queueEmptyCallback?.();
    }

    pause(): void {
        if (this.status !== "playing") return;
        this.cur.audio.pause();
        this.status = "paused";
        this.stopTick();
        this.emitState();
    }

    resume(): void {
        if (this.status !== "paused") return;
        this.cur.audio.play();
        this.status = "playing";
        this.startTick();
        this.emitState();
    }

    skip(): void {
        const plan = this.cur.plan;
        if (!plan || !this.nxt.track || this.transitionStarted) return;
        this.startTransition({ ...plan, type: "cut", blendDurationSeconds: 0.05 });
    }

    getState(): MixState {
        const t = this.cur.audio.getTime();
        const plan = this.cur.plan;
        const timeToTransition =
            plan && !this.transitionStarted && this.nxt.track
                ? Math.max(0, plan.outroStartSeconds - t)
                : null;

        return {
            status: this.status,
            currentTrack: this.cur.track,
            nextTrack: this.nxt.track,
            currentTime: t,
            currentDuration: this.cur.audio.getDuration(),
            transitionPlan: plan,
            timeToTransition,
        };
    }

    private emitState(): void {
        this.stateCallback?.(this.getState());
    }

    destroy(): void {
        this.stopTick();
        this.slots.forEach(s => s.audio.destroy());
    }
}
