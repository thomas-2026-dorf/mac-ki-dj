import { useEffect, useState } from "react";
import "./App.css";
import "./layout.css";

import Deck from "./components/Deck";
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

  // Automix Referenz (wichtig für spätere Bewertung)
  const automixReferenceTrack = queue.length > 0 ? queue[0] : null;

  const transitionScore =
    deckATrack && deckBTrack
      ? calculateTransitionScore(deckATrack, deckBTrack)
      : null;

  useEffect(() => {
    localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
  }, [queue]);

  function updateTrackGridStart(track: Track, seconds: number): Track {
    return {
      ...track,
      analysis: {
        ...(track.analysis || {
          status: "none" as const,
          cuePoints: [],
          loops: [],
        }),
        beatGridStartSeconds: seconds,
        cuePoints: track.analysis?.cuePoints || [],
        loops: track.analysis?.loops || [],
      },
    };
  }

  function handleSetGridStart(deck: "A" | "B", seconds: number) {
    if (deck === "A") {
      setDeckATrack((current) =>
        current ? updateTrackGridStart(current, seconds) : current,
      );
    }

    if (deck === "B") {
      setDeckBTrack((current) =>
        current ? updateTrackGridStart(current, seconds) : current,
      );
    }
  }

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
      <div className="top">
        <Deck
          title="Deck A"
          track={deckATrack}
          isActive={activeDeck === "A"}
          onActivate={() => setActiveDeck("A")}
          onPlay={() => { }}
          onSetGridStart={(seconds) => handleSetGridStart("A", seconds)}
          volume={volumeA}
          onLoad={() => {
            if (selectedTrack) setDeckATrack(selectedTrack);
          }}
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
          onPlay={() => { }}
          onSetGridStart={(seconds) => handleSetGridStart("B", seconds)}
          volume={volumeB}
          onLoad={() => {
            if (selectedTrack) setDeckBTrack(selectedTrack);
          }}
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
            <strong>Übergang A → B</strong>
            {transitionScore ? (
              <>
                <span>
                  {transitionScore.label} ({transitionScore.score})
                </span>
                <small>{transitionScore.reasons[0]}</small>
              </>
            ) : (
              <>
                <span>2 Songs laden</span>
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
