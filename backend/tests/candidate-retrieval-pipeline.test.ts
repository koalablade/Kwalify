import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPromptRetrievalProfile,
  retrieveScoringCandidates,
} from "../lib/candidate-retrieval-pipeline";

const classMap = new Map<string, {
  genrePrimary: string;
  genreFamily: string;
  primarySubgenre: string;
  secondarySubgenre: string | null;
  subGenres: string[];
}>();

function track(
  id: string,
  artist: string,
  name: string,
  energy: number,
  overrides: Partial<{
    valence: number;
    danceability: number;
    tempo: number;
    popularity: number;
    speechiness: number;
    instrumentalness: number;
    spotifyArtistGenres: string[];
  }> = {},
) {
  const family = overrides.spotifyArtistGenres?.[0]?.includes("garage")
    ? "electronic"
    : energy >= 0.75
      ? "pop"
      : "indie";
  classMap.set(id, {
    genrePrimary: family,
    genreFamily: family,
    primarySubgenre: overrides.spotifyArtistGenres?.[0] ?? family,
    secondarySubgenre: null,
    subGenres: overrides.spotifyArtistGenres ?? [family],
  });
  return {
    trackId: id,
    trackName: name,
    artistName: artist,
    albumName: "album",
    energy,
    valence: overrides.valence ?? 0.5,
    danceability: overrides.danceability ?? 0.55,
    tempo: overrides.tempo ?? 120,
    popularity: overrides.popularity ?? 50,
    speechiness: overrides.speechiness ?? 0.08,
    instrumentalness: overrides.instrumentalness ?? 0.2,
    spotifyArtistGenres: overrides.spotifyArtistGenres ?? [family],
  };
}

const library = [
  track("ukg1", "Conducta", "Whippet", 0.72, { spotifyArtistGenres: ["uk garage"], danceability: 0.78 }),
  track("ukg2", "MJ Cole", "Garage Track", 0.68, { spotifyArtistGenres: ["uk garage", "2-step"] }),
  track("amb1", "Aphex Twin", "Avril 14th", 0.28, { spotifyArtistGenres: ["ambient", "idm"], instrumentalness: 0.7, speechiness: 0.04 }),
  track("amb2", "Moby", "Porcelain", 0.32, { spotifyArtistGenres: ["downtempo", "ambient"], speechiness: 0.05 }),
  track("pop1", "Usher", "Yeah!", 0.85, { spotifyArtistGenres: ["pop"], popularity: 82, danceability: 0.82 }),
  track("pop2", "Mark Ronson", "Uptown Funk", 0.82, { spotifyArtistGenres: ["pop", "funk"], popularity: 80, danceability: 0.85 }),
  track("gym1", "Eminem", "Lose Yourself", 0.85, { spotifyArtistGenres: ["hip hop"], tempo: 172, danceability: 0.72 }),
  track("gym2", "Kanye West", "Stronger", 0.88, { spotifyArtistGenres: ["hip hop"], tempo: 130, danceability: 0.75 }),
  track("ind1", "Arctic Monkeys", "Do I Wanna Know?", 0.64, { spotifyArtistGenres: ["indie rock"] }),
  track("ind2", "Phoebe Bridgers", "Motion Sickness", 0.44, { spotifyArtistGenres: ["indie pop"] }),
];

test("buildPromptRetrievalProfile detects high-confidence focus coding", () => {
  const profile = buildPromptRetrievalProfile(
    "deep focus coding session late evening electronic ambient",
    { activity: "focus", mood: [], genreFamilies: [], primaryGenres: [] },
    { energy: 0.3, valence: 0.45, tension: 0.2, nostalgia: 0.2, calm: 0.6, environment: null, timeOfDay: null, motionState: null },
    ["indie", "electronic"],
  );
  assert.equal(profile.activity, "focus_coding");
  assert.ok(profile.activityConfidence >= 0.85);
  assert.ok(profile.highConfidenceActivity);
  assert.ok(profile.libraryGravityWeight <= 0.15);
});

test("focus retrieval rejects UKG and front-loads ambient openers", () => {
  const result = retrieveScoringCandidates({
    tracks: library,
    vibe: "deep focus coding session late evening electronic ambient",
    intent: { activity: "focus", mood: [], genreFamilies: [], primaryGenres: [] },
    emotionProfile: { energy: 0.3, valence: 0.45, tension: 0.2, nostalgia: 0.2, calm: 0.6, environment: null, timeOfDay: null, motionState: null },
    classMap,
    requestedLength: 20,
    sceneActive: true,
    debugRetrieval: true,
  });
  const ids = result.tracks.map((t) => t.trackId);
  assert.equal(ids.includes("ukg1"), false);
  assert.equal(ids.includes("ukg2"), false);
  assert.ok(ids.indexOf("amb1") < 6 || ids.indexOf("amb2") < 6);
  const diag = result.diagnostics as { sourceDistribution?: { activity_match?: number } };
  assert.ok((diag.sourceDistribution?.activity_match ?? 0) > 0);
});

test("party pregame retrieval favours mainstream pop over indie", () => {
  const result = retrieveScoringCandidates({
    tracks: library,
    vibe: "pregame playlist before going out with friends tonight",
    intent: { activity: "party", mood: [], genreFamilies: [], primaryGenres: [] },
    emotionProfile: { energy: 0.82, valence: 0.72, tension: 0.2, nostalgia: 0.1, calm: 0.1, environment: null, timeOfDay: null, motionState: null },
    classMap,
    requestedLength: 20,
    sceneActive: true,
    debugRetrieval: true,
  });
  const opening = result.tracks.slice(0, 5).map((t) => t.trackId);
  assert.ok(opening.includes("pop1") || opening.includes("pop2"));
  assert.ok(result.tracks.every((t) => t.trackId !== "ukg1"));
});
