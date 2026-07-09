import assert from "node:assert/strict";
import test from "node:test";
import { classifyTrack } from "../lib/genre-taxonomy";

test("disco/funk/soul artist hints classify as soul when Spotify genres are empty", () => {
  const cases = [
    { artistName: "Donna Summer", expectSub: "disco" },
    { artistName: "ABBA", expectSub: "disco" },
    { artistName: "Funkadelic", expectSub: "funk" },
    { artistName: "Stevie Wonder", expectSub: "motown" },
    { artistName: "Aretha Franklin", expectSub: "motown" },
    { artistName: "Michael Jackson", expectSub: "disco" },
  ];

  for (const row of cases) {
    const classification = classifyTrack({
      trackName: "Sample Track",
      artistName: row.artistName,
      albumName: "Sample Album",
      spotifyArtistGenres: [],
      albumGenres: [],
      energy: 0.7,
      valence: 0.8,
      danceability: 0.8,
      acousticness: 0.1,
    });
    assert.equal(
      classification.genreFamily,
      "soul",
      `${row.artistName} should classify as soul, got ${classification.genreFamily}`,
    );
    assert.equal(
      classification.primarySubgenre,
      row.expectSub,
      `${row.artistName} primarySubgenre expected ${row.expectSub}, got ${classification.primarySubgenre}`,
    );
    assert.equal(classification.diagnostics?.audioFallbackUsed, false);
  }
});

test("Spotify disco genre metadata maps to soul root", () => {
  const classification = classifyTrack({
    trackName: "Unknown Track",
    artistName: "Unknown Artist",
    albumName: "Unknown Album",
    spotifyArtistGenres: ["disco"],
    albumGenres: [],
  });
  assert.equal(classification.genreFamily, "soul");
});
