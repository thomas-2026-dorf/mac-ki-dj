import {
  calculateTransitionScore,
  type TransitionScoreResult,
  type TransitionTrackInfo,
} from "./transitionScore";

export type EnergyDirection = "keep" | "build" | "peak" | "cooldown";

export type TransitionPlanOptions = {
  preferredGenre?: string | null;
  blockSize?: number;
  energyDirection?: EnergyDirection;
  maxResults?: number;
};

export type TransitionPlanCandidate = {
  track: TransitionTrackInfo;
  transition: TransitionScoreResult;
  genreBlockScore: number;
  energyPlanScore: number;
  chainPotentialScore: number;
  totalScore: number;
  reasons: string[];
};

function normalizeGenre(genre?: string | null): string {
  return (genre || "").trim().toLowerCase();
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreGenreBlock(
  track: TransitionTrackInfo,
  preferredGenre?: string | null,
): { score: number; reason: string } {
  const trackGenre = normalizeGenre(track.genre);
  const wantedGenre = normalizeGenre(preferredGenre);

  if (!wantedGenre) {
    return { score: 70, reason: "Kein Ziel-Genre gesetzt." };
  }

  if (!trackGenre) {
    return { score: 45, reason: "Genre fehlt beim Kandidaten." };
  }

  if (trackGenre === wantedGenre) {
    return { score: 100, reason: `Passt in den Genre-Block (${track.genre}).` };
  }

  return {
    score: 35,
    reason: `Passt nicht ideal in den Genre-Block (${track.genre} statt ${preferredGenre}).`,
  };
}

function scoreEnergyPlan(
  currentTrack: TransitionTrackInfo,
  candidate: TransitionTrackInfo,
  direction: EnergyDirection,
): { score: number; reason: string } {
  if (currentTrack.energy == null || candidate.energy == null) {
    return { score: 50, reason: "Energy fehlt für die Set-Planung." };
  }

  const diff = candidate.energy - currentTrack.energy;

  if (direction === "keep") {
    if (Math.abs(diff) <= 10) {
      return { score: 100, reason: "Energy bleibt stabil." };
    }

    return { score: 55, reason: "Energy verändert sich stärker als geplant." };
  }

  if (direction === "build") {
    if (diff >= 5 && diff <= 18) {
      return { score: 100, reason: "Energy steigt kontrolliert." };
    }

    if (diff > 18 && diff <= 30) {
      return { score: 70, reason: "Energy steigt stark." };
    }

    if (diff >= -5 && diff < 5) {
      return { score: 65, reason: "Energy bleibt fast gleich." };
    }

    return { score: 35, reason: "Energy passt nicht zur geplanten Steigerung." };
  }

  if (direction === "peak") {
    if (candidate.energy >= 80) {
      return { score: 100, reason: "Kandidat passt zur Peak-Zeit." };
    }

    if (candidate.energy >= 65) {
      return { score: 70, reason: "Kandidat ist brauchbar für den Aufbau zur Peak-Zeit." };
    }

    return { score: 35, reason: "Kandidat ist für Peak-Zeit zu ruhig." };
  }

  if (direction === "cooldown") {
    if (diff <= -5 && diff >= -25) {
      return { score: 100, reason: "Energy fällt kontrolliert ab." };
    }

    if (diff > -5 && diff <= 5) {
      return { score: 70, reason: "Energy bleibt ruhig stabil." };
    }

    return { score: 35, reason: "Energy passt nicht zum Runterfahren." };
  }

  return { score: 50, reason: "Energy-Richtung unbekannt." };
}

function scoreChainPotential(
  candidate: TransitionTrackInfo,
  allTracks: TransitionTrackInfo[],
): { score: number; reason: string } {
  const otherTracks = allTracks.filter((track) => track !== candidate);

  if (otherTracks.length === 0) {
    return { score: 50, reason: "Keine weiteren Songs für Anschlussbewertung vorhanden." };
  }

  const scores = otherTracks
    .map((track) => calculateTransitionScore(candidate, track).score)
    .sort((a, b) => b - a);

  const bestScores = scores.slice(0, 3);
  const average =
    bestScores.reduce((sum, score) => sum + score, 0) / bestScores.length;

  return {
    score: clampScore(average),
    reason: `Anschlussfähigkeit zu den nächsten Songs: ${clampScore(average)}.`,
  };
}

export function planNextTransitions(
  currentTrack: TransitionTrackInfo,
  candidateTracks: TransitionTrackInfo[],
  options: TransitionPlanOptions = {},
): TransitionPlanCandidate[] {
  const {
    preferredGenre = null,
    energyDirection = "build",
    maxResults = 10,
  } = options;

  return candidateTracks
    .map((track) => {
      const transition = calculateTransitionScore(currentTrack, track);
      const genreBlock = scoreGenreBlock(track, preferredGenre);
      const energyPlan = scoreEnergyPlan(currentTrack, track, energyDirection);
      const chainPotential = scoreChainPotential(track, candidateTracks);

      const totalScore = clampScore(
        transition.score * 0.45 +
          genreBlock.score * 0.2 +
          energyPlan.score * 0.2 +
          chainPotential.score * 0.15,
      );

      return {
        track,
        transition,
        genreBlockScore: genreBlock.score,
        energyPlanScore: energyPlan.score,
        chainPotentialScore: chainPotential.score,
        totalScore,
        reasons: [
          `Direkter Übergang: ${transition.score}.`,
          genreBlock.reason,
          energyPlan.reason,
          chainPotential.reason,
        ],
      };
    })
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, maxResults);
}
