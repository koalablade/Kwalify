/**
 * Truthful metrics fixtures — externally verifiable scoring + bias detection.
 *
 * Usage: npm run coherence:truthful-metrics
 */

import type { SurvivalTrack } from "../lib/intent-survival-diagnostics";
import { auditMetrics } from "../lib/quality-control/metric-audit";
import { extractPromptGroundTruth } from "../lib/quality-control/prompt-ground-truth";
import { computeTruthfulMetrics } from "../lib/quality-control/truthful-metrics";

function track(
  id: string,
  genreFamily: string,
  features: Partial<SurvivalTrack> = {},
): SurvivalTrack {
  return {
    trackId: id,
    trackName: features.trackName ?? id,
    artistName: features.artistName ?? "Artist",
    genreFamily,
    genrePrimary: genreFamily,
    energy: 0.5,
    valence: 0.5,
    tempo: 110,
    danceability: 0.5,
    acousticness: 0.3,
    ...features,
  };
}

function main(): void {
  const checks: Array<{ id: string; pass: boolean; detail?: unknown }> = [];

  const sadIndieTracks = [
    track("s1", "indie", { valence: 0.25, energy: 0.4, trackName: "slow sad song" }),
    track("s2", "indie", { valence: 0.3, energy: 0.38 }),
    track("s3", "indie", { valence: 0.22, energy: 0.42 }),
  ];
  const sadTruthful = computeTruthfulMetrics({ prompt: "sad indie driving at night", tracks: sadIndieTracks });
  checks.push({
    id: "sad-prompt-emotion-active",
    pass: sadTruthful.emotionSurvival != null && sadTruthful.activeDimensions.includes("emotion"),
  });
  checks.push({
    id: "sad-prompt-inactive-not-100",
    pass: sadTruthful.atmosphereSurvival === null,
  });

  const sceneOnlyTracks = [
    track("a1", "electronic", { trackName: "night city neon", energy: 0.35, valence: 0.3 }),
    track("a2", "electronic", { trackName: "late train", energy: 0.32, valence: 0.28 }),
  ];
  const tokyoTruthful = computeTruthfulMetrics({ prompt: "Tokyo at 3am", tracks: sceneOnlyTracks });
  checks.push({
    id: "scene-only-no-fake-genre-score",
    pass: tokyoTruthful.genreSurvival === null,
  });
  checks.push({
    id: "scene-only-atmosphere-or-null",
    pass: tokyoTruthful.atmosphereSurvival === null || tokyoTruthful.atmosphereSurvival >= 0,
  });

  const jazzTracks = [
    track("j1", "jazz", { trackName: "blue note" }),
    track("j2", "jazz", { trackName: "swing era" }),
  ];
  const jazzTruthful = computeTruthfulMetrics({ prompt: "jazz bar at midnight", tracks: jazzTracks });
  checks.push({
    id: "explicit-jazz-genre-scored",
    pass: (jazzTruthful.genreSurvival ?? 0) >= 90,
  });

  const negTracks = [
    track("r1", "hip_hop", { trackName: "rap anthem" }),
    track("r2", "electronic", { trackName: "instrumental" }),
  ];
  const negTruthful = computeTruthfulMetrics({ prompt: "no rap please", tracks: negTracks });
  checks.push({
    id: "negation-lowers-genre-when-explicit",
    pass: negTruthful.genreSurvival === null || (negTruthful.genreSurvival ?? 100) <= 50,
  });

  const groundTruth = extractPromptGroundTruth("uk garage workout");
  checks.push({
    id: "ground-truth-explicit-genre",
    pass: groundTruth.explicitGenres.includes("uk_garage") || groundTruth.explicitGenres.includes("electronic"),
  });
  checks.push({
    id: "ground-truth-no-pipeline-fields",
    pass: !("lockedIntent" in groundTruth) && groundTruth.explicitDimensions.length >= 1,
  });

  const audit = auditMetrics({
    prompt: "Reading Agatha Christie",
    tracks: sceneOnlyTracks,
    lockedIntent: { primaryGenres: ["jazz", "classical"], genreFamilies: ["jazz"] },
  });
  checks.push({
    id: "audit-detects-circular-genre",
    pass: audit.findings.some((f) => f.kind === "circular_calculation"),
  });
  checks.push({
    id: "audit-inflation-delta-computed",
    pass: Number.isFinite(audit.inflationDelta.intentSurvival),
  });

  const inactiveAudit = auditMetrics({
    prompt: "Tokyo at 3am",
    tracks: sceneOnlyTracks,
  });
  checks.push({
    id: "audit-detects-inactive-100-bias",
    pass: inactiveAudit.findings.some((f) => f.kind === "benchmark_bias_inactive_100"),
  });

  let failed = 0;
  for (const check of checks) {
    if (!check.pass) failed += 1;
    console.log(JSON.stringify(check));
  }

  if (failed > 0) {
    console.error(`coherence truthful metrics failed (${failed}/${checks.length})`);
    process.exit(1);
  }
  console.log(`coherence truthful metrics passed (${checks.length} checks)`);
}

main();
