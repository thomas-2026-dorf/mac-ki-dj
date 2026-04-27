from pathlib import Path

p = Path("src/components/Deck.tsx")
t = p.read_text()

# 1. Props erweitern
t = t.replace(
"volume: number;",
"volume: number;\n    onLoad?: () => void;"
)

# 2. Props destructuring erweitern
t = t.replace(
"volume,",
"volume,\n    onLoad,"
)

# 3. Button einbauen (vor Play)
t = t.replace(
'''<div className="deck-controls">''',
'''<div className="deck-controls">
                <button
                    className="load-btn"
                    onClick={() => onLoad && onLoad()}
                >
                    Load
                </button>'''
)

p.write_text(t)
