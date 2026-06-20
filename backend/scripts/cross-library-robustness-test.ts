/**
 * Cross-library robustness test — synthetic libraries × scene prompts.
 *
 * Ensures: no generic fallback, no genre hallucination, scene transforms taste.
 *
 * Usage: npm run stress:cross-library
 */

import { classifyTrack } from "../lib/genre-taxonomy";
import { enrichTrackSemanticProfile } from "../lib/track-semantic-enrichment";
import { expandCulturalReferences, partitionExpansionGenreHints } from "../lib/cultural-reference-expansion";
import { buildIntentPipelineContext, anchorSceneContextToManifold, mergeSceneAliasesIntoGenres } from "../lib/intent-pipeline-orchestrator";
import { computeSceneAliasRetrievalBoost } from "../lib/scene-alias-retrieval-boost";
import { buildPromptSceneProfile, scoreSemanticSceneMatch } from "../lib/scene-semantic-retrieval";
import {
  buildUserTasteManifold,
  genreSupportCheck,
  projectSceneOntoManifold,
} from "../lib/user-taste-manifold";
import { ROBUSTNESS_SCENE_PROMPTS, SYNTHETIC_LIBRARIES } from "../lib/stress-testing/synthetic-libraries";
import type { SyntheticLibraryProfile } from "../lib/stress-testing/types";

type RobustnessCase = {
  libraryId: string;
  prompt: string;
  coldStart: boolean;
  pass: boolean;
  failureModes: string[];
  sceneId: string | null;
  atmospheres: string[];
  foreignDominant: string[];
  genericFallback: boolean;
  genreHallucination: boolean;
  sceneTransformOk: boolean;
  topGenres: string[];
  projectedGenres: string[];
};

function evaluateCase(library: SyntheticLibraryProfile, prompt: string): RobustnessCase {
  const coldStart = library.coldStart === true || library.tracks.length === 0;
  const manifold = coldStart ? null : buildUserTasteManifold(library.tracks);
  const libraryFamilies = manifold ? Object.keys(manifold.genreSupport) : [];

  const expansion = expandCulturalReferences(prompt);
  const pipeline = buildIntentPipelineContext(prompt, "balanced");
  const projection = manifold
    ? projectSceneOntoManifold(
      [...expansion.atmospheres, ...expansion.scene.atmospheres],
      expansion.culturalTags,
      expansion.sceneId,
      manifold,
    )
    : null;
  const anchored = anchorSceneContextToManifold(pipeline.sceneAliases, pipeline.scenePrediction, manifold, projection);
  const genrePartition = partitionExpansionGenreHints(expansion, manifold);
  const sceneProfile = buildPromptSceneProfile(prompt);
  const mergedEmpty = mergeSceneAliasesIntoGenres([], pipeline.sceneAliases);
  const mergedLibrary = mergeSceneAliasesIntoGenres(
    libraryFamilies.slice(0, 1),
    anchored.sceneAliases,
    { libraryGenreFamilies: libraryFamilies },
  );

  const atmospheres = [...new Set([...sceneProfile.atmospheres, ...expansion.atmospheres])];
  const foreignInjected = [
    ...anchored.sceneAliases,
    ...mergedLibrary,
    ...Object.keys(projection?.projectedGenreWeights ?? {}),
  ].filter((g) => manifold != null && !genreSupportCheck(manifold, g));

  const genericFallback = coldStart
    ? mergedEmpty.length > 0
    : mergedEmpty.some((g) => !libraryFamilies.includes(g));

  const genreHallucination = foreignInjected.length > 0 || genrePartition.diagnosticOnlyHints.some(
    (g) => manifold != null && !genreSupportCheck(manifold, g) && mergedLibrary.includes(g),
  );

  let foreignDominant: string[] = [];
  let topGenres: string[] = [];
  if (manifold && library.tracks.length > 0) {
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
        return { track, score: semantic + alias, genreFamily: track.genreFamily ?? classification.genreFamily };
      })
      .sort((a, b) => b.score - a.score);

    const weights = new Map<string, number>();
    for (const row of ranked.slice(0, 3)) {
      const family = row.genreFamily ?? "unknown";
      weights.set(family, (weights.get(family) ?? 0) + row.score);
    }
    topGenres = [...weights.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g]) => g);
    foreignDominant = topGenres.filter(
      (g) => g !== "unknown" && !genreSupportCheck(manifold, g),
    );
  }

  const sceneSignals = [
    ...atmospheres,
    ...sceneProfile.times,
    ...sceneProfile.activities,
    ...sceneProfile.places,
  ];
  const sceneTransformOk = coldStart
    ? sceneSignals.length >= 1 || expansion.sceneId != null
    : (sceneSignals.length >= 1 || expansion.sceneId != null) && !genreHallucination;

  const failureModes: string[] = [];
  if (genericFallback) failureModes.push("generic_fallback");
  if (genreHallucination) failureModes.push("genre_hallucination");
  if (foreignDominant.length > 0) failureModes.push("foreign_genre_dominant");
  if (!sceneTransformOk) failureModes.push("scene_transform_failed");

  return {
    libraryId: library.id,
    prompt,
    coldStart,
    pass: failureModes.length === 0,
    failureModes,
    sceneId: expansion.sceneId,
    atmospheres,
    foreignDominant,
    genericFallback,
    genreHallucination,
    sceneTransformOk,
    topGenres,
    projectedGenres: Object.keys(projection?.projectedGenreWeights ?? {}).slice(0, 4),
  };
}

function main(): void {
  const results: RobustnessCase[] = [];
  for (const library of SYNTHETIC_LIBRARIES) {
    for (const prompt of ROBUSTNESS_SCENE_PROMPTS) {
      results.push(evaluateCase(library, prompt));
    }
  }

  const passed = results.filter((r) => r.pass).length;
  const byLibrary = SYNTHETIC_LIBRARIES.map((lib) => {
    const rows = results.filter((r) => r.libraryId === lib.id);
    return {
      libraryId: lib.id,
      label: lib.label,
      cases: rows.length,
      passed: rows.filter((r) => r.pass).length,
      failures: rows.filter((r) => !r.pass).slice(0, 3),
    };
  });

  const failures = results.filter((r) => !r.pass);
  for (const row of failures.slice(0, 20)) {
    console.log(JSON.stringify({ id: `${row.libraryId}::${row.prompt.slice(0, 40)}`, pass: false, modes: row.failureModes }));
  }

  console.log(JSON.stringify({
    libraries: SYNTHETIC_LIBRARIES.length,
    prompts: ROBUSTNESS_SCENE_PROMPTS.length,
    cases: results.length,
    passed,
    passRate: Math.round((passed / results.length) * 1000) / 10,
    byLibrary,
    sampleFailures: failures.slice(0, 8),
  }, null, 2));

  if (passed / results.length < 0.9) {
    console.error(`stress:cross-library failed (${passed}/${results.length})`);
    process.exit(1);
  }
  console.log(`stress:cross-library passed (${passed}/${results.length})`);
}

main();
