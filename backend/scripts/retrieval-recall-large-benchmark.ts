/**
 * Large offline retrieval-recall benchmark.
 *
 * Runs the FULL real benchmark prompt suite (PLAYLIST_BENCHMARK_PROMPTS, 48
 * prompts) through the faithful production interpretation path —
 * analyzeVibe() -> buildLockedIntent() -> collapseIntent() -> calibrate ->
 * selectRankedCandidatesForSampler -> diagnoseIntentFilterRejectionCounts —
 * against three library archetypes (mellow-heavy, balanced, energetic-heavy).
 * 48 prompts x 3 libraries = 144 evaluations.
 *
 * This is the offline equivalent of the live 30-prompt harness for the
 * retrieval-recall question: it measures whether the chosen editorial world's
 * energy matches the prompt's expected energy, and what fraction of the
 * energy-appropriate library survives retrieval. Deterministic, so the same
 * script on the pre-fix and post-fix builds gives a clean before/after.
 *
 * Usage:
 *   node backend/dist/scripts/retrieval-recall-large-benchmark.js --out reports/retrieval-recall/large-after
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  collapseIntent,
  calibrateIntentVectorForRetrievalPool,
  selectRankedCandidatesForSampler,
  diagnoseIntentFilterRejectionCounts,
  type IntentCollapseTrack,
} from "../core/editorial/intent-collapse-layer";
import { buildLockedIntent } from "../core/v3/intent";
import { analyzeVibe } from "../lib/emotion";
import { PLAYLIST_BENCHMARK_PROMPTS } from "../lib/playlist-evaluation/benchmark-prompts";

type EnergyBucket = "low" | "mid" | "high";
type BenchTrack = IntentCollapseTrack & { bucket: EnergyBucket };

function makeBucket(bucket: EnergyBucket, count: number, offset: number): BenchTrack[] {
  const spec = {
    low: { fams: ["indie folk", "singer-songwriter", "acoustic pop", "ambient"], energy: 0.34, acoustic: 0.62, dance: 0.36, tempo: 90 },
    mid: { fams: ["indie rock", "pop", "alt rock", "indie pop"], energy: 0.60, acoustic: 0.32, dance: 0.55, tempo: 110 },
    high: { fams: ["rock", "metal", "hip hop", "dance", "electronic"], energy: 0.88, acoustic: 0.05, dance: 0.72, tempo: 138 },
  }[bucket];
  return Array.from({ length: count }, (_, i) => {
    const idx = i + offset;
    const fam = spec.fams[idx % spec.fams.length]!;
    return {
      trackId: `${bucket}-${idx}`,
      artistName: `${bucket} Artist ${idx % 16}`,
      genrePrimary: fam,
      genreFamily: null,
      energy: spec.energy + (idx % 5) * 0.02,
      valence: 0.45 + (idx % 6) * 0.05,
      danceability: spec.dance + (idx % 3) * 0.03,
      acousticness: spec.acoustic + (idx % 3) * 0.02,
      tempo: spec.tempo + (idx % 10),
      instrumentalness: bucket === "low" ? 0.3 : 0.08,
      speechiness: fam === "hip hop" ? 0.22 : 0.06,
      releaseYear: 2014 + (idx % 10),
      bucket,
    } satisfies BenchTrack;
  });
}

const LIBRARIES: Record<string, BenchTrack[]> = {
  mellow_heavy: [...makeBucket("low", 120, 0), ...makeBucket("mid", 40, 0), ...makeBucket("high", 40, 0)],
  balanced: [...makeBucket("low", 70, 0), ...makeBucket("mid", 60, 0), ...makeBucket("high", 70, 0)],
  energetic_heavy: [...makeBucket("low", 40, 0), ...makeBucket("mid", 40, 0), ...makeBucket("high", 120, 0)],
};

function round(v: number, d = 3): number {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

function targetBucket(expected: string | undefined): EnergyBucket {
  if (expected === "high") return "high";
  if (expected === "low") return "low";
  return "mid";
}

/** Does the chosen world's energy centre match the prompt's expected energy? */
function worldEnergyMatches(worldEnergyCenter: number, expected: string | undefined): boolean {
  if (expected === "high") return worldEnergyCenter >= 0.58;
  if (expected === "low") return worldEnergyCenter <= 0.5;
  return worldEnergyCenter >= 0.42 && worldEnergyCenter <= 0.74;
}

