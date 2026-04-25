import { useState } from "react";
import "./App.css";

import Deck from "./components/Deck";
import Crossfader from "./components/Crossfader";
import TrackList from "./components/TrackList";
import AiPanel from "./components/AiPanel";

import type { Track } from "./types/track";

function App() {
  const [deckATrack, setDeckATrack] = useState<Track | undefined>();

  return (
    <div className="app">
      <div className="top">
        <Deck title="Deck A" track={deckATrack} />
        <Crossfader />
        <Deck title="Deck B" />
      </div>

      <div className="bottom">
        <TrackList onSelect={setDeckATrack} />
        <AiPanel />
      </div>
    </div>
  );
}

export default App;