import { planNextTransitions } from "./transitionPlanner";

const currentTrack = {
  title: "Song A",
  bpm: 120,
  key: "8A",
  energy: 60,
  genre: "schlager",
};

const tracks = [
  { title: "Song B", bpm: 122, key: "9A", energy: 68, genre: "schlager" },
  { title: "Song C", bpm: 124, key: "8A", energy: 72, genre: "schlager" },
  { title: "Song D", bpm: 128, key: "9B", energy: 80, genre: "pop" },
  { title: "Song E", bpm: 140, key: "2B", energy: 90, genre: "rock" },
];

const result = planNextTransitions(currentTrack, tracks, {
  preferredGenre: "schlager",
  energyDirection: "build",
});

console.log("===== PLAN =====");

result.forEach((r, i) => {
  console.log(
    `${i + 1}. ${r.track.title} → Score ${r.totalScore}`
  );
  r.reasons.forEach((reason) => console.log("  -", reason));
});
