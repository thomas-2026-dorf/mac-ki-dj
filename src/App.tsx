import { useEffect, useState, useRef, useCallback } from "react";
import "./App.css";
import "./layout.css";

import TrackList from "./components/TrackList";
import QueuePanel from "./components/QueuePanel";
import MixPlayer from "./components/MixPlayer";
import AiPanel from "./components/AiPanel";

import { invoke } from "@tauri-apps/api/core";
import { calculateTransitionScore } from "./modules/transition/transitionScore";
import { planMixTransition, decideTransition } from "./modules/transition/autoMixPlanner";
import { MixEngine } from "./modules/audio/mixEngine";
import type { MixState } from "./modules/audio/mixEngine";
import { loadAnalysisCache } from "./modules/analysis/analysisCache";
import { createMixPlan } from "./modules/automix/createMixPlan";

import type { Track, TransitionPoint } from "./types/track";

const QUEUE_STORAGE_KEY = "tk-dj-queue-v1";

function loadSavedQueue(): Track[] {
  const saved = localStorage.getItem(QUEUE_STORAGE_KEY);
  if (!saved) return [];
  try { return JSON.parse(saved); } catch { return []; }
}

type VocalData = {
  vocalStartSeconds: number;
  vocalEndSeconds: number;
  vocalStartBeatIndex: number | null;
  vocalEndBeatIndex: number | null;
};

async function loadVocalJson(track: Track): Promise<VocalData | null> {
  if (!track.url) return null;
  try {
    const parts = track.url.split("/");
    const fileName = parts.pop() ?? "track";
    const dir = parts.join("/");
    const baseName = fileName.replace(/\.[^/.]+$/, "");
    const path = `${dir}/.tkdj/${baseName}.vocal.json`;
    const exists = await invoke<boolean>("tkdj_file_exists", { path });
    if (!exists) return null;
    const raw = await invoke<string>("tkdj_read_text_file", { path });
    return JSON.parse(raw) as VocalData;
  } catch { return null; }
}

async function makePlan(a: Track, b: Track) {
  const [aVocal, bVocal] = await Promise.all([loadVocalJson(a), loadVocalJson(b)]);

  const enrichedA: Track = aVocal ? {
    ...a,
    outroStartSeconds: a.outroStartSeconds ?? aVocal.vocalEndSeconds,
    analysis: a.analysis ? {
      ...a.analysis,
      outroStartSeconds: a.analysis.outroStartSeconds ?? aVocal.vocalEndSeconds,
    } : a.analysis,
  } : a;

  const enrichedB: Track = bVocal ? {
    ...b,
    introEndSeconds: b.introEndSeconds ?? bVocal.vocalStartSeconds,
    analysis: b.analysis ? {
      ...b.analysis,
      introEndSeconds: b.analysis.introEndSeconds ?? bVocal.vocalStartSeconds,
    } : b.analysis,
  } : b;

  const plan = planMixTransition(enrichedA, enrichedB);
  const decision = decideTransition(enrichedA, enrichedB);
  return { ...plan, outroStartSeconds: decision.transitionStartTime };
}

