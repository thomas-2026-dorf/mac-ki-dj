import { useEffect, useState } from "react";
import "./App.css";

import Deck from "./components/Deck";
import Crossfader from "./components/Crossfader";
import TrackList from "./components/TrackList";
import AiPanel from "./components/AiPanel";
import QueuePanel from "./components/QueuePanel";

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
  const [nextDeck, setNextDeck] = useState<"A" | "B">("A");
  const [activeDeck, setActiveDeck] = useState<"A" | "B">("A");
  const [crossfader, setCrossfader] = useState(0.5);
  const volumeA = 1 - crossfader;
  const volumeB = crossfader;

  useEffect(() => {
    localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
  }, [queue]);

  function addToQueue(track: Track) {
    setQueue((prev) => [...prev, track]);
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

  function loadNextTrack() {
    if (queue.length === 0) return;

    const [nextTrack, ...remainingQueue] = queue;

    if (nextDeck === "A") {
      setDeckATrack(nextTrack);
      setNextDeck("B");
    } else {
      setDeckBTrack(nextTrack);
      setNextDeck("A");
    }

    setQueue(remainingQueue);
  }

  function autoLoadFreeDeck() {
    if (queue.length === 0) return;
    if (deckATrack && deckBTrack) return;

    const [nextTrack, ...remainingQueue] = queue;

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

  function prepareNextForDeck(playingDeck: "A" | "B") {
    if (queue.length === 0) return;

    const [nextTrack, ...remainingQueue] = queue;

    if (playingDeck === "A" && !deckBTrack) {
      setDeckBTrack(nextTrack);
      setNextDeck("A");
      setQueue(remainingQueue);
    }

    if (playingDeck === "B" && !deckATrack) {
      setDeckATrack(nextTrack);
      setNextDeck("B");
      setQueue(remainingQueue);
    }
  }

  return (
    <div className="app">
      <div className="top">
        <Deck
          title="Deck A"
          track={deckATrack}
          isActive={activeDeck === "A"}
          onActivate={() => setActiveDeck("A")}
          onPlay={() => prepareNextForDeck("A")}
          volume={volumeA}
        />

        <Crossfader
          onActiveDeckChange={setActiveDeck}
          onChange={setCrossfader}
        />

        <div style={{ display: "none" }} aria-hidden="true">
          Volume A: {volumeA.toFixed(2)} | Volume B: {volumeB.toFixed(2)}
        </div>

        <Deck
          title="Deck B"
          track={deckBTrack}
          isActive={activeDeck === "B"}
          onActivate={() => setActiveDeck("B")}
          onPlay={() => prepareNextForDeck("B")}
          volume={volumeB}
        />
      </div>

      <div className="bottom">
        <TrackList
          onLoadA={setDeckATrack}
          onLoadB={setDeckBTrack}
          onAddToQueue={addToQueue}
        />

        <div className="right-panel">
          <div className="queue-actions">
            <button onClick={loadNextTrack} disabled={queue.length === 0}>
              Next → Deck {nextDeck}
            </button>

            <button
              onClick={autoLoadFreeDeck}
              disabled={queue.length === 0 || (!!deckATrack && !!deckBTrack)}
            >
              Auto Load frei
            </button>

            <button onClick={clearQueue} disabled={queue.length === 0}>
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