function evaluate(prompt: (typeof PLAYLIST_BENCHMARK_PROMPTS)[number], libraryName: string, library: BenchTrack[]) {
  const profile = analyzeVibe(prompt.prompt);
  const lockedIntent = buildLockedIntent(prompt.prompt);
  const collapsed = collapseIntent({
    vibe: prompt.prompt,
    lockedIntent,
    profile,
    libraryTracks: library,
    targetCount: 25,
  });
  const calibrated = calibrateIntentVectorForRetrievalPool(library, collapsed.intent, { targetCount: 25 });
  const ranked = selectRankedCandidatesForSampler(library, calibrated, { targetCount: 25, strictMode: false });
  const rejections = diagnoseIntentFilterRejectionCounts(library, calibrated);
  const survivors = ranked.selected as BenchTrack[];

  const worldEnergyCenter = (calibrated.energyRange[0] + calibrated.energyRange[1]) / 2;
  const bucket = targetBucket(prompt.expectedEnergy);
  const targetTotal = library.filter((t) => t.bucket === bucket).length;
  const targetSurvivors = survivors.filter((t) => t.bucket === bucket).length;
  const highTotal = library.filter((t) => t.bucket === "high").length;
  const highSurvivors = survivors.filter((t) => t.bucket === "high").length;

  return {
    prompt: prompt.id,
    library: libraryName,
    category: prompt.category,
    expectedEnergy: prompt.expectedEnergy ?? "medium",
    world: calibrated.editorialWorldTag,
    worldEnergyCenter: round(worldEnergyCenter, 2),
    worldEnergyMatch: worldEnergyMatches(worldEnergyCenter, prompt.expectedEnergy),
    ceiling: round(calibrated.sonicAggressionCeiling, 2),
    poolSize: survivors.length,
    targetRecall: round(targetSurvivors / Math.max(1, targetTotal)),
    // For calm prompts this is leakage (should stay low); for high prompts it is recall.
    highEnergyShareOfPool: round(highSurvivors / Math.max(1, survivors.length)),
    aggressionRejectedPct: round((rejections.aggression_cap ?? 0) / library.length),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outDir = outIdx >= 0 ? args[outIdx + 1]! : "reports/retrieval-recall/large-latest";

  const rows = PLAYLIST_BENCHMARK_PROMPTS.flatMap((p) =>
    Object.entries(LIBRARIES).map(([name, lib]) => evaluate(p, name, lib)),
  );

  const avg = (xs: number[]) => (xs.length ? round(xs.reduce((s, x) => s + x, 0) / xs.length) : 0);
  const rate = (xs: boolean[]) => (xs.length ? round(xs.filter(Boolean).length / xs.length) : 0);

  const byEnergy = (energy: string) => rows.filter((r) => r.expectedEnergy === energy);
  const summary = {
    totalEvaluations: rows.length,
    overall: {
      worldEnergyMatchRate: rate(rows.map((r) => r.worldEnergyMatch)),
      avgTargetRecall: avg(rows.map((r) => r.targetRecall)),
    },
    high: {
      count: byEnergy("high").length,
      worldEnergyMatchRate: rate(byEnergy("high").map((r) => r.worldEnergyMatch)),
      avgTargetRecall: avg(byEnergy("high").map((r) => r.targetRecall)),
      avgHighShareOfPool: avg(byEnergy("high").map((r) => r.highEnergyShareOfPool)),
    },
    medium: {
      count: byEnergy("medium").length,
      worldEnergyMatchRate: rate(byEnergy("medium").map((r) => r.worldEnergyMatch)),
      avgTargetRecall: avg(byEnergy("medium").map((r) => r.targetRecall)),
    },
    low: {
      count: byEnergy("low").length,
      worldEnergyMatchRate: rate(byEnergy("low").map((r) => r.worldEnergyMatch)),
      avgTargetRecall: avg(byEnergy("low").map((r) => r.targetRecall)),
      // Leakage: calm prompts should NOT fill up with high-energy tracks.
      avgHighLeakageShare: avg(byEnergy("low").map((r) => r.highEnergyShareOfPool)),
    },
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "large-recall.json"), `${JSON.stringify({ summary, rows }, null, 2)}\n`);

  console.log("=== Large Retrieval Recall Benchmark (48 prompts x 3 libraries) ===\n");
  console.log("Overall world-energy match rate:", summary.overall.worldEnergyMatchRate);
  console.log("Overall avg target-energy recall:", summary.overall.avgTargetRecall);
  console.log("");
  console.log("HIGH-energy prompts:  worldMatch=", summary.high.worldEnergyMatchRate, " targetRecall=", summary.high.avgTargetRecall, " highShareOfPool=", summary.high.avgHighShareOfPool);
  console.log("MEDIUM-energy prompts: worldMatch=", summary.medium.worldEnergyMatchRate, " targetRecall=", summary.medium.avgTargetRecall);
  console.log("LOW-energy prompts:   worldMatch=", summary.low.worldEnergyMatchRate, " targetRecall=", summary.low.avgTargetRecall, " highLeakage=", summary.low.avgHighLeakageShare);
  console.log(`\nWrote ${path.join(outDir, "large-recall.json")}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
