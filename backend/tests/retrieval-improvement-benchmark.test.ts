import assert from "node:assert/strict";
import { test } from "node:test";
import { retrieveScoringCandidates } from "../lib/candidate-retrieval-pipeline";
import {
  analyzeLibraryCapability,
  orchestratePlaylistRetrieval,
} from "../lib/playlist-retrieval-orchestrator";
import { buildLibrarySignals } from "../lib/library-signals";
import {
  buildPromptSonicTarget,
  scoreTrackSonicPromptFit,
} from "../lib/sonic-taste-profile";
import type { RetrievalTrackInput } from "../lib/candidate-retrieval-pipeline";

type BenchTrack = RetrievalTrackInput & { spotifyArtistGenres: string[] };

function makeTrack(
  id: string,
  artist: string,
  family: string,
  overrides: Partial<BenchTrack> = {},
): BenchTrack {
  return {
    trackId: id,
    trackName: `Track ${id}`,
    artistName: artist,
    albumName: "Album",
    energy: 0.5,
    valence: 0.5,
    tempo: 110,
    danceability: 0.5,
    acousticness: 0.4,
    instrumentalness: 0.2,
    speechiness: 0.08,
    popularity: 50,
    spotifyArtistGenres: [family],
    ...overrides,
  };
}

function makeClassMap(tracks: BenchTrack[]): Map<string, {
  genrePrimary: string;
  genreFamily: string;
  primarySubgenre: string;
  secondarySubgenre: string | null;
  subGenres: string[];
}> {
  const map = new Map();
  for (const t of tracks) {
    const family = t.spotifyArtistGenres?.[0] ?? "unknown";
    map.set(t.trackId, {
      genrePrimary: family,
      genreFamily: family.includes("indie") ? "indie" : family.includes("dance") ? "electronic" : family,
      primarySubgenre: family,
      secondarySubgenre: null,
      subGenres: t.spotifyArtistGenres ?? [family],
    });
  }
  return map;
}

function buildIndieHeavyLibrary(size = 80): BenchTrack[] {
  return Array.from({ length: size }, (_, i) =>
    makeTrack(`ind-${i}`, `Indie Artist ${i % 12}`, "indie rock", {
      energy: 0.42 + (i % 5) * 0.03,
      valence: 0.38 + (i % 4) * 0.05,
      danceability: 0.38,
      acousticness: 0.62,
      tempo: 95 + (i % 8),
      popularity: 45 + (i % 20),
    }),
  );
}

function buildDanceHeavyLibrary(size = 80): BenchTrack[] {
  return Array.from({ length: size }, (_, i) =>
    makeTrack(`dance-${i}`, `DJ ${i % 10}`, "dance pop", {
      energy: 0.72 + (i % 4) * 0.05,
      valence: 0.65,
      danceability: 0.82,
      acousticness: 0.08,
      instrumentalness: 0.05,
      speechiness: 0.12,
      tempo: 124 + (i % 6),
      popularity: 60 + (i % 15),
    }),
  );
}

function buildGardenLibrary(): BenchTrack[] {
  const frequent = Array.from({ length: 30 }, (_, i) =>
    makeTrack(`freq-${i}`, "Arctic Monkeys", "indie rock", {
      energy: 0.68,
      valence: 0.55,
      danceability: 0.62,
      acousticness: 0.25,
      popularity: 78,
    }),
  );
  const warm = Array.from({ length: 35 }, (_, i) =>
    makeTrack(`warm-${i}`, `Garden Artist ${i}`, "indie folk", {
      energy: 0.38 + (i % 3) * 0.04,
      valence: 0.58,
      danceability: 0.42,
      acousticness: 0.72,
      speechiness: 0.06,
      popularity: 35 + (i % 10),
    }),
  );
  return [...frequent, ...warm];
}

function buildSignals(tracks: BenchTrack[], frequentIds: string[]): ReturnType<typeof buildLibrarySignals> {
  const likedRows = tracks.map((t) => ({
    trackId: t.trackId,
    artistName: t.artistName,
    albumName: t.albumName,
    addedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
    energy: t.energy ?? null,
    valence: t.valence ?? null,
    acousticness: t.acousticness ?? null,
    danceability: t.danceability ?? null,
  }));
  const history = [
    {
      trackIds: frequentIds,
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      vibe: "recent",
      journeyArc: null,
    },
    {
      trackIds: frequentIds.slice(0, 8),
      createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      vibe: "recent",
      journeyArc: null,
    },
  ];
  return buildLibrarySignals(likedRows, history as never);
}

type BenchMetrics = {
  openingPass: boolean;
  replayProxy: number;
  saveProxy: number;
  humanPreference: number;
  libraryGravityShare: number;
  forgottenShare: number;
};

