import { useEffect, useState, useRef, useCallback } from "react";
import "./App.css";
import "./layout.css";

import TrackList from "./components/TrackList";
import QueuePanel from "./components/QueuePanel";
import MixPlayer from "./components/MixPlayer";
import AiPanel from "./components/AiPanel";

import { calculateTransitionScore } from "./modules/transition/transitionScore";
import { planMixTransition } from "./modules/transition/autoMixPlanner";
import { MixEngine } from "./modules/audio/mixEngine";
import type { MixState } from "./modules/audio/mixEngine";

import type { Track } from "./types/track";

const QUEUE_STORAGE_KEY = "tk-dj-queue-v1";

function loadSavedQueue(): Track[] {
  const saved = localStorage.getItem(QUEUE_STORAGE_KEY);
  if (!saved) return [];
  try { return JSON.parse(saved); } catch { return []; }
}

function App() {
  const [queue, setQueue] = useState<Track[]>(() => loadSavedQueue());
  const [mixState, setMixState] = useState<MixState | null>(null);

  const mixEngineRef = useRef<MixEngine | null>(null);
  const queueRef = useRef<Track[]>(queue);

  useEffect(() => { queueRef.current = queue; }, [queue]);

  useEffect(() => {
    localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
  }, [queue]);

  const feedEngine = useCallback((currentTrack: Track) => {
    const engine = mixEngineRef.current;
    if (!engine) return;
    // Nicht doppelt vorbereiten — prüfe direkt am Engine-State
    if (engine.getState().nextTrack) return;
    const q = queueRef.current;
    if (q.length === 0) return;

    const [next, ...rest] = q;
    queueRef.current = rest;
    setQueue(rest);
    const plan = planMixTransition(currentTrack, next);
    engine.prepareNext(next, plan);
  }, []);

  useEffect(() => {
    const engine = new MixEngine();
    engine.onStateChange(setMixState);

    engine.onTransition((_prev, nextTrack) => {
      feedEngine(nextTrack);
    });

    engine.onQueueEmpty(() => {
      const q = queueRef.current;
      if (q.length === 0) return;
      const [first, ...rest] = q;
      queueRef.current = rest;
      setQueue(rest);
      engine.loadAndPlay(first).then(() => feedEngine(first));
    });

    mixEngineRef.current = engine;
    return () => engine.destroy();
  }, [feedEngine]);

  // Auto-feed: wenn Engine spielt aber kein Next-Track bereit ist → Queue pumpen
  // queue.length als Dependency damit neu hinzugefügte Songs sofort in Player 2 landen
  useEffect(() => {
    if (mixState?.status === "playing" && mixState.currentTrack && !mixState.nextTrack) {
      feedEngine(mixState.currentTrack);
    }
  }, [mixState?.status, mixState?.currentTrack?.id, mixState?.nextTrack, queue.length, feedEngine]);

  function handleTrackUpdated(updatedTrack: Track) {
    setQueue(q => q.map(t => t.id === updatedTrack.id ? updatedTrack : t));
  }

  function addTrackToQueue(track: Track) {
    setQueue(prev => [...prev, track]);
  }

  function handleStartAutomix() {
    const engine = mixEngineRef.current;
    const state = engine?.getState();
    if (!engine || (state && state.status !== "idle")) return;

    const q = queueRef.current;
    if (q.length === 0) return;

    const [first, second, ...rest] = q;
    queueRef.current = second ? rest : [];
    setQueue(second ? rest : []);

    engine.loadAndPlay(first).then(() => {
      if (second) {
        const plan = planMixTransition(first, second);
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
    mixEngineRef.current?.stop();
  }

  function handleReset() {
    mixEngineRef.current?.stop();
    setQueue([]);
  }

  const nextTransitionScore =
    queue.length >= 2 ? calculateTransitionScore(queue[0], queue[1]) : null;

  const referenceTrack = mixState?.currentTrack ?? (queue.length > 0 ? queue[0] : null);
  const isRunning = mixState?.status === "playing" || mixState?.status === "transitioning";

  return (
    <div className="app">
      <MixPlayer
        state={mixState}
        onPlay={() => mixEngineRef.current?.resume()}
        onPause={() => mixEngineRef.current?.pause()}
        onSkip={() => mixEngineRef.current?.skip()}
        onStartAutomix={handleStartAutomix}
        onSeek={(t) => mixEngineRef.current?.seek(t)}
        onStop={handleStop}
        onReset={handleReset}
      />

      <div className="main-bottom">
        <TrackList
          onLoadA={addTrackToQueue}
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
    </div>
  );
}

export default App;
