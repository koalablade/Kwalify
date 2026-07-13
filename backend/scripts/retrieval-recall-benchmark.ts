/**
 * Offline retrieval-recall benchmark for the V3 intent-collapse path.
 *
 * The live 30-prompt harness (`playlist-evaluation-harness.ts`) needs a running
 * API + the user's synced Spotify library, so it cannot produce before/after
 * evidence in a headless environment. This script instead drives the exact
 * stages that were suspected of dropping good candidates — editorial world
 * selection, sonic-constraint calibration, and the intent hard-filter — against
 * a fixed, representative mixed library. It is deterministic, so running it on
 * the pre-fix build and again on the post-fix build yields a clean comparison of
 * how many genuinely-appropriate candidates survive retrieval.
 *
 * Usage:
 *   node backend/dist/scripts/retrieval-recall-benchmark.js --out reports/retrieval-recall/baseline
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
import type { LockedIntent } from "../core/v3/intent";
import type { EmotionProfile } from "../lib/emotion";

type BenchTrack = IntentCollapseTrack & { highEnergy: boolean };

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Mirror of intent-collapse-layer's private sonicAggression() for measurement. */
function sonicAggressionOf(track: IntentCollapseTrack): number {
  const energy = track.energy ?? 0.5;
  const acoustic = track.acousticness ?? 0.5;
  const dance = track.danceability ?? 0.5;
  return clamp01(energy * (1 - acoustic) * (0.5 + dance * 0.5));
}

function mellowTracks(count: number): BenchTrack[] {
  const families = ["indie folk", "indie rock", "singer-songwriter", "acoustic pop"];
  return Array.from({ length: count }, (_, i) => ({
    trackId: `mellow-${i}`,
    artistName: `Mellow Artist ${i % 18}`,
    genrePrimary: families[i % families.length]!,
    genreFamily: null,
    energy: 0.34 + (i % 6) * 0.03,
    valence: 0.40 + (i % 5) * 0.05,
    danceability: 0.34 + (i % 4) * 0.03,
    acousticness: 0.58 + (i % 4) * 0.04,
    tempo: 88 + (i % 12),
    instrumentalness: 0.15,
    speechiness: 0.05,
    releaseYear: 2015 + (i % 8),
    highEnergy: false,
  }));
}

function highEnergyTracks(count: number): BenchTrack[] {
  // A curator building "peak gym session" would absolutely reach for these.
  const rows = [
    { fam: "rock", dance: 0.62, tempo: 148 },
    { fam: "metal", dance: 0.55, tempo: 156 },
    { fam: "hip hop", dance: 0.78, tempo: 140 },
    { fam: "dance", dance: 0.82, tempo: 128 },
    { fam: "electronic", dance: 0.80, tempo: 132 },
  ];
  return Array.from({ length: count }, (_, i) => {
    const row = rows[i % rows.length]!;
    return {
      trackId: `hype-${i}`,
      artistName: `Hype Artist ${i % 14}`,
      genrePrimary: row.fam,
      genreFamily: null,
      energy: 0.85 + (i % 4) * 0.03,
      valence: 0.52 + (i % 5) * 0.05,
      danceability: row.dance,
      acousticness: 0.04 + (i % 3) * 0.02,
      tempo: row.tempo + (i % 6),
      instrumentalness: 0.05,
      speechiness: row.fam === "hip hop" ? 0.24 : 0.07,
      releaseYear: 2016 + (i % 9),
      highEnergy: true,
    } satisfies BenchTrack;
  });
}

type BenchPrompt = {
  id: string;
  vibe: string;
  energy: "low" | "medium" | "high";
  activity: string | null;
  profile: EmotionProfile;
  /** true = a great curator would fill this mostly with high-energy tracks. */
  wantsHighEnergy: boolean;
};

function profile(energy: number, valence: number, tension: number, calm: number): EmotionProfile {
  return { energy, valence, tension, nostalgia: 0.2, calm, environment: null, timeOfDay: null, motionState: null };
}

const PROMPTS: BenchPrompt[] = [
  { id: "gym-peak", vibe: "peak gym session heavy lifting maximum intensity", energy: "high", activity: "gym", profile: profile(0.9, 0.68, 0.45, 0.08), wantsHighEnergy: true },
  { id: "running", vibe: "high energy running workout cardio push", energy: "high", activity: "gym", profile: profile(0.88, 0.7, 0.4, 0.1), wantsHighEnergy: true },
  { id: "aggressive-lift", vibe: "aggressive rage heavy metal workout pump", energy: "high", activity: "gym", profile: profile(0.92, 0.5, 0.6, 0.05), wantsHighEnergy: true },
  { id: "festival", vibe: "euphoric festival dancefloor rave hands up", energy: "high", activity: "party", profile: profile(0.9, 0.8, 0.3, 0.08), wantsHighEnergy: true },
  { id: "hype-party", vibe: "hype party pregame turn up loud", energy: "high", activity: "party", profile: profile(0.87, 0.78, 0.35, 0.1), wantsHighEnergy: true },
  // Controls: a great curator would NOT fill these with high-energy tracks.
  { id: "sleep", vibe: "ambient music for falling asleep gentle", energy: "low", activity: null, profile: profile(0.18, 0.42, 0.1, 0.9), wantsHighEnergy: false },
  { id: "reading", vibe: "quiet rainy evening reading calm", energy: "low", activity: null, profile: profile(0.28, 0.5, 0.15, 0.75), wantsHighEnergy: false },
];

function lockedIntentFor(prompt: BenchPrompt): LockedIntent {
  return {
    genreFamilies: [],
    primaryGenre: null,
    primarySubgenre: null,
    secondarySubgenre: null,
    subgenreTerms: [],
    eraRange: null,
    mood: [],
    activity: prompt.activity,
    energy: prompt.energy,
  };
}

