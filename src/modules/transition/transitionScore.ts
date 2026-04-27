export type CamelotKey = string | null | undefined;

export type TransitionTrackInfo = {
  title?: string;
  bpm?: number | null;
  key?: CamelotKey;
  energy?: number | null;
  genre?: string | null;
};

export type TransitionRating = "good" | "possible" | "bad";

export type TransitionScoreResult = {
  score: number;
  rating: TransitionRating;
  label: "✅ Gut" | "⚠️ Möglich" | "❌ Schlecht";
  reasons: string[];
  details: {
    bpmScore: number;
    keyScore: number;
    energyScore: number;
    genreScore: number;
  };
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeGenre(genre?: string | null): string {
  return (genre || "").trim().toLowerCase();
}

function parseCamelotKey(key: CamelotKey): { number: number; letter: "A" | "B" } | null {
  if (!key) return null;

  const normalized = key.trim().toUpperCase();
  const match = normalized.match(/^([1-9]|1[0-2])([AB])$/);

  if (!match) return null;

  return {
    number: Number(match[1]),
    letter: match[2] as "A" | "B",
  };
}

function camelotDistance(a: number, b: number): number {
  const direct = Math.abs(a - b);
  return Math.min(direct, 12 - direct);
}

function scoreBpm(from: TransitionTrackInfo, to: TransitionTrackInfo): { score: number; reason: string } {
  if (!from.bpm || !to.bpm) {
    return { score: 50, reason: "BPM fehlt bei einem Song." };
  }

  const diff = Math.abs(from.bpm - to.bpm);
  const percentDiff = diff / from.bpm;

  if (percentDiff <= 0.03) {
    return { score: 100, reason: `BPM passt sehr gut (${from.bpm} → ${to.bpm}).` };
  }

  if (percentDiff <= 0.06) {
    return { score: 75, reason: `BPM ist noch gut mischbar (${from.bpm} → ${to.bpm}).` };
  }

  if (percentDiff <= 0.1) {
    return { score: 45, reason: `BPM-Sprung ist deutlich (${from.bpm} → ${to.bpm}).` };
  }

  return { score: 15, reason: `BPM-Sprung ist sehr groß (${from.bpm} → ${to.bpm}).` };
}

function scoreKey(from: TransitionTrackInfo, to: TransitionTrackInfo): { score: number; reason: string } {
  const fromKey = parseCamelotKey(from.key);
  const toKey = parseCamelotKey(to.key);

  if (!fromKey || !toKey) {
    return { score: 50, reason: "Key fehlt oder ist nicht im Camelot-Format." };
  }

  const distance = camelotDistance(fromKey.number, toKey.number);
  const sameLetter = fromKey.letter === toKey.letter;

  if (fromKey.number === toKey.number && sameLetter) {
    return { score: 100, reason: `Key ist identisch (${from.key} → ${to.key}).` };
  }

  if (distance === 1 && sameLetter) {
    return { score: 95, reason: `Key ist harmonisch benachbart (${from.key} → ${to.key}).` };
  }

  if (fromKey.number === toKey.number && !sameLetter) {
    return { score: 90, reason: `Key passt über Dur/Moll-Wechsel (${from.key} → ${to.key}).` };
  }

  if (distance === 1 && !sameLetter) {
    return { score: 65, reason: `Key ist noch möglich, aber nicht ideal (${from.key} → ${to.key}).` };
  }

  return { score: 20, reason: `Key passt harmonisch schlecht (${from.key} → ${to.key}).` };
}

function scoreEnergy(from: TransitionTrackInfo, to: TransitionTrackInfo): { score: number; reason: string } {
  if (from.energy == null || to.energy == null) {
    return { score: 50, reason: "Energy fehlt bei einem Song." };
  }

  const diff = to.energy - from.energy;

  if (diff >= -10 && diff <= 15) {
    return { score: 100, reason: `Energy-Verlauf ist natürlich (${from.energy} → ${to.energy}).` };
  }

  if (diff > 15 && diff <= 30) {
    return { score: 75, reason: `Energy steigt deutlich, aber noch brauchbar (${from.energy} → ${to.energy}).` };
  }

  if (diff < -10 && diff >= -25) {
    return { score: 60, reason: `Energy fällt spürbar ab (${from.energy} → ${to.energy}).` };
  }

  return { score: 30, reason: `Energy-Sprung ist stark (${from.energy} → ${to.energy}).` };
}

function scoreGenre(from: TransitionTrackInfo, to: TransitionTrackInfo): { score: number; reason: string } {
  const fromGenre = normalizeGenre(from.genre);
  const toGenre = normalizeGenre(to.genre);

  if (!fromGenre || !toGenre) {
    return { score: 50, reason: "Genre fehlt bei einem Song." };
  }

  if (fromGenre === toGenre) {
    return { score: 100, reason: `Genre passt exakt (${from.genre} → ${to.genre}).` };
  }

  const compatibleGroups = [
    ["schlager", "party", "deutschpop"],
    ["pop", "dance", "party"],
    ["rock", "classic rock", "70er", "80er"],
    ["80er", "pop", "party"],
    ["70er", "rock", "disco"],
  ];

  const compatible = compatibleGroups.some(
    (group) => group.includes(fromGenre) && group.includes(toGenre)
  );

  if (compatible) {
    return { score: 75, reason: `Genre ist verwandt (${from.genre} → ${to.genre}).` };
  }

  return { score: 35, reason: `Genre-Wechsel ist deutlich (${from.genre} → ${to.genre}).` };
}

export function calculateTransitionScore(
  from: TransitionTrackInfo,
  to: TransitionTrackInfo
): TransitionScoreResult {
  const bpm = scoreBpm(from, to);
  const key = scoreKey(from, to);
  const energy = scoreEnergy(from, to);
  const genre = scoreGenre(from, to);

  const score = clampScore(
    bpm.score * 0.35 +
      key.score * 0.3 +
      energy.score * 0.2 +
      genre.score * 0.15
  );

  const rating: TransitionRating =
    score >= 75 ? "good" : score >= 50 ? "possible" : "bad";

  const label =
    rating === "good" ? "✅ Gut" : rating === "possible" ? "⚠️ Möglich" : "❌ Schlecht";

  return {
    score,
    rating,
    label,
    reasons: [bpm.reason, key.reason, energy.reason, genre.reason],
    details: {
      bpmScore: bpm.score,
      keyScore: key.score,
      energyScore: energy.score,
      genreScore: genre.score,
    },
  };
}
