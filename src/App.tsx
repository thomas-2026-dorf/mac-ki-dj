import "./App.css";

import Deck from "./components/Deck";
import Crossfader from "./components/Crossfader";
import TrackList from "./components/TrackList";
import AiPanel from "./components/AiPanel";

function App() {
  return (
    <div className="app">
      <div className="top">
        <Deck title="Deck A" />
        <Crossfader />
        <Deck title="Deck B" />
      </div>

      <div className="bottom">
        <TrackList />
        <AiPanel />
      </div>
    </div>
  );
}

export default App;