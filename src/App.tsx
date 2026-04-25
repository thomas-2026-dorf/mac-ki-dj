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

  return (
    <div className="app">
      <div className="top">
        <Deck
          title="Deck A"
          track={deckATrack}
          isActive={activeDeck === "A"}
          onActivate={() => setActiveDeck("A")}
        />

        <Crossfader />

        <Deck
          title="Deck B"
          track={deckBTrack}
          isActive={activeDeck === "B"}
          onActivate={() => setActiveDeck("B")}
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