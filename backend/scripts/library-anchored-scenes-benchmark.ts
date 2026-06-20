/**
 * Library-anchored scene benchmark — scenes must reshape taste, not inject foreign genres.
 *
 * Usage: npm run benchmark:library-anchored-scenes
 */

import { classifyTrack } from "../lib/genre-taxonomy";
import { enrichTrackSemanticProfile } from "../lib/track-semantic-enrichment";
import { expandCulturalReferences, partitionExpansionGenreHints } from "../lib/cultural-reference-expansion";
import { buildIntentPipelineContext, anchorSceneContextToManifold } from "../lib/intent-pipeline-orchestrator";
import { computeSceneAliasRetrievalBoost } from "../lib/scene-alias-retrieval-boost";
import { buildPromptSceneProfile, scoreSemanticSceneMatch } from "../lib/scene-semantic-retrieval";
import {
  buildUserTasteManifold,
  genreSupportCheck,
  projectSceneOntoManifold,
  type ManifoldTrackInput,
} from "../lib/user-taste-manifold";

type LibraryProfile = {
  id: string;
  tracks: ManifoldTrackInput[];
};

type SceneCase = {
  prompt: string;
  expectAtmospheres: string[];
};

const LIBRARIES: LibraryProfile[] = [
  {
    id: "uk-garage-heavy",
    tracks: [
      { trackId: "u1", trackName: "Archangel", artistName: "Burial", genreFamily: "electronic", energy: 0.41, valence: 0.22, tempo: 134, danceability: 0.62, acousticness: 0.08, instrumentalness: 0.71 },
      { trackId: "u2", trackName: "Girl", artistName: "Jamie xx", genreFamily: "electronic", energy: 0.55, valence: 0.35, tempo: 122, danceability: 0.68, acousticness: 0.05, instrumentalness: 0.42 },
      { trackId: "u3", trackName: "Kiara", artistName: "Bonobo", genreFamily: "electronic", energy: 0.48, valence: 0.42, tempo: 98, danceability: 0.55, acousticness: 0.12, instrumentalness: 0.65 },
      { trackId: "u4", trackName: "Vessel", artistName: "Four Tet", genreFamily: "electronic", energy: 0.52, valence: 0.38, tempo: 128, danceability: 0.71, acousticness: 0.03, instrumentalness: 0.88 },
      { trackId: "u5", trackName: "21 Seconds", artistName: "So Solid Crew", genreFamily: "hip_hop", energy: 0.72, valence: 0.55, tempo: 140, danceability: 0.78, acousticness: 0.02, instrumentalness: 0.01 },
      { trackId: "u6", trackName: "Night", artistName: "Burial", genreFamily: "electronic", energy: 0.38, valence: 0.28, tempo: 130, danceability: 0.58, acousticness: 0.06, instrumentalness: 0.75 },
    ],
  },
  {
    id: "indie-folk",
    tracks: [
      { trackId: "i1", trackName: "Holocene", artistName: "Bon Iver", genreFamily: "indie", energy: 0.32, valence: 0.38, tempo: 92, danceability: 0.35, acousticness: 0.72, instrumentalness: 0.05 },
      { trackId: "i2", trackName: "White Winter Hymnal", artistName: "Fleet Foxes", genreFamily: "folk", energy: 0.41, valence: 0.48, tempo: 118, danceability: 0.42, acousticness: 0.68, instrumentalness: 0.02 },
      { trackId: "i3", trackName: "Skinny Love", artistName: "Bon Iver", genreFamily: "indie", energy: 0.28, valence: 0.32, tempo: 76, danceability: 0.28, acousticness: 0.78, instrumentalness: 0.01 },
      { trackId: "i4", trackName: "Ragged Wood", artistName: "Fleet Foxes", genreFamily: "folk", energy: 0.45, valence: 0.52, tempo: 102, danceability: 0.38, acousticness: 0.65, instrumentalness: 0.01 },
      { trackId: "i5", trackName: "Re: Stacks", artistName: "Bon Iver", genreFamily: "indie", energy: 0.18, valence: 0.25, tempo: 68, danceability: 0.22, acousticness: 0.85, instrumentalness: 0.08 },
    ],
  },
  {
    id: "classical-heavy",
    tracks: [
      { trackId: "c1", trackName: "Clair de Lune", artistName: "Debussy", genreFamily: "classical", energy: 0.12, valence: 0.35, tempo: 68, danceability: 0.18, acousticness: 0.98, instrumentalness: 0.95 },
      { trackId: "c2", trackName: "The Murder", artistName: "Bernard Herrmann", genreFamily: "soundtrack", energy: 0.55, valence: 0.22, tempo: 110, danceability: 0.22, acousticness: 0.45, instrumentalness: 0.92 },
      { trackId: "c3", trackName: "Adagio", artistName: "Barber", genreFamily: "classical", energy: 0.15, valence: 0.28, tempo: 60, danceability: 0.12, acousticness: 0.96, instrumentalness: 0.94 },
      { trackId: "c4", trackName: "Nocturne", artistName: "Chopin", genreFamily: "classical", energy: 0.14, valence: 0.32, tempo: 72, danceability: 0.15, acousticness: 0.97, instrumentalness: 0.93 },
    ],
  },
  {
    id: "hip-hop-trap",
    tracks: [
      { trackId: "h1", trackName: "SICKO MODE", artistName: "Travis Scott", genreFamily: "hip_hop", energy: 0.78, valence: 0.45, tempo: 155, danceability: 0.72, acousticness: 0.04, instrumentalness: 0.0 },
      { trackId: "h2", trackName: "HUMBLE.", artistName: "Kendrick Lamar", genreFamily: "hip_hop", energy: 0.68, valence: 0.52, tempo: 150, danceability: 0.75, acousticness: 0.02, instrumentalness: 0.0 },
      { trackId: "h3", trackName: "Mask Off", artistName: "Future", genreFamily: "hip_hop", energy: 0.62, valence: 0.38, tempo: 150, danceability: 0.82, acousticness: 0.01, instrumentalness: 0.0 },
      { trackId: "h4", trackName: "Goosebumps", artistName: "Travis Scott", genreFamily: "hip_hop", energy: 0.55, valence: 0.32, tempo: 130, danceability: 0.68, acousticness: 0.03, instrumentalness: 0.0 },
    ],
  },
  {
    id: "electronic-ambient",
    tracks: [
      { trackId: "e1", trackName: "An Ending", artistName: "Brian Eno", genreFamily: "electronic", energy: 0.18, valence: 0.42, tempo: 72, danceability: 0.22, acousticness: 0.35, instrumentalness: 0.88 },
      { trackId: "e2", trackName: "Avril 14th", artistName: "Aphex Twin", genreFamily: "electronic", energy: 0.22, valence: 0.48, tempo: 80, danceability: 0.28, acousticness: 0.55, instrumentalness: 0.92 },
      { trackId: "e3", trackName: "We Float", artistName: "Goldfrapp", genreFamily: "electronic", energy: 0.35, valence: 0.45, tempo: 98, danceability: 0.42, acousticness: 0.28, instrumentalness: 0.55 },
      { trackId: "e4", trackName: "Teardrop", artistName: "Massive Attack", genreFamily: "electronic", energy: 0.38, valence: 0.35, tempo: 92, danceability: 0.48, acousticness: 0.22, instrumentalness: 0.12 },
    ],
  },
];

