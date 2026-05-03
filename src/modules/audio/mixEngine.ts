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
    nextTime: number;
    nextDuration: number;
    nextPlaying: boolean;
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
    private tickCount = 0;

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

    async loadOnly(track: Track): Promise<void> {
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
            this.cur.audio.onEnded(() => this.handleTrackEnded());
        } catch (e) {
            console.error("loadOnly failed:", e);
            this.status = "idle";
            this.emitState();
            return;
        }
        this.status = "paused";
        this.emitState();
    }

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

        console.log("LOAD track", track.title);
        this.cur.audio.onEnded(() => this.handleTrackEnded());
        this.status = "paused";
        this.emitState();
    }

    async prepareNext(track: Track, plan: MixTransitionPlan): Promise<void> {
        if (!track.url) return;
        console.log(`[prepareNext] track="${track.title}" outroStart=${plan.outroStartSeconds.toFixed(2)} type=${plan.type}`);

        // Slot sofort reservieren — verhindert Race mit auto-feed useEffect
        this.nxt.track = track;
        this.nxt.audio.setGain(0);
        this.cur.plan = plan;
        this.emitState();

        const myGen = ++this.prepareGen;
        try {
            const wavPath = await ensureWavCache(track.url);
            if (myGen !== this.prepareGen) return;
            await this.nxt.audio.load(wavPath);
            if (myGen !== this.prepareGen) return;
            this.nxt.audio.setRate(plan.playbackRate);
        } catch (e) {
            console.error("prepareNext failed:", e);
            this.nxt.track = null;
            this.cur.plan = null;
            this.emitState();
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
        if (this.status !== "playing" && this.status !== "transitioning" && !this.nxt.audio.isPlaying()) return;
        this.tickCount++;
        const t = this.cur.audio.getTime();
        const plan = this.cur.plan;

        if (this.status === "playing" && !this.transitionStarted && plan) {
            if (this.tickCount % 20 === 0) {
                console.log(`[Tick] t=${t.toFixed(2)} outroStart=${plan.outroStartSeconds.toFixed(2)} nxt="${this.nxt.track?.title ?? "null"}"`);
            }
            if (this.nxt.track && t >= plan.outroStartSeconds) {
                this.startTransition(plan);
            }
        }

        this.emitState();
    }

    private startTransition(plan: MixTransitionPlan): void {
        console.log(`[startTransition] type=${plan.type} blend=${plan.blendDurationSeconds}s nextOffset=${plan.nextTrackOffset.toFixed(2)} nxt="${this.nxt.track?.title}"`);
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
        // Alten Slot freigeben — sonst denkt feedEngine der Slot ist noch belegt
        this.nxt.track = null;
        this.nxt.plan = null;
        this.transitionStarted = false;
        this.status = "playing";
        this.transitionCallback?.(prevTrack, nextTrack);
        this.emitState();
    }

    private handleTrackEnded(): void {
        if (this.status === "transitioning") return;
        this.cur.track = null;
        this.cur.plan = null;
        this.status = "idle";
        this.stopTick();
        this.emitState();
        this.queueEmptyCallback?.();
    }

    pause(): void {
        if (this.status === "idle" || this.status === "loading") return;
        console.log("PAUSE triggered", this.status);
        this.cur.audio.pause();
        if (this.status === "transitioning") this.nxt.audio.pause();
        this.status = "paused";
        this.stopTick();
        this.emitState();
    }

    resume(): void {
        if (this.status !== "paused") return;
        console.log("PLAY triggered");
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

    resumeNext(): void {
        if (!this.nxt.track) return;
        this.nxt.audio.setGain(0.7);
        this.nxt.audio.play();
        this.startTick();
        this.emitState();
    }

    pauseNext(): void {
        if (!this.nxt.track) return;
        this.nxt.audio.pause();
        this.nxt.audio.setGain(0);
        if (this.status !== "playing" && this.status !== "transitioning") {
            this.stopTick();
        }
        this.emitState();
    }

    stopNext(): void {
        this.prepareGen++;
        this.nxt.audio.pause();
        this.nxt.audio.setGain(1);
        this.nxt.track = null;
        this.nxt.plan = null;
        this.cur.plan = null;
        if (this.status !== "playing" && this.status !== "transitioning") {
            this.stopTick();
        }
        this.emitState();
    }

    seekNext(time: number): void {
        if (!this.nxt.track) return;
        this.nxt.audio.seek(time);
        this.emitState();
    }

    seek(time: number): void {
        if (this.status === "idle" || this.status === "loading") return;
        this.cur.audio.seek(time);
        this.emitState();
    }

    setRateNext(rate: number): void {
        if (!this.nxt.track) return;
        this.nxt.audio.setRate(rate);
        this.emitState();
    }

    setRateCur(rate: number): void {
        this.cur.audio.setRate(rate);
        this.emitState();
    }

    setVolume(v: number): void {
        this.slots.forEach(s => s.audio.setGain(v));
    }

    stop(): void {
        this.stopTick();
        this.prepareGen++;
        this.slots.forEach(s => {
            s.audio.pause();
            s.audio.setGain(1);
            s.track = null;
            s.plan = null;
        });
        this.activeSlot = 0;
        this.transitionStarted = false;
        this.status = "idle";
        this.emitState();
    }

    ejectCurrent(): void {
        this.prepareGen++;
        this.cur.audio.pause();
        this.cur.audio.setGain(1);
        this.cur.track = null;
        this.cur.plan = null;
        this.transitionStarted = false;
        if (!this.nxt.audio.isPlaying()) this.stopTick();
        this.status = "idle";
        this.emitState();
    }

    async loadOnlyNext(track: Track): Promise<void> {
        if (!track.url) return;
        this.prepareGen++;
        const myGen = this.prepareGen;
        this.nxt.track = track;
        this.nxt.plan = null;
        this.nxt.audio.setGain(1);
        this.emitState();
        try {
            const wavPath = await ensureWavCache(track.url);
            if (myGen !== this.prepareGen) return;
            await this.nxt.audio.load(wavPath);
            if (myGen !== this.prepareGen) return;
            this.nxt.audio.onEnded(() => this.handleTrackEnded());
            this.emitState();
        } catch (e) {
            console.error("loadOnlyNext failed:", e);
            if (myGen !== this.prepareGen) return;
            this.nxt.track = null;
            this.emitState();
        }
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
            nextTime: this.nxt.audio.getTime(),
            nextDuration: this.nxt.audio.getDuration(),
            nextPlaying: this.nxt.audio.isPlaying(),
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
