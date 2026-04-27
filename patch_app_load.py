from pathlib import Path

p = Path("src/App.tsx")
t = p.read_text()

# Deck A
t = t.replace(
"volume={volumeA}",
"""volume={volumeA}
          onLoad={() => {
            if (selectedTrack) setDeckATrack(selectedTrack);
          }}"""
)

# Deck B
t = t.replace(
"volume={volumeB}",
"""volume={volumeB}
          onLoad={() => {
            if (selectedTrack) setDeckBTrack(selectedTrack);
          }}"""
)

p.write_text(t)
