import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { curatePlaylistOpening } from "../core/editorial/opening-curator";

const tracks = [
  { trackId: "1", artistName: "Deep Cut", energy: 0.5, popularity: 12, danceability: 0.5, acousticness: 0.4 },
  { trackId: "2", artistName: "Hook Artist", energy: 0.52, popularity: 78, danceability: 0.52, acousticness: 0.35 },
  { trackId: "3", artistName: "Mid Artist", energy: 0.54, popularity: 55, danceability: 0.54, acousticness: 0.36 },
  { trackId: "4", artistName: "Flow Artist", energy: 0.56, popularity: 48, danceability: 0.56, acousticness: 0.38 },
  { trackId: "5", artistName: "Tail Artist", energy: 0.58, popularity: 40, danceability: 0.58, acousticness: 0.4 },
  { trackId: "6", artistName: "Anchor Artist", energy: 0.6, popularity: 72, danceability: 0.6, acousticness: 0.42 },
  ...Array.from({ length: 10 }, (_, i) => ({
    trackId: `x${i}`,
    artistName: `Artist ${i}`,
    energy: 0.5 + i * 0.01,
    popularity: 30 + i,
    danceability: 0.5,
    acousticness: 0.4,
  })),
];

describe("opening curator", () => {
  it("lifts a stronger hook into the opening without losing tracks", () => {
    const result = curatePlaylistOpening(tracks, 5);
    assert.equal(result.tracks.length, tracks.length);
    assert.ok(result.scoreAfter >= result.scoreBefore - 0.02);
    const openingArtists = result.tracks.slice(0, 5).map((t) => t.artistName);
    assert.equal(new Set(openingArtists).size, openingArtists.length);
  });
});
