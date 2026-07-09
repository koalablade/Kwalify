import assert from "node:assert/strict";
import test from "node:test";
import { classifyTrack } from "../lib/genre-taxonomy";

test("acoustic title bridge routes unplugged rock tracks to folk/singer_songwriter", () => {
  const cases = [
    { trackName: "Everlong - Acoustic Version", artistName: "Foo Fighters" },
    { trackName: "Duvet - Acoustic", artistName: "bôa" },
    { trackName: "Black - Unplugged", artistName: "Pearl Jam" },
  ];

  for (const row of cases) {
    const classification = classifyTrack({
      trackName: row.trackName,
      artistName: row.artistName,
      albumName: "Live Sessions",
      spotifyArtistGenres: [],
      albumGenres: [],
      energy: 0.42,
      valence: 0.48,
      acousticness: 0.82,
      danceability: 0.35,
    });
    assert.equal(
      classification.genreFamily,
      "folk",
      `${row.trackName} should classify as folk, got ${classification.genreFamily}`,
    );
    assert.equal(
      classification.primarySubgenre,
      "singer_songwriter",
      `${row.trackName} expected singer_songwriter, got ${classification.primarySubgenre}`,
    );
  }
});

test("explicit country acoustic titles are not rerouted by acoustic bridge", () => {
  const classification = classifyTrack({
    trackName: "Honky Tonk Acoustic Session",
    artistName: "Sample Artist",
    albumName: "Country Nights",
    spotifyArtistGenres: ["country"],
    albumGenres: [],
    energy: 0.5,
    valence: 0.62,
    acousticness: 0.75,
    danceability: 0.5,
  });
  assert.equal(classification.genreFamily, "country");
  assert.notEqual(classification.diagnostics?.patternMatched, "acoustic title bridge");
});
