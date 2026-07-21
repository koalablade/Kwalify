import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  listGenrePrototypeCentres,
  resolveGenrePrototypeCentres,
  scorePrototypeAffinity,
  trackMatchesGenrePrototype,
} from "../core/editorial/genre-prototype-centres";
import {
  computeDominantWorldDensity,
  computeWorldCoherenceScore,
  scoreDominantWorldDensity,
  scoreRetrievalEntropy,
} from "../core/editorial/world-coherence-score";
import {
  fillPlaylistViaFallbackChain,
  rankByFallbackChainProximity,
  resolveSceneFallbackChain,
  trackMatchesFallbackChain,
} from "../core/editorial/scene-fallback-chains";

describe("genre-prototype-centres", () => {
  it("loads disco prototype artists from taxonomy hints", () => {
    const centres = resolveGenrePrototypeCentres({
      vibe: "70s disco party dancefloor",
      primarySubgenre: "disco",
      genreFamilies: ["soul"],
    });
    assert.ok(centres.some((c) => c.subgenre === "disco"));
    const disco = centres.find((c) => c.subgenre === "disco")!;
    assert.ok(trackMatchesGenrePrototype("Donna Summer", disco));
    assert.ok(trackMatchesGenrePrototype("Bee Gees", disco));
    assert.ok(trackMatchesGenrePrototype("Chic", disco));
  });

  it("scores higher affinity when prototype artists appear", () => {
    const centres = resolveGenrePrototypeCentres({ primarySubgenre: "disco" });
    const weak = scorePrototypeAffinity(
      [{ artistName: "Random Band" }, { artistName: "Other Act" }],
      centres,
    );
    const strong = scorePrototypeAffinity(
      [
        { artistName: "Donna Summer" },
        { artistName: "Bee Gees" },
        { artistName: "Sister Sledge" },
        { artistName: "Random Band" },
      ],
      centres,
    );
    assert.ok(strong > weak);
    assert.ok(strong >= 0.55);
  });

  it("lists multiple prototype centres from taxonomy", () => {
    assert.ok(listGenrePrototypeCentres().length >= 10);
  });
});

describe("world-coherence-score", () => {
  it("rewards dense dominant-world playlists over scattered ones", () => {
    const dense = computeDominantWorldDensity(
      Array.from({ length: 24 }, () => ({ genreFamily: "soul" })).concat(
        Array.from({ length: 3 }, () => ({ genreFamily: "pop" })),
        Array.from({ length: 2 }, () => ({ genreFamily: "rock" })),
        [{ genreFamily: "electronic" }],
      ),
    );
    const scattered = computeDominantWorldDensity([
      ...Array.from({ length: 7 }, () => ({ genreFamily: "soul" })),
      ...Array.from({ length: 6 }, () => ({ genreFamily: "rock" })),
      ...Array.from({ length: 5 }, () => ({ genreFamily: "hip_hop" })),
      ...Array.from({ length: 4 }, () => ({ genreFamily: "metal" })),
      ...Array.from({ length: 3 }, () => ({ genreFamily: "electronic" })),
    ]);
    assert.ok(scoreDominantWorldDensity(dense) > scoreDominantWorldDensity(scattered));
    assert.ok(dense.dominantShare >= 0.7);
  });

  it("penalises high retrieval entropy across unrelated worlds", () => {
    const focused = scoreRetrievalEntropy(
      Array.from({ length: 20 }, () => ({ genreFamily: "soul" })),
    );
    const noisy = scoreRetrievalEntropy([
      { genreFamily: "soul" },
      { genreFamily: "rock" },
      { genreFamily: "metal" },
      { genreFamily: "hip_hop" },
      { genreFamily: "country" },
      { genreFamily: "jazz" },
      { genreFamily: "classical" },
      { genreFamily: "latin" },
      { genreFamily: "reggae" },
      { genreFamily: "folk" },
      { genreFamily: "blues" },
      { genreFamily: "indie" },
      { genreFamily: "pop" },
      { genreFamily: "electronic" },
      { genreFamily: "rnb" },
      { genreFamily: "world" },
      { genreFamily: "soundtrack" },
      { genreFamily: "soul" },
      { genreFamily: "rock" },
      { genreFamily: "metal" },
    ]);
    assert.ok(noisy > focused);
  });

  it("marks coherent disco-like playlists as wouldSpotifyMakeThis", () => {
    const result = computeWorldCoherenceScore({
      vibe: "70s disco party",
      primarySubgenre: "disco",
      genreFamilies: ["soul"],
      worldConsistency: 0.72,
      tracks: [
        ...Array.from({ length: 18 }, () => ({ genreFamily: "soul", artistName: "Donna Summer" })),
        ...Array.from({ length: 4 }, () => ({ genreFamily: "soul", artistName: "Bee Gees" })),
        ...Array.from({ length: 3 }, () => ({ genreFamily: "pop", artistName: "ABBA" })),
      ],
    });
    assert.ok(result.score >= 0.58);
    assert.equal(result.wouldSpotifyMakeThis, true);
    assert.ok(result.dominantWorldDensity >= 0.7);
  });
});

