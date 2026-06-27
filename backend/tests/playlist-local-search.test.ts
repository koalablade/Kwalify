import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { improvePlaylistByLocalSearch, humanPlausibilityScore } from "../core/editorial/playlist-local-search";

const baseTracks = [
  { trackId: "1", artistName: "Artist A", energy: 0.5, valence: 0.55, popularity: 70, danceability: 0.5, acousticness: 0.3 },
  { trackId: "2", artistName: "Artist B", energy: 0.52, valence: 0.56, popularity: 65, danceability: 0.52, acousticness: 0.32 },
  { trackId: "3", artistName: "Artist C", energy: 0.54, valence: 0.57, popularity: 60, danceability: 0.54, acousticness: 0.34 },
  { trackId: "4", artistName: "Artist D", energy: 0.56, valence: 0.58, popularity: 55, danceability: 0.56, acousticness: 0.36 },
  { trackId: "5", artistName: "Artist E", energy: 0.58, valence: 0.59, popularity: 50, danceability: 0.58, acousticness: 0.38 },
  { trackId: "6", artistName: "Artist F", energy: 0.6, valence: 0.6, popularity: 45, danceability: 0.6, acousticness: 0.4 },
  { trackId: "7", artistName: "Artist G", energy: 0.62, valence: 0.61, popularity: 40, danceability: 0.62, acousticness: 0.42 },
  { trackId: "8", artistName: "Artist H", energy: 0.64, valence: 0.62, popularity: 35, danceability: 0.64, acousticness: 0.44 },
  { trackId: "9", artistName: "Artist I", energy: 0.66, valence: 0.63, popularity: 30, danceability: 0.66, acousticness: 0.46 },
  { trackId: "10", artistName: "Artist J", energy: 0.68, valence: 0.64, popularity: 25, danceability: 0.68, acousticness: 0.48 },
  { trackId: "11", artistName: "Artist K", energy: 0.7, valence: 0.65, popularity: 20, danceability: 0.7, acousticness: 0.5 },
  { trackId: "12", artistName: "Artist L", energy: 0.72, valence: 0.66, popularity: 18, danceability: 0.72, acousticness: 0.52 },
];

describe("playlist local search", () => {
  it("improves or preserves human plausibility vs adjacent artist clash", () => {
    const badOrder = [
      baseTracks[0]!,
      { ...baseTracks[0]!, trackId: "1b" },
      ...baseTracks.slice(2),
    ];
    const pool = baseTracks.map((t) => ({ ...t, trackId: `alt_${t.trackId}`, popularity: (t.popularity ?? 50) - 10 }));
    const result = improvePlaylistByLocalSearch(badOrder, pool, { maxIterations: 24 });
    assert.ok(result.scoreAfter >= result.scoreBefore - 0.01);
  });

  it("human plausibility weights opening and ending", () => {
    const score = humanPlausibilityScore(baseTracks);
    assert.ok(score > 0.4 && score <= 1);
  });
});
