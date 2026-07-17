/**
 * Phase 1 interpretation failure dataset.
 *
 * For every benchmark prompt, records what the interpreter actually derives —
 * analyzeVibe() continuous energy/valence and buildLockedIntent() discrete
 * energy/activity — versus the prompt's expected energy DIRECTION. This isolates
 * interpretation errors *before* retrieval/world-selection, so fixes target the
 * real cause (how the human moment is read) rather than downstream symptoms.
 *
 * Usage:
 *   node backend/dist/scripts/interpretation-energy-audit.js --out reports/interpretation/before
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeVibe } from "../lib/emotion";
import { buildLockedIntent } from "../core/v3/intent";
import { computeInterpretationConfidence } from "../lib/interpretation-confidence";
import { PLAYLIST_BENCHMARK_PROMPTS } from "../lib/playlist-evaluation/benchmark-prompts";

type Bucket = "low" | "medium" | "high";

/** Discrete energy the pipeline effectively uses (mirrors energyRangeForIntent). */
function effectiveEnergy(lockedEnergy: string | null, profileEnergy: number): Bucket {
  if (lockedEnergy === "low" || lockedEnergy === "high" || lockedEnergy === "medium") {
    return lockedEnergy;
  }
  if (profileEnergy < 0.42) return "low";
  if (profileEnergy > 0.62) return "high";
  return "medium";
}

function severity(expected: Bucket, got: Bucket): "none" | "adjacent" | "inversion" {
  if (expected === got) return "none";
  if ((expected === "high" && got === "low") || (expected === "low" && got === "high")) return "inversion";
  return "adjacent";
}

function round(v: number, d = 3): number {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outDir = outIdx >= 0 ? args[outIdx + 1]! : "reports/interpretation/latest";

  const rows = PLAYLIST_BENCHMARK_PROMPTS.filter((p) => p.expectedEnergy).map((p) => {
    const profile = analyzeVibe(p.prompt);
    const locked = buildLockedIntent(p.prompt);
    const confidence = computeInterpretationConfidence(p.prompt, profile);
    const expected = p.expectedEnergy as Bucket;
    const got = effectiveEnergy(locked.energy, profile.energy);
    return {
      id: p.id,
      category: p.category,
      prompt: p.prompt,
      expectedEnergy: expected,
      lockedEnergy: locked.energy,
      profileEnergy: round(profile.energy, 2),
      profileValence: round(profile.valence, 2),
      effectiveEnergy: got,
      severity: severity(expected, got),
      activity: locked.activity,
      energyConfidence: round(confidence.energy, 2),
      energyUncertain: confidence.energyUncertain,
    };
  });

  const total = rows.length;
  const correct = rows.filter((r) => r.severity === "none").length;
  const inversions = rows.filter((r) => r.severity === "inversion");
  const adjacent = rows.filter((r) => r.severity === "adjacent");
  const falseHigh = rows.filter((r) => r.effectiveEnergy === "high" && r.expectedEnergy !== "high");
  const falseLow = rows.filter((r) => r.effectiveEnergy === "low" && r.expectedEnergy !== "low");
  // False confidence: wrong energy read yet asserted with high certainty. This is
  // the metric Phase 4 must NOT worsen — honest uncertainty is the goal.
  const wrong = rows.filter((r) => r.severity !== "none");
  const falseConfidence = wrong.filter((r) => r.energyConfidence >= 0.5);
  const correctRows = rows.filter((r) => r.severity === "none");

  const summary = {
    total,
    energyAccuracy: round(correct / total),
    inversions: inversions.length,
    adjacentErrors: adjacent.length,
    falseHighAssignments: falseHigh.length,
    falseLowAssignments: falseLow.length,
    falseConfidentErrors: falseConfidence.length,
    avgConfidenceWhenWrong: round(
      wrong.reduce((s, r) => s + r.energyConfidence, 0) / Math.max(1, wrong.length),
    ),
    avgConfidenceWhenCorrect: round(
      correctRows.reduce((s, r) => s + r.energyConfidence, 0) / Math.max(1, correctRows.length),
    ),
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "interpretation-energy.json"), `${JSON.stringify({ summary, rows }, null, 2)}\n`);

  console.log("=== Interpretation Energy Audit ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log("\n--- ENERGY INVERSIONS (expected high<->low) ---");
  for (const r of inversions) {
    console.log(`${r.id.padEnd(24)} exp=${r.expectedEnergy.padEnd(6)} got=${r.effectiveEnergy.padEnd(6)} locked=${String(r.lockedEnergy)} pE=${r.profileEnergy}  "${r.prompt}"`);
  }
  console.log(`\nWrote ${path.join(outDir, "interpretation-energy.json")}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