function measureRetrieval(
  tracks: BenchTrack[],
  vibe: string,
  intent: { activity?: string },
  emotionProfile: {
    energy: number;
    valence: number;
    tension: number;
    nostalgia: number;
    calm: number;
    environment: null;
    timeOfDay: null;
    motionState: null;
  },
  librarySignals?: ReturnType<typeof buildLibrarySignals>,
): BenchMetrics {
  const classMap = makeClassMap(tracks);
  const result = retrieveScoringCandidates({
    tracks,
    vibe,
    intent,
    emotionProfile,
    classMap,
    librarySignals,
    requestedLength: 25,
    sceneActive: true,
    debugRetrieval: true,
  });
  const diag = result.diagnostics as {
    libraryGravityShare?: number;
    sourceDistribution?: { forgotten_favourites?: number; favourite_artists?: number };
  };
  const promptTarget = buildPromptSonicTarget(vibe, emotionProfile, null);
  const opening = result.tracks.slice(0, 5);
  const openingScores = opening.map((t) => scoreTrackSonicPromptFit(t, promptTarget, null));
  const openingPass = openingScores.filter((s) => s >= 0.52).length >= 3;
  const activityFit = result.tracks.slice(0, 20).reduce((sum, t) => {
    const e = t.energy ?? 0.5;
    return sum + (1 - Math.abs(e - emotionProfile.energy));
  }, 0) / Math.min(20, result.tracks.length);
  const saveProxy = opening.reduce((sum, t) => {
    const pop = typeof t.popularity === "number" ? t.popularity / 100 : 0.45;
    const sonic = scoreTrackSonicPromptFit(t, promptTarget, null);
    return sum + pop * 0.35 + sonic * 0.65;
  }, 0) / Math.max(1, opening.length);
  const humanPreference = opening.reduce((sum, t) => {
    const sonic = scoreTrackSonicPromptFit(t, promptTarget, null);
    const e = t.energy ?? 0.5;
    const energyFit = 1 - Math.abs(e - emotionProfile.energy);
    return sum + sonic * 0.55 + energyFit * 0.45;
  }, 0) / Math.max(1, opening.length);
  const forgottenCount = diag.sourceDistribution?.forgotten_favourites ?? 0;
  const favouriteCount = diag.sourceDistribution?.favourite_artists ?? 0;
  const totalSources = forgottenCount + favouriteCount + 1;

  return {
    openingPass,
    replayProxy: Math.round(activityFit * 100) / 100,
    saveProxy: Math.round(saveProxy * 100) / 100,
    humanPreference: Math.round(humanPreference * 100) / 100,
    libraryGravityShare: Math.round((diag.libraryGravityShare ?? 0) * 100) / 100,
    forgottenShare: Math.round((forgottenCount / totalSources) * 100) / 100,
  };
}

test("gym prompt with indie-heavy library reports conflict but may still retrieve when relaxed supply exists", () => {
  const tracks = buildIndieHeavyLibrary();
  const classMap = makeClassMap(tracks);
  const capability = analyzeLibraryCapability({
    tracks,
    vibe: "gym workout lifting cardio",
    intent: { activity: "gym" },
    emotionProfile: { energy: 0.85, valence: 0.7, tension: 0.4, nostalgia: 0.2, calm: 0.1, environment: null, timeOfDay: null, motionState: null },
    classMap,
    requestedLength: 25,
  });
  assert.ok(capability.score <= 35);
  assert.ok(capability.limitingFactors.includes("library_prompt_conflict") || capability.limitingFactors.includes("low_activity_match"));

  const orchestrated = orchestratePlaylistRetrieval({
    tracks,
    vibe: "gym workout lifting cardio",
    intent: { activity: "gym" },
    emotionProfile: { energy: 0.85, valence: 0.7, tension: 0.4, nostalgia: 0.2, calm: 0.1, environment: null, timeOfDay: null, motionState: null },
    classMap,
    requestedLength: 25,
    sceneActive: true,
  });
  assert.ok(orchestrated.diagnostics.validCandidateSupply);
  if (orchestrated.diagnostics.validCandidateSupply.sufficient) {
    assert.equal(orchestrated.failure, undefined);
    assert.ok(orchestrated.tracks.length > 0);
  } else {
    assert.ok(orchestrated.failure);
    assert.equal(orchestrated.failure?.code, "LIBRARY_INSUFFICIENT_FOR_PROMPT");
  }
});

test("focus prompt with dance-heavy library fails library capability honestly", () => {
  const tracks = buildDanceHeavyLibrary();
  const classMap = makeClassMap(tracks);
  const capability = analyzeLibraryCapability({
    tracks,
    vibe: "deep focus coding session",
    intent: { activity: "focus" },
    emotionProfile: { energy: 0.28, valence: 0.48, tension: 0.2, nostalgia: 0.2, calm: 0.65, environment: null, timeOfDay: null, motionState: null },
    classMap,
    requestedLength: 25,
  });
  assert.ok(capability.limitingFactors.includes("library_prompt_conflict") || capability.activityScore < 40);

  const orchestrated = orchestratePlaylistRetrieval({
    tracks,
    vibe: "deep focus coding session",
    intent: { activity: "focus" },
    emotionProfile: { energy: 0.28, valence: 0.48, tension: 0.2, nostalgia: 0.2, calm: 0.65, environment: null, timeOfDay: null, motionState: null },
    classMap,
    requestedLength: 25,
    sceneActive: true,
  });
  assert.ok(orchestrated.failure);
  assert.equal(orchestrated.failure?.code, "LIBRARY_INSUFFICIENT_FOR_PROMPT");
});