const SCENES: SceneCase[] = [
  { prompt: "Reading Agatha Christie", expectAtmospheres: ["mystery", "suspense"] },
  { prompt: "Reading Tolkien", expectAtmospheres: ["epic", "wonder"] },
  { prompt: "Tokyo at 3am", expectAtmospheres: ["nocturnal", "urban"] },
  { prompt: "Paris café in the rain", expectAtmospheres: ["romantic", "melancholy"] },
  { prompt: "Cyberpunk dystopia", expectAtmospheres: ["futuristic", "nocturnal"] },
  { prompt: "Driving through rural France", expectAtmospheres: ["adventure"] },
];

const FORBIDDEN_WHEN_ABSENT = ["jazz", "classical", "orchestral", "soundtrack", "folk"];

function tagHit(tags: string[], expected: string): boolean {
  const lower = tags.map((t) => t.toLowerCase());
  return lower.some((t) => t.includes(expected) || expected.includes(t));
}

function dominantGenreFamilies(tracks: Array<{ track: ManifoldTrackInput; score: number }>): string[] {
  const weights = new Map<string, number>();
  for (const { track, score } of tracks) {
    const family = track.genreFamily ?? "unknown";
    weights.set(family, (weights.get(family) ?? 0) + score);
  }
  return [...weights.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g]) => g);
}

