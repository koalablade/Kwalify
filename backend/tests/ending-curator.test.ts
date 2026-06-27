import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { curatePlaylistEnding } from "../core/editorial/ending-curator";

const tracks = [
  ...Array.from({ length: 14 }, (_, i) => ({
    trackId: `mid${i}`,
    artistName: `Artist ${i}`,
    energy: 0.55 + i * 0.01,
    popularity: 50,
    danceability: 0.55,
    acousticness: 0.35,
    rediscoveryScore: 0.3,
  })),
  { trackId: "hot1", artistName: "Closer A", energy: 0.78, popularity: 85, danceability: 0.7, acousticness: 0.2, rediscoveryScore: 0.1 },
  { trackId: "hot2", artistName: "Closer B", energy: 0.74, popularity: 80, danceability: 0.68, acousticness: 0.22, rediscoveryScore: 0.15 },
  { trackId: "disc1", artistName: "Deep Cut", energy: 0.42, popularity: 18, danceability: 0.48, acousticness: 0.45, rediscoveryScore: 0.82 },
  { trackId: "disc2", artistName: "Hidden Gem", energy: 0.38, popularity: 12, danceability: 0.46, acousticness: 0.5, rediscoveryScore: 0.88 },
  { trackId: "cool1", artistName: "Cooldown", energy: 0.34, popularity: 40, danceability: 0.42, acousticness: 0.55, rediscoveryScore: 0.55 },
  { trackId: "cool2", artistName: "Landing", energy: 0.30, popularity: 35, danceability: 0.4, acousticness: 0.58, rediscoveryScore: 0.6 },
];

describe("ending curator", () => {
  it("preserves track count and improves or preserves ending shape", () => {
    const result = curatePlaylistEnding(tracks, 6);
    assert.equal(result.tracks.length, tracks.length);
    assert.ok(result.scoreAfter >= result.scoreBefore - 0.02);
    const tail = result.tracks.slice(-3);
    const avgEnergy = tail.reduce((sum, t) => sum + (t.energy ?? 0.5), 0) / tail.length;
    assert.ok(avgEnergy <= 0.72);
  });
});