test("summer garden retrieval favours warm acoustic over frequent indie drive", () => {
  const tracks = buildGardenLibrary();
  const frequentIds = tracks.filter((t) => t.trackId.startsWith("freq")).map((t) => t.trackId);
  const signals = buildSignals(tracks, frequentIds);
  const metrics = measureRetrieval(
    tracks,
    "summer afternoon in the garden sunlight relaxed",
    {},
    { energy: 0.42, valence: 0.62, tension: 0.15, nostalgia: 0.55, calm: 0.65, environment: null, timeOfDay: null, motionState: null },
    signals,
  );
  const result = retrieveScoringCandidates({
    tracks,
    vibe: "summer afternoon in the garden sunlight relaxed",
    intent: {},
    emotionProfile: { energy: 0.42, valence: 0.62, tension: 0.15, nostalgia: 0.55, calm: 0.65, environment: null, timeOfDay: null, motionState: null },
    classMap: makeClassMap(tracks),
    librarySignals: signals,
    requestedLength: 25,
    sceneActive: true,
    debugRetrieval: true,
  });
  const openingIds = result.tracks.slice(0, 8).map((t) => t.trackId);
  const warmInOpening = openingIds.filter((id) => id.startsWith("warm")).length;
  assert.ok(warmInOpening >= 4, `expected warm tracks in opening, got ${warmInOpening}`);
  assert.ok(metrics.openingPass);
  assert.ok(metrics.humanPreference >= 0.55);
  assert.ok(metrics.forgottenShare >= 0.15 || metrics.libraryGravityShare <= 0.75);
});

test("end of summer retrieval prefers nostalgic moderate-energy tracks", () => {
  const tracks = [
    ...buildGardenLibrary(),
    ...Array.from({ length: 20 }, (_, i) =>
      makeTrack(`hype-${i}`, `Party ${i}`, "dance pop", {
        energy: 0.88,
        valence: 0.82,
        danceability: 0.85,
        acousticness: 0.1,
      }),
    ),
  ];
  const metrics = measureRetrieval(
    tracks,
    "end of summer bittersweet nostalgic warm",
    {},
    { energy: 0.48, valence: 0.52, tension: 0.25, nostalgia: 0.72, calm: 0.5, environment: null, timeOfDay: null, motionState: null },
  );
  const opening = retrieveScoringCandidates({
    tracks,
    vibe: "end of summer bittersweet nostalgic warm",
    intent: {},
    emotionProfile: { energy: 0.48, valence: 0.52, tension: 0.25, nostalgia: 0.72, calm: 0.5, environment: null, timeOfDay: null, motionState: null },
    classMap: makeClassMap(tracks),
    requestedLength: 25,
    sceneActive: true,
  }).tracks.slice(0, 5);
  const meanEnergy = opening.reduce((s, t) => s + (t.energy ?? 0.5), 0) / opening.length;
  assert.ok(meanEnergy <= 0.62);
  assert.ok(metrics.openingPass);
  assert.ok(metrics.humanPreference >= 0.5);
});

test("late night drive retrieval prefers atmospheric moderate-energy openers", () => {
  const tracks = [
    ...Array.from({ length: 40 }, (_, i) =>
      makeTrack(`drive-${i}`, `Night Artist ${i}`, "indie rock", {
        energy: 0.48 + (i % 4) * 0.04,
        valence: 0.42,
        danceability: 0.45,
        acousticness: 0.55,
        speechiness: 0.07,
        tempo: 98 + (i % 5),
      }),
    ),
    ...Array.from({ length: 20 }, (_, i) =>
      makeTrack(`day-${i}`, `Day Pop ${i}`, "pop", {
        energy: 0.82,
        valence: 0.78,
        danceability: 0.78,
        acousticness: 0.15,
      }),
    ),
  ];
  const metrics = measureRetrieval(
    tracks,
    "late night relaxing drive on empty roads",
    {},
    { energy: 0.48, valence: 0.45, tension: 0.3, nostalgia: 0.55, calm: 0.45, environment: null, timeOfDay: null, motionState: null },
  );
  const opening = retrieveScoringCandidates({
    tracks,
    vibe: "late night relaxing drive on empty roads",
    intent: {},
    emotionProfile: { energy: 0.48, valence: 0.45, tension: 0.3, nostalgia: 0.55, calm: 0.45, environment: null, timeOfDay: null, motionState: null },
    classMap: makeClassMap(tracks),
    requestedLength: 25,
    sceneActive: true,
  }).tracks.slice(0, 5);
  const nightTracks = opening.filter((t) => t.trackId.startsWith("drive")).length;
  assert.ok(nightTracks >= 3);
  assert.ok(metrics.openingPass);
  assert.ok(metrics.replayProxy >= 0.55);
});
