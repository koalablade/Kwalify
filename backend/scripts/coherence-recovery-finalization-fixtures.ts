/**
 * Recovery / finalization guard fixtures.
 *
 * Usage: npm run coherence:recovery-finalization
 */

import {
  capArtistAlbumRelaxation,
  minimumGenreEvidenceInTail,
  narrowSceneDiversityPressure,
  recoveryIntentPreCheck,
  buildDominantIntentContract,
  shouldBlockHardSafeFinalization,
  trackMatchesDominantEmotion,
  capTastePullWeight,
} from "../core/dominant-intent-contract";
import { buildConstraintRelaxationPlan } from "../core/v3/constraint-relaxation";
import { evaluateRecoveryGuards, recoveryStageAllowed } from "../controllers/generation-recovery";
import { allowNoLibraryGlobalFallback } from "../controllers/generation/generation-no-library-retrieval";

function main(): void {
  let failed = 0;

  const strictContract = buildDominantIntentContract({
    prompt: "industrial techno warehouse bunker",
    intentContract: {
      primarySubgenre: "hard_techno",
      genreFamilies: ["electronic"],
      activity: null,
      places: [],
      eraRange: null,
      explicitDimensions: ["genre"],
    },
    mode: "strict",
    noLibraryMode: false,
  });

  const globalBlocked = recoveryIntentPreCheck(strictContract, {
    fallbackLevel: "global",
    underfillRatio: 0.4,
    currentSubgenreSurvival: 40,
  });
  if (globalBlocked.allowed || !globalBlocked.controlledFailureRecommended) failed += 1;

  const hardSafeBlocked = recoveryIntentPreCheck(strictContract, {
    fallbackLevel: "hardSafe",
    underfillRatio: 0.35,
    currentSubgenreSurvival: 55,
  });
  if (hardSafeBlocked.allowed || hardSafeBlocked.reason !== "hard_safe_blocked_in_strict_mode") failed += 1;

  if (!shouldBlockHardSafeFinalization("strict", { primarySubgenre: "hard_techno", primaryGenres: ["electronic"] })) failed += 1;
  if (shouldBlockHardSafeFinalization("balanced", { primarySubgenre: "hard_techno", primaryGenres: ["electronic"] })) failed += 1;

  if (trackMatchesDominantEmotion({ energy: 0.9, valence: 0.9 }, "melancholy")) failed += 1;
  if (!trackMatchesDominantEmotion({ energy: 0.35, valence: 0.3 }, "melancholy")) failed += 1;
  if (capTastePullWeight(0.55, 0.12) !== 0.12 || capTastePullWeight(0.35, 0.22) !== 0.22) failed += 1;
  if (allowNoLibraryGlobalFallback({ mode: "strict", primarySubgenre: "hard_techno" })) failed += 1;
  if (!allowNoLibraryGlobalFallback({ mode: "balanced", primarySubgenre: "hard_techno" })) failed += 1;

  const strictRelaxPlan = buildConstraintRelaxationPlan({
    genreFamilies: ["electronic"],
    primaryGenre: "techno",
    primarySubgenre: "hard_techno",
    secondarySubgenre: null,
    subgenreTerms: ["hard_techno"],
    activity: null,
    eraRange: null,
    mood: [],
    energy: null,
    sceneIntent: null,
  }, "strict");
  if (strictRelaxPlan.length !== 1 || strictRelaxPlan[0]?.id !== "strict") failed += 1;

  const subgenreErase = recoveryIntentPreCheck(strictContract, {
    fallbackLevel: "soft",
    underfillRatio: 0.3,
    currentSubgenreSurvival: 35,
  });
  if (subgenreErase.allowed || subgenreErase.reason !== "recovery_would_erase_subgenre") failed += 1;

  const tail = minimumGenreEvidenceInTail(
    [
      { genreFamily: "electronic", genrePrimary: "techno" },
      { genreFamily: "electronic", genrePrimary: "techno" },
      { genreFamily: "pop", genrePrimary: "pop" },
      { genreFamily: "pop", genrePrimary: "pop" },
    ],
    ["electronic"],
  );
  if (tail.satisfied) failed += 1;

  const narrowScene = narrowSceneDiversityPressure({
    visual: ["neon"],
    place: ["city"],
    time: ["night"],
    atmosphere: ["lonely"],
  });
  if (narrowScene >= 1) failed += 1;

  const strictCaps = capArtistAlbumRelaxation("strict");
  if (strictCaps.allowArtistRelax || strictCaps.allowAlbumRelax) failed += 1;

  const guards = evaluateRecoveryGuards(strictContract, {
    fallbackLevel: "global",
    underfillRatio: 0.35,
    finalTracks: [{ genreFamily: "electronic" }],
    expectedFamilies: ["electronic"],
  });
  const stage = recoveryStageAllowed(guards, "global");
  if (stage.allowed) failed += 1;

  console.log(JSON.stringify({
    globalBlocked,
    hardSafeBlocked,
    subgenreErase,
    tail,
    narrowScene,
    strictCaps,
    stage,
    failed,
  }));

  if (failed > 0) {
    console.error(`recovery/finalization fixtures failed: ${failed}`);
    process.exit(1);
  }
  console.log("recovery/finalization fixtures passed");
}

main();
