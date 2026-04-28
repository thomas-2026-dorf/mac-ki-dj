import { useEffect, useState } from "react";
import "./App.css";
import "./layout.css";

import Deck from "./components/Deck";
import SyncWaveCompare from "./components/SyncWaveCompare";
import SyncWavePanel from "./components/SyncWavePanel";
import Crossfader from "./components/Crossfader";
import TrackList from "./components/TrackList";
import AiPanel from "./components/AiPanel";
import QueuePanel from "./components/QueuePanel";
import { calculateTransitionScore } from "./modules/transition/transitionScore";

import type { Track } from "./types/track";

const QUEUE_STORAGE_KEY = "tk-dj-queue-v1";

function loadSavedQueue(): Track[] {
  const savedQueue = localStorage.getItem(QUEUE_STORAGE_KEY);
  if (!savedQueue) return [];

  try {
    return JSON.parse(savedQueue);
  } catch {
    return [];
  }
}

function App() {
  const [deckATrack, setDeckATrack] = useState<Track | undefined>();
  const [deckBTrack, setDeckBTrack] = useState<Track | undefined>();
  const [queue, setQueue] = useState<Track[]>(() => loadSavedQueue());
  const [_nextDeck, setNextDeck] = useState<"A" | "B">("A");
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [activeDeck, setActiveDeck] = useState<"A" | "B">("A");
  const [crossfader, setCrossfader] = useState(0.5);
  const volumeA = 1 - crossfader;
  const volumeB = crossfader;

  const [deckATime, setDeckATime] = useState({ time: 0, duration: 0 });
  const [deckBTime, setDeckBTime] = useState({ time: 0, duration: 0 });
  const [deckASeekTo, setDeckASeekTo] = useState<number | null>(null);
  const [deckBSeekTo, setDeckBSeekTo] = useState<number | null>(null);

  // Automix Referenz (wichtig für spätere Bewertung)
  const automixReferenceTrack = queue.length > 0 ? queue[0] : null;

  const deckTransitionScore =
    deckATrack && deckBTrack
      ? calculateTransitionScore(deckATrack, deckBTrack)
      : null;

  const automixTransitionScore =
    queue.length >= 2
      ? calculateTransitionScore(queue[0], queue[1])
      : null;

  useEffect(() => {
    localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
  }, [queue]);

  function handleTrackUpdated(updatedTrack: Track) {
    setDeckATrack((current) =>
      current?.id === updatedTrack.id ? updatedTrack : current,
    );

    setDeckBTrack((current) =>
      current?.id === updatedTrack.id ? updatedTrack : current,
    );

    setQueue((currentQueue) =>
      currentQueue.map((track) =>
        track.id === updatedTrack.id ? updatedTrack : track,
      ),
    );
  }

  function clearQueue() {
    setQueue([]);
  }

  function removeFromQueue(trackId: string) {
    setQueue((prev) => prev.filter((t) => t.id !== trackId));
  }

  function moveUp(index: number) {
    setQueue((prev) => {
      if (index === 0) return prev;
      const newQueue = [...prev];
      [newQueue[index - 1], newQueue[index]] = [
        newQueue[index],
        newQueue[index - 1],
      ];
      return newQueue;
    });
  }

  function moveDown(index: number) {
    setQueue((prev) => {
      if (index === prev.length - 1) return prev;
      const newQueue = [...prev];
      [newQueue[index], newQueue[index + 1]] = [
        newQueue[index + 1],
        newQueue[index],
      ];
      return newQueue;
    });
  }

  function addTrackToQueue(track: Track) {
    setQueue((prev) => [...prev, track]);
  }

  function autoLoadFreeDeck() {
    if (queue.length === 0) return;
    if (deckATrack && deckBTrack) return;

    const [nextTrack, ...remainingQueue] = queue;

    // Automix-Start: Wenn beide Decks leer sind, zuerst Deck A laden
    // und den zweiten Automix-Song direkt in Deck B vorbereiten.
    if (!deckATrack && !deckBTrack) {
      const [secondTrack, ...restQueue] = remainingQueue;

      setDeckATrack(nextTrack);
      setActiveDeck("A");
      setNextDeck("B");

      if (secondTrack) {
        setDeckBTrack(secondTrack);
        setQueue(restQueue);
      } else {
        setQueue(remainingQueue);
      }

      return;
    }

    // Wenn ein Deck läuft/geladen ist, den nächsten Song ins freie Gegendeck laden.
    if (!deckBTrack && activeDeck === "A") {
      setDeckBTrack(nextTrack);
      setNextDeck("A");
    } else if (!deckATrack && activeDeck === "B") {
      setDeckATrack(nextTrack);
      setNextDeck("B");
    } else if (!deckATrack) {
      setDeckATrack(nextTrack);
      setNextDeck("B");
    } else if (!deckBTrack) {
      setDeckBTrack(nextTrack);
      setNextDeck("A");
    }

    setQueue(remainingQueue);
  }


  return (
    <div className="app">
      <div className="sync-waves">
        <SyncWavePanel deck="A" track={deckATrack} time={deckATime.time} duration={deckATime.duration} onSeek={setDeckASeekTo} />
        <SyncWavePanel deck="B" track={deckBTrack} time={deckBTime.time} duration={deckBTime.duration} onSeek={setDeckBSeekTo} />
      </div>

  <SyncWaveCompare
    trackA={deckATrack}
    trackB={deckBTrack}
    timeA={deckATime.time}
    timeB={deckBTime.time}
    durationA={deckATime.duration}
    durationB={deckBTime.duration}
  />

      <div className="top">
        <Deck
          title="Deck A"
          track={deckATrack}
          isActive={activeDeck === "A"}
          onActivate={() => setActiveDeck("A")}
          onPlay={() => { }}
          syncMasterBpm={activeDeck === "B" ? (deckBTrack?.analysis?.detectedBpm ?? deckBTrack?.bpm) || null : null}
          syncMasterTrack={activeDeck === "B" ? deckBTrack : undefined}
          syncMasterTime={activeDeck === "B" ? deckBTime.time : 0}
          onTimeUpdateGlobal={(time, duration) => setDeckATime({ time, duration })}
          seekToTime={deckASeekTo}
          volume={volumeA}
          onLoad={() => {
            if (selectedTrack) setDeckATrack(selectedTrack);
          }}
          onEject={() => setDeckATrack(undefined)}
        />

        <Crossfader
          onActiveDeckChange={setActiveDeck}
          onChange={setCrossfader}
          bpmA={deckATrack?.bpm}
          bpmB={deckBTrack?.bpm}
        />

        <div style={{ display: "none" }} aria-hidden="true">
          Volume A: {volumeA.toFixed(2)} | Volume B: {volumeB.toFixed(2)}
        </div>

        <Deck
          title="Deck B"
          track={deckBTrack}
          isActive={activeDeck === "B"}
          onActivate={() => setActiveDeck("B")}
          onPlay={() => { }}
          syncMasterBpm={activeDeck === "A" ? (deckATrack?.analysis?.detectedBpm ?? deckATrack?.bpm) || null : null}
          syncMasterTrack={activeDeck === "A" ? deckATrack : undefined}
          syncMasterTime={activeDeck === "A" ? deckATime.time : 0}
          onTimeUpdateGlobal={(time, duration) => setDeckBTime({ time, duration })}
          seekToTime={deckBSeekTo}
          volume={volumeB}
          onLoad={() => {
            if (selectedTrack) setDeckBTrack(selectedTrack);
          }}
          onEject={() => setDeckBTrack(undefined)}
        />
      </div>

      <div className="main-bottom">
        <TrackList
          onLoadA={addTrackToQueue}
          onTrackSelected={setSelectedTrack}
          onTrackUpdated={handleTrackUpdated}
          referenceTrack={automixReferenceTrack}
        />

        <div className="right-panel">
          <div className="transition-score-box">
            {queue.length >= 2 && automixTransitionScore ? (
              <>
                <strong>Automix: {queue[0].title} → {queue[1].title}</strong>
                <span>
                  {automixTransitionScore.label} ({automixTransitionScore.score})
                </span>
                <small>{automixTransitionScore.reasons[0]}</small>
              </>
            ) : queue.length === 1 ? (
              <>
                <strong>Automix-Start</strong>
                <span>{queue[0].title}</span>
                <small>Füge weitere Songs hinzu, dann bewertet TK-DJ den nächsten Übergang.</small>
              </>
            ) : deckTransitionScore ? (
              <>
                <strong>Übergang A → B</strong>
                <span>
                  {deckTransitionScore.label} ({deckTransitionScore.score})
                </span>
                <small>{deckTransitionScore.reasons[0]}</small>
              </>
            ) : (
              <>
                <strong>Übergang</strong>
                <span>Automix oder 2 Decks laden</span>
                <small>Dann berechnet TK-DJ den ersten Mix-Score.</small>
              </>
            )}
          </div>

          <div className="queue-actions">
            <button
              className="automix-button"
              onClick={autoLoadFreeDeck}
              disabled={queue.length === 0 || (!!deckATrack && !!deckBTrack)}
            >
              Automix
            </button>

            <button className="automix-clear-button" onClick={clearQueue} disabled={queue.length === 0}>
              Automix leeren
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
