from pathlib import Path

p = Path("src/App.tsx")
t = p.read_text()

# Sicherstellen dass main layout korrekt ist
start = t.find("return (")
end = t.rfind(");")

new_layout = '''return (
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

      <Deck
        title="Deck B"
        track={deckBTrack}
        isActive={activeDeck === "B"}
        onActivate={() => setActiveDeck("B")}
        onPlay={() => prepareNextForDeck("B")}
        volume={volumeB}
      />
    </div>

    <div className="main-bottom">
      <TrackList
        onLoadA={smartLoadTrack}
        onTrackUpdated={handleTrackUpdated}
      />

      <div className="right-panel">
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
);'''

t = t[:start] + new_layout + t[end+2:]

p.write_text(t)
