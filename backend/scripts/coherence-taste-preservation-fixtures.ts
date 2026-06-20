/**
 * Library-first scene alias merge fixtures (extended with taste manifold).
 *
 * Usage: npm run coherence:taste-preservation
 */

import { mergeSceneAliasesIntoGenres, anchorSceneContextToManifold, buildIntentPipelineContext } from "../lib/intent-pipeline-orchestrator";
import { buildDominantIntentContract } from "../core/dominant-intent-contract";
import { decomposeIntent } from "../core/intent-decomposer";
import { expandCulturalReferences } from "../lib/cultural-reference-expansion";
import { buildUserTasteManifold, genreSupportCheck } from "../lib/user-taste-manifold";
import { computeSceneModifierRetrievalBoost } from "../lib/scene-alias-retrieval-boost";
import { buildSceneModifier } from "../lib/scene-modifier";

function main(): void {
  const ukLibrary = ["electronic", "hip_hop"];
  const ukTracks = [
    { trackId: "u1", trackName: "Archangel", artistName: "Burial", genreFamily: "electronic", energy: 0.41, valence: 0.22, tempo: 134, danceability: 0.62, acousticness: 0.08, instrumentalness: 0.71 },
    { trackId: "u2", trackName: "Girl", artistName: "Jamie xx", genreFamily: "electronic", energy: 0.55, valence: 0.35, tempo: 122, danceability: 0.68, acousticness: 0.05, instrumentalness: 0.42 },
    { trackId: "u3", trackName: "Kiara", artistName: "Bonobo", genreFamily: "electronic", energy: 0.48, valence: 0.42, tempo: 98, danceability: 0.55, acousticness: 0.12, instrumentalness: 0.65 },
    { trackId: "u4", trackName: "Vessel", artistName: "Four Tet", genreFamily: "electronic", energy: 0.52, valence: 0.38, tempo: 128, danceability: 0.71, acousticness: 0.03, instrumentalness: 0.88 },
    { trackId: "u5", trackName: "21 Seconds", artistName: "So Solid Crew", genreFamily: "hip_hop", energy: 0.72, valence: 0.55, tempo: 140, danceability: 0.78, acousticness: 0.02, instrumentalness: 0.01 },
  ];
  const manifold = buildUserTasteManifold(ukTracks);
  const agathaAliases = buildIntentPipelineContext("Reading Agatha Christie", "balanced").sceneAliases;
  const expansion = expandCulturalReferences("Reading Agatha Christie");
  const anchored = anchorSceneContextToManifold(agathaAliases, {}, manifold, null);

  const emptyMerge = mergeSceneAliasesIntoGenres([], agathaAliases);
  const libraryMerge = mergeSceneAliasesIntoGenres(["electronic"], agathaAliases, {
    libraryGenreFamilies: ukLibrary,
  });
  const blockedMerge = mergeSceneAliasesIntoGenres(["electronic"], agathaAliases, {
    libraryGenreFamilies: ["rock"],
  });

  const decomposed = decomposeIntent("Reading Agatha Christie");
  const contract = buildDominantIntentContract({
    prompt: "Reading Agatha Christie",
    intentContract: {
      primarySubgenre: null,
      genreFamilies: [],
      activity: decomposed.inferredActivity,
      places: [],
      eraRange: null,
      explicitDimensions: [],
    },
  });

  const agathaExpansion = expandCulturalReferences("Reading Agatha Christie");
  const sceneModifier = buildSceneModifier({ prompt: "Reading Agatha Christie", expansion: agathaExpansion });

  const jazzAliasBoost = computeSceneModifierRetrievalBoost(
    { genreFamily: "jazz", genrePrimary: "jazz" },
    sceneModifier,
    { tasteManifold: manifold },
  );
  const electronicAliasBoost = computeSceneModifierRetrievalBoost(
    { genreFamily: "electronic", genrePrimary: "electronic" },
    sceneModifier,
    { tasteManifold: manifold },
  );

  const checks = [
    { id: "empty-base-no-injection", pass: emptyMerge.length === 0 },
    { id: "library-intersection-only", pass: libraryMerge.every((g) => ukLibrary.includes(g) || g === "electronic") && !libraryMerge.includes("jazz") },
    { id: "no-classical-without-library", pass: !blockedMerge.includes("classical") && !blockedMerge.includes("jazz") },
    { id: "contract-no-cultural-genres", pass: contract.genreFamilies.length === 0 },
    { id: "contract-no-cultural-era", pass: contract.eraRange == null },
    { id: "contract-atmosphere-enriched", pass: contract.scene.atmosphere.length >= 2 },
    { id: "manifold-blocks-jazz-alias-boost", pass: jazzAliasBoost === 0 },
    { id: "manifold-allows-electronic-boost", pass: electronicAliasBoost >= 0 && genreSupportCheck(manifold, "electronic") },
    { id: "anchored-aliases-no-jazz", pass: !anchored.sceneAliases.includes("jazz") && !anchored.sceneAliases.includes("classical") },
    { id: "expansion-hints-blocked", pass: expansion.genreFamilies.length === 0 && !genreSupportCheck(manifold, "jazz") },
  ];

  let failed = 0;
  for (const check of checks) {
    if (!check.pass) failed += 1;
    console.log(JSON.stringify(check));
  }
  if (failed > 0) {
    console.error(`coherence taste preservation failed: ${failed}/${checks.length}`);
    process.exit(1);
  }
  console.log(`coherence taste preservation passed (${checks.length} checks)`);
}

main();