describe("scene-fallback-chains", () => {
  it("resolves disco and latin chains from prompts", () => {
    assert.equal(resolveSceneFallbackChain("70s disco party dancefloor")?.id, "disco_dancefloor");
    assert.equal(resolveSceneFallbackChain("latin summer beach party")?.id, "latin_summer_party");
    assert.equal(resolveSceneFallbackChain("uk garage 2-step")?.id, "uk_garage");
  });

  it("resolves within-world deepen chains for grunge / gym / 70s rock", () => {
    assert.equal(resolveSceneFallbackChain("90s grunge dark cloudy night")?.id, "grunge_90s");
    assert.equal(resolveSceneFallbackChain("gym rock")?.id, "gym_rock");
    assert.equal(resolveSceneFallbackChain("70s rock evening")?.id, "classic_70s_rock");
    assert.equal(resolveSceneFallbackChain("2000s pop punk")?.id, "pop_punk");
  });

  it("ranks classic disco before warm adjacent neighbours", () => {
    const chain = resolveSceneFallbackChain("disco dancefloor")!;
    const ranked = rankByFallbackChainProximity(
      [
        { trackId: "warm", genreFamily: "pop", energy: 0.8, danceability: 0.8 },
        { trackId: "disco", genreFamily: "soul", primarySubgenre: "disco", energy: 0.7 },
        { trackId: "funk", genreFamily: "soul", primarySubgenre: "funk", energy: 0.75 },
      ],
      chain,
    );
    assert.equal(ranked[0]?.trackId, "disco");
    assert.ok(ranked.some((t) => t.trackId === "funk"));
  });

  it("matches latin warm dance neighbours without danceability", () => {
    const chain = resolveSceneFallbackChain("latin summer beach party")!;
    const match = trackMatchesFallbackChain(
      { trackId: "p1", genreFamily: "pop", energy: 0.7 },
      chain,
    );
    assert.equal(match.matched, true);
  });

  it("matches studio54 adjacent soul/pop when audio features are missing", () => {
    const chain = resolveSceneFallbackChain("70s disco party dancefloor")!;
    const match = trackMatchesFallbackChain(
      { trackId: "p2", genreFamily: "pop" },
      chain,
    );
    assert.equal(match.matched, true);
  });

  it("fills underfilled disco playlists along the chain while respecting artist caps", () => {
    const chain = resolveSceneFallbackChain("70s disco party dancefloor")!;
    const current = [
      { trackId: "a1", artistName: "Chic", genreFamily: "soul", primarySubgenre: "disco", energy: 0.8 },
      { trackId: "a2", artistName: "Chic", genreFamily: "soul", primarySubgenre: "disco", energy: 0.75 },
    ];
    const candidates = [
      ...current,
      { trackId: "b1", artistName: "Donna Summer", genreFamily: "soul", primarySubgenre: "disco", energy: 0.85 },
      { trackId: "b2", artistName: "Bee Gees", genreFamily: "soul", primarySubgenre: "disco", energy: 0.7 },
      { trackId: "c1", artistName: "Parliament", genreFamily: "soul", primarySubgenre: "funk", energy: 0.78 },
      { trackId: "d1", artistName: "Chic", genreFamily: "soul", primarySubgenre: "disco", energy: 0.9 },
    ];
    const filled = fillPlaylistViaFallbackChain(current, candidates, chain, {
      targetLength: 5,
      maxPerArtist: 2,
    });
    assert.equal(filled.added, 3);
    assert.equal(filled.tracks.length, 5);
    assert.equal(filled.tracks.filter((t) => t.artistName === "Chic").length, 2);
    assert.ok(filled.tracks.some((t) => t.trackId === "b1"));
    assert.ok(filled.tracks.some((t) => t.trackId === "c1"));
  });
});
