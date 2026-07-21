import assert from "node:assert/strict";
import test from "node:test";
import { enrichTrackSemanticProfile } from "../lib/track-semantic-enrichment";
import {
  buildPromptSceneProfile,
  scoreSemanticSceneMatch,
} from "../lib/scene-semantic-retrieval";

test("title-only bait words do not invent bedroom/city scene tags", () => {
  const profile = enrichTrackSemanticProfile({
    trackId: "t1",
    trackName: "Bedroom",
    artistName: "Some Rock Band",
    albumName: "Arena Nights",
    energy: 0.7,
    valence: 0.5,
    spotifyArtistGenres: ["alternative rock", "hard rock"],
  });
  assert.equal(profile.scene.places.includes("bedroom"), false);
});

test("title bait does not award semantic boost for bare Slow/Ruin/Goth", () => {
  const prompt = buildPromptSceneProfile("slow goth bedroom night");
  for (const name of ["Slow", "Ruin", "Goth", "Bedroom"]) {
    const track = enrichTrackSemanticProfile({
      trackId: name,
      trackName: name,
      artistName: "Unrelated Pop Act",
      albumName: "Hits",
      energy: 0.55,
      valence: 0.55,
      spotifyArtistGenres: ["dance pop"],
    });
    const { boost } = scoreSemanticSceneMatch(prompt, track, {
      trackName: name,
      artistName: "Unrelated Pop Act",
      maxBoost: 0.28,
    });
    assert.ok(boost < 0.15, `${name} title bait boost too high: ${boost}`);
  }
});

test("title highway/rain alone do not invent drive or weather tags", () => {
  const highway = enrichTrackSemanticProfile({
    trackId: "h1",
    trackName: "Highwayman",
    artistName: "The Highwaymen",
    albumName: "Highwayman",
    energy: 0.6,
    valence: 0.4,
    spotifyArtistGenres: ["country", "outlaw country"],
  });
  assert.equal(highway.scene.places.includes("motorway"), false);
  assert.equal(highway.scene.activities.includes("driving"), false);

  const rainy = enrichTrackSemanticProfile({
    trackId: "r1",
    trackName: "Rainy Dayz",
    artistName: "Raekwon",
    albumName: "Only Built 4 Cuban Linx",
    energy: 0.54,
    valence: 0.4,
    spotifyArtistGenres: ["east coast hip hop", "rap"],
  });
  assert.equal(rainy.scene.weather.includes("rain"), false);
});