function round(value: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function evaluate(prompt: BenchPrompt, library: BenchTrack[]) {
  const lockedIntent = lockedIntentFor(prompt);
  const collapsed = collapseIntent({
    vibe: prompt.vibe,
    lockedIntent,
    profile: prompt.profile,
    libraryTracks: library,
    targetCount: 25,
  });
  const calibrated = calibrateIntentVectorForRetrievalPool(library, collapsed.intent, { targetCount: 25 });
  const ranked = selectRankedCandidatesForSampler(library, calibrated, { targetCount: 25, strictMode: false });
  const rejections = diagnoseIntentFilterRejectionCounts(library, calibrated);

  const survivors = ranked.selected as BenchTrack[];
  const highEnergyTotal = library.filter((t) => t.highEnergy).length;
  const highEnergySurvivors = survivors.filter((t) => t.highEnergy).length;

  // Aggression-loss specifics (as requested by the retrieval-recall spec).
  const ceiling = calibrated.sonicAggressionCeiling;
  const overCeiling = library.filter(
    (t) => sonicAggressionOf(t) > ceiling + 0.12,
  );
  const aggressionRejectedCount = rejections.aggression_cap;
  const preFilter = library.length;
  const aggressionRejectedPercentage = round(aggressionRejectedCount / Math.max(1, preFilter));
  const dominantRejection = (Object.entries(rejections) as Array<[string, number]>)
    .filter(([reason]) => reason !== "passed")
    .sort((a, b) => b[1] - a[1])[0] ?? ["none", 0];
  const aggressionLossWasDominant = dominantRejection[0] === "aggression_cap" && dominantRejection[1] > 0;
  const aggressionLossSeverity = aggressionRejectedPercentage >= 0.25
    ? "high"
    : aggressionRejectedPercentage >= 0.1
      ? "moderate"
      : aggressionRejectedPercentage > 0
        ? "low"
        : "none";

  return {
    prompt: prompt.id,
    vibe: prompt.vibe,
    wantsHighEnergy: prompt.wantsHighEnergy,
    editorialWorldTag: calibrated.editorialWorldTag,
    collapseConfidence: round(collapsed.collapseConfidenceScore),
    energyRange: [round(calibrated.energyRange[0], 2), round(calibrated.energyRange[1], 2)],
    sonicAggressionCeiling: round(ceiling, 3),
    libraryTotal: preFilter,
    poolSize: survivors.length,
    poolLossPercentage: round((preFilter - survivors.length) / preFilter),
    highEnergyTotal,
    highEnergySurvivors,
    highEnergyRecall: round(highEnergySurvivors / Math.max(1, highEnergyTotal)),
    rejections,
    dominantRejectionReason: dominantRejection[0],
    aggressionRejectedCount,
    aggressionRejectedPercentage,
    aggressionExceedingCeiling: overCeiling.length,
    aggressionLossSeverity,
    aggressionLossWasDominant,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outDir = outIdx >= 0 ? args[outIdx + 1]! : "reports/retrieval-recall/latest";
  const library = [...mellowTracks(120), ...highEnergyTracks(80)];
  const rows = PROMPTS.map((prompt) => evaluate(prompt, library));

  const highEnergyPrompts = rows.filter((r) => r.wantsHighEnergy);
  const controlPrompts = rows.filter((r) => !r.wantsHighEnergy);
  const avg = (xs: number[]) => (xs.length ? round(xs.reduce((s, x) => s + x, 0) / xs.length) : 0);

  const summary = {
    libraryComposition: { mellow: 120, highEnergy: 80 },
    highEnergyPrompts: {
      count: highEnergyPrompts.length,
      avgHighEnergyRecall: avg(highEnergyPrompts.map((r) => r.highEnergyRecall)),
      avgPoolSize: avg(highEnergyPrompts.map((r) => r.poolSize)),
      avgAggressionRejectedPct: avg(highEnergyPrompts.map((r) => r.aggressionRejectedPercentage)),
      worldsChosen: highEnergyPrompts.map((r) => `${r.prompt}:${r.editorialWorldTag}`),
    },
    controlPrompts: {
      count: controlPrompts.length,
      avgHighEnergyRecall: avg(controlPrompts.map((r) => r.highEnergyRecall)),
      avgPoolSize: avg(controlPrompts.map((r) => r.poolSize)),
      worldsChosen: controlPrompts.map((r) => `${r.prompt}:${r.editorialWorldTag}`),
    },
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "retrieval-recall.json"), `${JSON.stringify({ summary, rows }, null, 2)}\n`);

  console.log("=== Retrieval Recall Benchmark ===");
  console.log(`Library: 120 mellow + 80 high-energy (40% high-energy)\n`);
  for (const r of rows) {
    console.log(
      `${r.prompt.padEnd(15)} world=${String(r.editorialWorldTag).padEnd(28)} ceil=${r.sonicAggressionCeiling.toFixed(2)} ` +
      `pool=${String(r.poolSize).padStart(3)} hiRecall=${(r.highEnergyRecall * 100).toFixed(0).padStart(3)}% ` +
      `aggRej=${(r.aggressionRejectedPercentage * 100).toFixed(0).padStart(3)}% dom=${r.dominantRejectionReason}` +
      (r.wantsHighEnergy ? "  [wants high energy]" : "  [control: wants calm]"),
    );
  }
  console.log("");
  console.log("High-energy prompts avg high-energy recall:", summary.highEnergyPrompts.avgHighEnergyRecall);
  console.log("Control prompts avg high-energy recall (should stay LOW):", summary.controlPrompts.avgHighEnergyRecall);
  console.log(`\nWrote ${path.join(outDir, "retrieval-recall.json")}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