function evaluateLibraryScene(library: LibraryProfile, scene: SceneCase) {
  const manifold = buildUserTasteManifold(library.tracks);
  const expansion = expandCulturalReferences(scene.prompt);
  const pipeline = buildIntentPipelineContext(scene.prompt, "balanced");
  const projection = projectSceneOntoManifold(
    [...expansion.atmospheres, ...expansion.scene.atmospheres],
    expansion.culturalTags,
    expansion.sceneId,
    manifold,
  );
  const anchored = anchorSceneContextToManifold(pipeline.sceneAliases, pipeline.scenePrediction, manifold, projection);
  const genrePartition = partitionExpansionGenreHints(expansion, manifold);
  const sceneProfile = buildPromptSceneProfile(scene.prompt);

  const enriched = library.tracks.map((track) => ({
    track,
    profile: enrichTrackSemanticProfile({
      trackId: track.trackId,
      trackName: track.trackName ?? "",
      artistName: track.artistName ?? "",
      energy: track.energy,
      valence: track.valence,
      tempo: track.tempo,
      danceability: track.danceability,
      acousticness: track.acousticness,
      instrumentalness: track.instrumentalness,
    }),
    classification: classifyTrack({
      trackName: track.trackName ?? "",
      artistName: track.artistName ?? "",
      albumName: "",
      energy: track.energy ?? null,
      valence: track.valence ?? null,
    }),
  }));

  const ranked = enriched
    .map(({ track, profile, classification }) => {
      const semantic = scoreSemanticSceneMatch(sceneProfile, profile, {
        artistName: track.artistName,
        trackName: track.trackName,
        sceneId: expansion.sceneId,
      }).boost;
      const alias = computeSceneAliasRetrievalBoost(
        { genreFamily: classification.genreFamily, genrePrimary: classification.genrePrimary },
        anchored.sceneAliases,
        anchored.scenePrediction,
        { tasteManifold: manifold },
      );
      return { track, score: semantic + alias, genreFamily: classification.genreFamily };
    })
    .sort((a, b) => b.score - a.score);

  const topGenres = dominantGenreFamilies(ranked.slice(0, 3));
  const foreignDominant = topGenres.filter(
    (g) => FORBIDDEN_WHEN_ABSENT.includes(g) && !genreSupportCheck(manifold, g),
  );
  const blockedHints = genrePartition.diagnosticOnlyHints.filter((g) => FORBIDDEN_WHEN_ABSENT.includes(g));
  const anchoredHasForeign = anchored.sceneAliases.some(
    (a) => FORBIDDEN_WHEN_ABSENT.includes(a) && !genreSupportCheck(manifold, a),
  );
  const atmosphereOk = scene.expectAtmospheres.filter((t) =>
    tagHit([...sceneProfile.atmospheres, ...expansion.atmospheres], t),
  ).length >= 1;
  const sceneSeparationSignature = [
    ...sceneProfile.atmospheres.slice(0, 4),
    ...anchored.sceneAliases.slice(0, 3),
    manifold.manifoldSignature.slice(0, 40),
  ].join("|");

  return {
    libraryId: library.id,
    prompt: scene.prompt,
    sceneId: expansion.sceneId,
    atmosphereOk,
    foreignDominant,
    anchoredHasForeign,
    blockedExternalHints: blockedHints.length,
    topGenres,
    anchoredAliases: anchored.sceneAliases.slice(0, 6),
    projectedGenres: Object.keys(projection.projectedGenreWeights).slice(0, 4),
    sceneSeparationSignature,
    pass:
      foreignDominant.length === 0 &&
      !anchoredHasForeign &&
      atmosphereOk &&
      topGenres.every((g) => genreSupportCheck(manifold, g) || g === "unknown"),
  };
}

function main(): void {
  const results: ReturnType<typeof evaluateLibraryScene>[] = [];
  for (const library of LIBRARIES) {
    for (const scene of SCENES) {
      results.push(evaluateLibraryScene(library, scene));
    }
  }

  const passed = results.filter((r) => r.pass).length;
  const signatures = new Set(results.map((r) => r.sceneSeparationSignature));
  const uniquenessRatio = signatures.size / results.length;

  const failures = results.filter((r) => !r.pass).slice(0, 12);
  console.log(JSON.stringify({
    libraries: LIBRARIES.length,
    scenes: SCENES.length,
    cases: results.length,
    passed,
    passRate: Math.round((passed / results.length) * 1000) / 10,
    sceneUniquenessRatio: Math.round(uniquenessRatio * 1000) / 10,
    failures,
    sample: results.slice(0, 4),
  }, null, 2));

  if (passed / results.length < 0.85) {
    console.error(`benchmark:library-anchored-scenes failed (${passed}/${results.length})`);
    process.exit(1);
  }
}

main();