function App() {
  const [queue, setQueue] = useState<Track[]>(() => loadSavedQueue());
  const [mixState, setMixState] = useState<MixState | null>(null);
  const [currentTrackTPs, setCurrentTrackTPs] = useState<TransitionPoint[] | null>(null);
  const currentTrackIdRef = useRef<string | null>(null);
  const [nextTrackTPs, setNextTrackTPs] = useState<TransitionPoint[] | null>(null);
  const nextTrackIdRef = useRef<string | null>(null);

  // Waveform-Override: automatisch aus File-Cache laden wenn Track keine Waveform hat
  const [currentWaveformOverride, setCurrentWaveformOverride] = useState<number[] | null>(null);
  const [nextWaveformOverride, setNextWaveformOverride] = useState<number[] | null>(null);

  const [currentVocalData, setCurrentVocalData] = useState<VocalData | null>(null);
  const [nextVocalData, setNextVocalData] = useState<VocalData | null>(null);

  const mixEngineRef = useRef<MixEngine | null>(null);
  const queueRef = useRef<Track[]>(queue);
  const automixActiveRef = useRef(false);

  useEffect(() => { queueRef.current = queue; }, [queue]);

  useEffect(() => {
    localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
  }, [queue]);

  const feedEngine = useCallback(async (currentTrack: Track) => {
    const engine = mixEngineRef.current;
    if (!engine) return;
    // Nicht doppelt vorbereiten — prüfe direkt am Engine-State
    if (engine.getState().nextTrack) return;
    const q = queueRef.current;
    if (q.length === 0) return;

    const [next, ...rest] = q;
    queueRef.current = rest;
    setQueue(rest);
    const plan = await makePlan(currentTrack, next);
    engine.prepareNext(next, plan);
  }, []);

  useEffect(() => {
    const engine = new MixEngine();
    engine.onStateChange(setMixState);

    engine.onTransition((_prev, nextTrack) => {
      feedEngine(nextTrack);
    });

    engine.onQueueEmpty(() => {
      if (!automixActiveRef.current) return;
      const q = queueRef.current;
      if (q.length === 0) return;
      const [first, ...rest] = q;
      queueRef.current = rest;
      setQueue(rest);
      engine.loadAndPlay(first).then(() => { engine.resume(); feedEngine(first); });
    });

    mixEngineRef.current = engine;
    return () => engine.destroy();
  }, [feedEngine]);

  // Auto-feed: wenn Automix aktiv + Engine spielt aber kein Next-Track bereit → Queue pumpen
  useEffect(() => {
    if (!automixActiveRef.current) return;
    if (mixState?.status === "playing" && mixState.currentTrack && !mixState.nextTrack) {
      feedEngine(mixState.currentTrack);
    }
  }, [mixState?.status, mixState?.currentTrack?.id, mixState?.nextTrack, queue.length, feedEngine]);

  // Waveform auto-load: Track hat keine Waveform → File-Cache lesen (kein WAV, <1s)
  useEffect(() => {
    setCurrentWaveformOverride(null);
    const track = mixState?.currentTrack;
    if (!track?.url || (track.analysis?.waveform?.length ?? 0) > 0) return;
    let cancelled = false;
    loadAnalysisCache(track.url)
      .then(cached => { if (!cancelled && (cached?.waveform?.length ?? 0) > 0) setCurrentWaveformOverride(cached!.waveform!); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [mixState?.currentTrack?.id]);

  useEffect(() => {
    setNextWaveformOverride(null);
    const track = mixState?.nextTrack;
    if (!track?.url || (track.analysis?.waveform?.length ?? 0) > 0) return;
    let cancelled = false;
    loadAnalysisCache(track.url)
      .then(cached => { if (!cancelled && (cached?.waveform?.length ?? 0) > 0) setNextWaveformOverride(cached!.waveform!); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [mixState?.nextTrack?.id]);

  useEffect(() => {
    setCurrentVocalData(null);
    const track = mixState?.currentTrack;
    if (!track) return;
    let cancelled = false;
    loadVocalJson(track).then(data => { if (!cancelled) setCurrentVocalData(data); }).catch(() => {});
    return () => { cancelled = true; };
  }, [mixState?.currentTrack?.id]);

  useEffect(() => {
    setNextVocalData(null);
    const track = mixState?.nextTrack;
    if (!track) return;
    let cancelled = false;
    loadVocalJson(track).then(data => { if (!cancelled) setNextVocalData(data); }).catch(() => {});
    return () => { cancelled = true; };
  }, [mixState?.nextTrack?.id]);

  function handleTrackUpdated(updatedTrack: Track) {
    setQueue(q => q.map(t => t.id === updatedTrack.id ? updatedTrack : t));
  }

  function handleRemoveTransitionPoint(pointId: string) {
    const track = mixState?.currentTrack;
    if (!track) return;
    const existing = currentTrackTPs ?? track.transitionPoints ?? [];
    const updated = existing.filter(p => p.id !== pointId);
    setCurrentTrackTPs(updated);
    const saved = localStorage.getItem("tk-dj-track-library-v1");
    const library: Track[] = saved ? (JSON.parse(saved) as Track[]) : [];
    const updatedLibrary = library.map(t =>
      t.id === track.id ? { ...t, transitionPoints: updated } : t
    );
    localStorage.setItem("tk-dj-track-library-v1", JSON.stringify(updatedLibrary));
    handleTrackUpdated({ ...track, transitionPoints: updated });
  }

  function handleSaveTransitionPoint(point: TransitionPoint) {
    const track = mixState?.currentTrack;
    if (!track) return;

    // Reset override wenn Track gewechselt hat
    if (currentTrackIdRef.current !== track.id) {
      currentTrackIdRef.current = track.id;
      setCurrentTrackTPs(null);
    }

    const existing = currentTrackTPs ?? track.transitionPoints ?? [];
    const updated = [...existing, point];
    setCurrentTrackTPs(updated);

    // localStorage-Bibliothek aktualisieren
    const saved = localStorage.getItem("tk-dj-track-library-v1");
    const library: Track[] = saved ? (JSON.parse(saved) as Track[]) : [];
    const updatedLibrary = library.map(t =>
      t.id === track.id ? { ...t, transitionPoints: updated } : t
    );
    localStorage.setItem("tk-dj-track-library-v1", JSON.stringify(updatedLibrary));

    handleTrackUpdated({ ...track, transitionPoints: updated });
  }

  function handleUpdateTransitionPoint(point: TransitionPoint) {
    const track = mixState?.currentTrack;
    if (!track) return;
    const existing = currentTrackTPs ?? track.transitionPoints ?? [];
    const updated = existing.map(p => p.id === point.id ? point : p);
    setCurrentTrackTPs(updated);
    const saved = localStorage.getItem("tk-dj-track-library-v1");
    const library: Track[] = saved ? (JSON.parse(saved) as Track[]) : [];
    localStorage.setItem("tk-dj-track-library-v1", JSON.stringify(
      library.map(t => t.id === track.id ? { ...t, transitionPoints: updated } : t)
    ));
    handleTrackUpdated({ ...track, transitionPoints: updated });
  }

  function handleRemoveTransitionPointB(pointId: string) {
    const track = mixState?.nextTrack;
    if (!track) return;
    const existing = nextTrackTPs ?? track.transitionPoints ?? [];
    const updated = existing.filter(p => p.id !== pointId);
    setNextTrackTPs(updated);
    const saved = localStorage.getItem("tk-dj-track-library-v1");
    const library: Track[] = saved ? (JSON.parse(saved) as Track[]) : [];
    localStorage.setItem("tk-dj-track-library-v1", JSON.stringify(
      library.map(t => t.id === track.id ? { ...t, transitionPoints: updated } : t)
    ));
    handleTrackUpdated({ ...track, transitionPoints: updated });
  }

  function handleUpdateTransitionPointB(point: TransitionPoint) {
    const track = mixState?.nextTrack;
    if (!track) return;
    const existing = nextTrackTPs ?? track.transitionPoints ?? [];
    const updated = existing.map(p => p.id === point.id ? point : p);
    setNextTrackTPs(updated);
    const saved = localStorage.getItem("tk-dj-track-library-v1");
    const library: Track[] = saved ? (JSON.parse(saved) as Track[]) : [];
    localStorage.setItem("tk-dj-track-library-v1", JSON.stringify(
      library.map(t => t.id === track.id ? { ...t, transitionPoints: updated } : t)
    ));
    handleTrackUpdated({ ...track, transitionPoints: updated });
  }

  function handleSaveTransitionPointB(point: TransitionPoint) {
    const track = mixState?.nextTrack;
    if (!track) return;
    if (nextTrackIdRef.current !== track.id) {
      nextTrackIdRef.current = track.id;
      setNextTrackTPs(null);
    }
    const existing = nextTrackTPs ?? track.transitionPoints ?? [];
    const updated = [...existing, point];
    setNextTrackTPs(updated);
    const saved = localStorage.getItem("tk-dj-track-library-v1");
    const library: Track[] = saved ? (JSON.parse(saved) as Track[]) : [];
    localStorage.setItem("tk-dj-track-library-v1", JSON.stringify(
      library.map(t => t.id === track.id ? { ...t, transitionPoints: updated } : t)
    ));
    handleTrackUpdated({ ...track, transitionPoints: updated });
  }

  function addTrackToQueue(track: Track) {
    setQueue(prev => [...prev, track]);
  }

  function handleStartAutomix() {
    const engine = mixEngineRef.current;
    const state = engine?.getState();
    if (!engine || (state && state.status !== "idle" && state.status !== "paused")) return;

    const q = queueRef.current;

    // Paused-State: Track ist schon geladen, Queue füttern aber NICHT auto-resume
    if (state?.status === "paused" && state.currentTrack) {
      automixActiveRef.current = true;
      feedEngine(state.currentTrack);
      return;
    }

    if (q.length === 0) return;

    automixActiveRef.current = true;
    const [first, second, ...rest] = q;
    queueRef.current = second ? rest : [];
    setQueue(second ? rest : []);

    engine.loadAndPlay(first).then(async () => {
      if (second) {
        const plan = await makePlan(first, second);
        engine.prepareNext(second, plan);
      }
    });
  }

  function clearQueue() { setQueue([]); }

  function removeFromQueue(trackId: string) {
    setQueue(prev => prev.filter(t => t.id !== trackId));
  }

  function moveUp(index: number) {
    setQueue(prev => {
      if (index === 0) return prev;
      const q = [...prev];
      [q[index - 1], q[index]] = [q[index], q[index - 1]];
      return q;
    });
  }

  function moveDown(index: number) {
    setQueue(prev => {
      if (index === prev.length - 1) return prev;
      const q = [...prev];
      [q[index], q[index + 1]] = [q[index + 1], q[index]];
      return q;
    });
  }

  function handleStop() {
    automixActiveRef.current = false;
    const engine = mixEngineRef.current;
    if (!engine) return;
    engine.pause();
    engine.seek(0);
  }

  function handleReset() {
    automixActiveRef.current = false;
    mixEngineRef.current?.stop();
    setQueue([]);
  }

  function handleLoadToPlayer1(track: Track) {
    const engine = mixEngineRef.current;
    if (!engine) return;
    engine.loadOnly(track);
  }

  async function handleLoadToPlayer2(track: Track) {
    const engine = mixEngineRef.current;
    if (!engine) return;
    const current = engine.getState().currentTrack;
    if (!current) {
      engine.loadOnlyNext(track);
      return;
    }
    const plan = await makePlan(current, track);
    engine.prepareNext(track, plan);
  }

  const nextTransitionScore =
    queue.length >= 2 ? calculateTransitionScore(queue[0], queue[1]) : null;

  const referenceTrack = mixState?.currentTrack ?? (queue.length > 0 ? queue[0] : null);
  const isRunning = mixState?.status === "playing" || mixState?.status === "transitioning";

  // Wenn Track wechselt: Override zurücksetzen
  const currentTrackId = mixState?.currentTrack?.id ?? null;
  if (currentTrackIdRef.current !== currentTrackId) {
    currentTrackIdRef.current = currentTrackId;
    if (currentTrackTPs !== null) setCurrentTrackTPs(null);
  }
  const nextTrackId = mixState?.nextTrack?.id ?? null;
  if (nextTrackIdRef.current !== nextTrackId) {
    nextTrackIdRef.current = nextTrackId;
    if (nextTrackTPs !== null) setNextTrackTPs(null);
  }

  // Waveform + TransitionPoints in mixState einpflegen ohne Engine-State zu berühren
  const mixStateForPlayer: MixState | null = (() => {
    if (!mixState) return null;
    let current = mixState.currentTrack;
    let next = mixState.nextTrack;

    if (current) {
      if (currentTrackTPs) {
        current = { ...current, transitionPoints: currentTrackTPs };
      }
      if (currentWaveformOverride && !(current.analysis?.waveform?.length)) {
        current = {
          ...current,
          analysis: { cuePoints: [], loops: [], ...current.analysis, waveform: currentWaveformOverride, status: "done" },
        };
      }
    }
    if (next && nextWaveformOverride && !(next.analysis?.waveform?.length)) {
      next = {
        ...next,
        analysis: { cuePoints: [], loops: [], ...next.analysis, waveform: nextWaveformOverride, status: "done" },
      };
    }
    if (next && nextTrackTPs) {
      next = { ...next, transitionPoints: nextTrackTPs };
    }

    return { ...mixState, currentTrack: current, nextTrack: next };
  })();

  const deckATrack = mixStateForPlayer?.currentTrack ?? null;
  const deckBTrack = mixStateForPlayer?.nextTrack ?? null;

  const mixPlan = deckATrack && deckBTrack && currentVocalData
    ? createMixPlan({
        master: {
          bpm: deckATrack.bpm,
          firstBeatSeconds: deckATrack.analysis?.firstBeatSeconds ?? 0,
          vocalEndSeconds: currentVocalData.vocalEndSeconds,
          transitionPoints: deckATrack.transitionPoints,
        },
        slave: {
          bpm: deckBTrack.bpm,
          firstBeatSeconds: deckBTrack.analysis?.firstBeatSeconds ?? 0,
          vocalStartSeconds: nextVocalData?.vocalStartSeconds,
        },
      })
    : null;

  return (
    <div className="app">
      <MixPlayer
        state={mixStateForPlayer}
        onPlay={() => mixEngineRef.current?.resume()}
        onPause={() => mixEngineRef.current?.pause()}
        onSkip={() => mixEngineRef.current?.skip()}
        onStartAutomix={handleStartAutomix}
        onSeek={(t) => mixEngineRef.current?.seek(t)}
        onStop={handleStop}
        onReset={handleReset}
        onDeckBPlay={() => mixEngineRef.current?.resumeNext()}
        onDeckBPause={() => mixEngineRef.current?.pauseNext()}
        onDeckBStop={() => mixEngineRef.current?.stopNext()}
        onDeckBSeek={(t) => mixEngineRef.current?.seekNext(t)}
        onSetRateNext={(r) => mixEngineRef.current?.setRateNext(r)}
        onSetRateCur={(r) => mixEngineRef.current?.setRateCur(r)}
        onSaveTransitionPoint={handleSaveTransitionPoint}
        onRemoveTransitionPoint={handleRemoveTransitionPoint}
        onUpdateTransitionPoint={handleUpdateTransitionPoint}
        onSaveTransitionPointB={handleSaveTransitionPointB}
        onRemoveTransitionPointB={handleRemoveTransitionPointB}
        onUpdateTransitionPointB={handleUpdateTransitionPointB}
        onSetVolume={v => mixEngineRef.current?.setVolume(v)}
      />

      <div className="main-bottom">
        <TrackList
          onLoadA={addTrackToQueue}
          onLoadP1={handleLoadToPlayer1}
          onLoadB={handleLoadToPlayer2}
          onTrackSelected={() => {}}
          onTrackUpdated={handleTrackUpdated}
          referenceTrack={referenceTrack}
        />

        <div className="right-panel">
          {nextTransitionScore && queue.length >= 2 && (
            <div className="transition-score-box">
              <strong>{queue[0].title} → {queue[1].title}</strong>
              <span>{nextTransitionScore.label} ({nextTransitionScore.score})</span>
              <small>{nextTransitionScore.reasons[0]}</small>
            </div>
          )}

          <div className="queue-actions">
            <button
              className="automix-button"
              onClick={handleStartAutomix}
              disabled={queue.length === 0 || isRunning}
            >
              Automix starten
            </button>
            <button
              className="automix-clear-button"
              onClick={clearQueue}
              disabled={queue.length === 0}
            >
              Queue leeren
            </button>
          </div>

          <QueuePanel
            queue={queue}
            onRemove={removeFromQueue}
            onMoveUp={moveUp}
            onMoveDown={moveDown}
          />
          <AiPanel />
        </div>
      </div>

      {mixPlan && (
        <div style={{
          position: "fixed",
          bottom: 10,
          left: 10,
          background: "#111",
          color: "#0f0",
          padding: "10px",
          fontSize: "12px",
          fontFamily: "monospace",
          borderRadius: "6px",
          zIndex: 9999
        }}>
          <div><b>MixPlan Debug</b></div>
          <div>Preset: {mixPlan.presetName}</div>
          <div>Länge: {mixPlan.lengthBeats} Beats</div>
          <div style={{ marginTop: 6 }}><b>Master</b></div>
          <div>Mix Start Beat: {mixPlan.mixStartBeat.toFixed(1)}</div>
          <div>Mix Start Time: {mixPlan.mixStartTimeSeconds.toFixed(2)}s</div>
          <div style={{ marginTop: 6 }}><b>Slave</b></div>
          <div>Start Beat: {mixPlan.slaveStartBeat.toFixed(1)}</div>
          <div>Start Time: {mixPlan.slaveStartTimeSeconds.toFixed(2)}s</div>
        </div>
      )}
    </div>
  );
}

export default App;
