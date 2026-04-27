import { calculateTransitionScore } from "./transitionScore";

const trackA = {
  title: "Song A",
  bpm: 120,
  key: "8A",
  energy: 60,
  genre: "pop",
};

const trackB = {
  title: "Song B",
  bpm: 122,
  key: "9A",
  energy: 70,
  genre: "pop",
};

const trackC = {
  title: "Song C",
  bpm: 140,
  key: "2B",
  energy: 90,
  genre: "rock",
};

function test(from: any, to: any) {
  const result = calculateTransitionScore(from, to);

  console.log("--------------------------------------------------");
  console.log(`${from.title} → ${to.title}`);
  console.log("Score:", result.score, result.label);
  console.log("Details:", result.details);
  console.log("Reasons:");
  result.reasons.forEach((r) => console.log(" -", r));
}

test(trackA, trackB); // sollte gut sein
test(trackA, trackC); // sollte schlecht sein
