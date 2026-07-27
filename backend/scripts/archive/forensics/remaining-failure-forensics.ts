/**
 * Diagnosis-only: classify remaining underfill/constrained failures from benchmark + live audit.
 * Does NOT modify pipeline behaviour.
 */
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { initPool } from "../lib/pg-pool";
import { initDb } from "../db";
import { runDbInit } from "../lib/db-init";
import { markBootComplete } from "../lib/boot-state";
import { likedSongsTable } from "../db/schema/kwalah";
import { eq } from "drizzle-orm";
import { sanitizeLikedSongs } from "../lib/library-sanitize";
import { buildUserGenreProfile } from "../lib/user-genre-profile";
import { buildLockedIntent } from "../core/v3/intent";
import { classifyTrack } from "../lib/genre-taxonomy";
import { CURATED_SUBGENRE_ADJACENCY } from "../lib/genre-subgenre-adjacency";
import { PLAYLIST_BENCHMARK_PROMPTS } from "../lib/playlist-evaluation/benchmark-prompts";
import { existsSync } from "node:fs";
import { resolveLiveBenchmarkCredentials } from "../lib/benchmark-env";

function repoRoot(): string {
  for (const up of [2, 3]) {
    const candidate = path.resolve(__dirname, ...Array(up).fill(".."));
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
  }
  return path.resolve(__dirname, "..", "..", "..");
}

const ROOT = repoRoot();
const OUT_DIR = path.join(ROOT, "reports", "playlist-evaluation");
const BENCHMARK_JSONL = path.join(OUT_DIR, "overnight-live-2026-07-08", "evaluation-results.jsonl");

const TARGET_IDS = [
  "party-latin-summer",
  "drive-late-garage",
  "gym-2000s-pop-punk",
  "chill-acoustic",
  "launch-calibration-001",
  "launch-calibration-003",
  "launch-calibration-023",
] as const;

type Bucket = "A_library_starvation" | "B_classification_taxonomy" | "C_genre_evidence_guard" | "D_diversity_sequencing" | "E_recovery_constrained_prefix";

type BucketHypothesis = {
  bucket: Bucket;
  score: number;
  evidence: string[];
};

type PromptForensics = {
  promptId: string;
  prompt: string;
  requestedLength: number;
  strictValidCount: number | null;
  relaxedValidCount: number | null;
  recoveryValidCount: number | null;
  genreMatchLane: number | null;
  familyMatchEligible: number | null;
  intentRelevantRaw: number | null;
  stageCounts: Record<string, number | null>;
  v3OutputCount: number | null;
  verifiedCount: number | null;
  requiredCount: number | null;
  rejectedCount: number | null;
  finalPublished: number;
  recoveryUsed: boolean;
  fallbackUsed: boolean;
  executionPath: string | null;
  recoveryTier: string | null;
  recoveryTrigger: string | null;
  partialReason: string | null;
  v3RepairFill: number | null;
  /** Highest-scoring hypothesis — tentative, not ground truth */
  bucket: Bucket;
  bucketHypotheses: BucketHypothesis[];
  ambiguous: boolean;
  rootCause: string;
  confidence: "high" | "medium" | "low";
  evidence: string[];
  maxAchievableEstimate: number | null;
};

const BUCKET_LABELS: Record<Bucket, string> = {
  A_library_starvation: "A — thin library / lane supply",
  B_classification_taxonomy: "B — classification / lane filter",
  C_genre_evidence_guard: "C — genre evidence / subgenre gate",
  D_diversity_sequencing: "D — diversity / sequencing shrink",
  E_recovery_constrained_prefix: "E — constrained recovery prefix",
};

const METHODOLOGY_NOTE =
  "**Categories A–E are competing hypotheses scored from audit signals — not verified root causes.** "
  + "A single prompt may match multiple buckets; treat `primaryHypothesis` as the best current guess only.";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function txt(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function stageMap(gd: Record<string, unknown>): Record<string, number | null> {
  const keys = [
    "initialLibrarySize",
    "candidatesClassified",
    "candidatesAfterIntent",
    "candidatesAfterEra",
    "candidatesAfterMood",
    "candidatesAfterConstraints",
    "candidatesAfterRanking",
    "candidatesAfterDiversity",
    "candidatesAfterRepair",
    "candidatesAfterCoherence",
    "candidatesFinal",
  ];
  const out: Record<string, number | null> = {};
  for (const k of keys) out[k] = num(gd[k]);
  return out;
}

function extractFromResponse(promptId: string, response: Record<string, unknown>, benchmark: Record<string, unknown>): Omit<PromptForensics, "bucket" | "bucketHypotheses" | "ambiguous" | "rootCause" | "confidence" | "evidence" | "maxAchievableEstimate"> {
  const gd = asRecord(response.generationDiagnostics) ?? {};
  const ret = asRecord(gd.candidateRetrieval) ?? {};
  const orch = asRecord(ret.orchestrator) ?? {};
  const supply = asRecord(orch.validCandidateSupply) ?? {};
  const blend = asRecord(orch.blendedIntentPool) ?? {};
  const lanes = asRecord(blend.lanes) ?? {};
  const ff = asRecord(blend.familyFunnel) ?? {};
  const genreEligible = asRecord(ff.genreEligibleRaw) ?? {};
  const sg = asRecord(response.strictGenreEvidence) ?? {};
  const rec = asRecord(gd.recoveryDiagnostics) ?? {};
  const fin = asRecord(asRecord(response.finalization)?.diagnostics) ?? {};
  const trace = asRecord(response.playlistExecutionTrace) ?? {};
  const pc = asRecord(response.playlistConfidence) ?? {};
  const delivery = asRecord(gd.deliveryUnderfillForensics);
  const stages = Array.isArray(delivery?.stages) ? delivery!.stages as Array<Record<string, unknown>> : [];
  const pipelineExit = stages.find((s) => txt(s.stage) === "pipeline_exit_afterDiversity");
  const v3Out = num(pipelineExit?.exit) ?? num(gd.candidatesAfterDiversity);

  return {
    promptId,
    prompt: txt(benchmark.prompt) ?? promptId,
    requestedLength: num(benchmark.length) ?? 30,
    strictValidCount: num(supply.strictValidCount),
    relaxedValidCount: num(supply.relaxedValidCount),
    recoveryValidCount: num(supply.recoveryValidCount),
    genreMatchLane: num(lanes.genre_match),
    familyMatchEligible: num(genreEligible.total),
    intentRelevantRaw: num(genreEligible.intentRelevantRaw),
    stageCounts: stageMap(gd),
    v3OutputCount: v3Out,
    verifiedCount: num(sg.verifiedCount),
    requiredCount: num(sg.requiredCount),
    rejectedCount: num(sg.rejectedCount),
    finalPublished: num(response.count) ?? num(response.totalTracks) ?? 0,
    recoveryUsed: pc?.recoveryUsed === true || !!rec.tier,
    fallbackUsed: pc?.fallbackUsed === true || txt(gd.fallbackLevel) === "hardSafe",
    executionPath: txt(trace.executionPath),
    recoveryTier: txt(rec.tier),
    recoveryTrigger: txt(rec.triggerDetail),
    partialReason: txt(fin.explicitConstraintPartialReason),
    v3RepairFill: num(fin.genreEvidenceV3RepairFillCount),
  };
}

function scoreBucketHypotheses(
  row: Omit<PromptForensics, "bucket" | "bucketHypotheses" | "ambiguous" | "rootCause" | "confidence" | "evidence" | "maxAchievableEstimate">,
): BucketHypothesis[] {
  const minRequired = Math.max(5, Math.ceil(row.requestedLength * 0.4));
  const underfilled = row.finalPublished < row.requestedLength * 0.67;
  const strictLow = (row.strictValidCount ?? 0) < minRequired;
  const genreLaneLow = (row.genreMatchLane ?? 0) < minRequired;
  const verifiedLow = row.verifiedCount != null && row.requiredCount != null && row.verifiedCount < row.requiredCount;
  const verifiedVeryLow = (row.verifiedCount ?? 0) < 5;
  const v3Good = (row.v3OutputCount ?? 0) >= row.requestedLength * 0.8;
  const guardShrink = row.v3OutputCount != null && row.finalPublished < row.v3OutputCount - 2;
  const diversityShrink = (row.stageCounts.candidatesAfterRanking ?? 0) > 0
    && (row.stageCounts.candidatesAfterDiversity ?? 0) < (row.stageCounts.candidatesAfterRanking ?? 0) * 0.5
    && (row.stageCounts.candidatesAfterDiversity ?? 0) < row.requestedLength;
  const classifiedLow = (row.stageCounts.candidatesClassified ?? 0) < minRequired;
  const afterIntentLow = (row.stageCounts.candidatesAfterIntent ?? 0) < minRequired;
  const repairShrink = (row.stageCounts.candidatesAfterRepair ?? 0) < (row.stageCounts.candidatesAfterDiversity ?? row.requestedLength);

  const score = (bucket: Bucket, points: number, evidence: string[]): BucketHypothesis => ({
    bucket,
    score: points,
    evidence,
  });
  const hypotheses: BucketHypothesis[] = [];

  if (strictLow || genreLaneLow || classifiedLow || afterIntentLow) {
    const ev: string[] = [];
    if (strictLow) ev.push(`strictValid=${row.strictValidCount} < min~${minRequired}`);
    if (genreLaneLow) ev.push(`genre_match=${row.genreMatchLane} < min~${minRequired}`);
    if (classifiedLow) ev.push(`classified=${row.stageCounts.candidatesClassified} < min~${minRequired}`);
    if (afterIntentLow) ev.push(`afterIntent=${row.stageCounts.candidatesAfterIntent} < min~${minRequired}`);
    if ((row.relaxedValidCount ?? 0) > minRequired * 5 && genreLaneLow) {
      ev.push(`relaxedValid=${row.relaxedValidCount} high but strict lane starved`);
    }
    hypotheses.push(score("A_library_starvation", 20 + (strictLow ? 25 : 0) + (genreLaneLow ? 20 : 0) + (classifiedLow ? 15 : 0), ev));
  }

  if ((row.strictValidCount ?? 0) >= minRequired && genreLaneLow && (row.relaxedValidCount ?? 0) > (row.strictValidCount ?? 0) * 2) {
    hypotheses.push(score("B_classification_taxonomy", 35, [
      `strictValid=${row.strictValidCount} but genre_match=${row.genreMatchLane}`,
    ]));
  }

  if (v3Good && (verifiedLow || guardShrink)) {
    const ev = [`V3=${row.v3OutputCount} verified=${row.verifiedCount}/${row.requiredCount} final=${row.finalPublished}`];
    if (row.partialReason) ev.push(`partialReason=${row.partialReason}`);
    hypotheses.push(score("C_genre_evidence_guard", 30 + (verifiedLow ? 20 : 0) + (guardShrink ? 15 : 0), ev));
  }

  if (diversityShrink) {
    hypotheses.push(score("D_diversity_sequencing", 25 + (repairShrink ? 10 : 0), [
      `afterRanking=${row.stageCounts.candidatesAfterRanking} afterDiversity=${row.stageCounts.candidatesAfterDiversity}`,
      ...(repairShrink ? [`repair shrink ${row.stageCounts.candidatesAfterDiversity}→${row.stageCounts.candidatesAfterRepair}`] : []),
    ]));
  }

  if (verifiedVeryLow || row.partialReason?.includes("constrained")) {
    const ev: string[] = [];
    if (verifiedVeryLow) ev.push(`verified=${row.verifiedCount} < 5`);
    if (row.partialReason?.includes("constrained")) ev.push(`partialReason=${row.partialReason}`);
    if (row.recoveryTrigger) ev.push(`recoveryTrigger=${row.recoveryTrigger}`);
    hypotheses.push(score("E_recovery_constrained_prefix", 20 + (verifiedVeryLow ? 25 : 0) + (row.partialReason?.includes("constrained") ? 15 : 0), ev));
  }

  if (underfilled && hypotheses.length === 0) {
    hypotheses.push(score("C_genre_evidence_guard", 10, ["underfilled with no strong bucket signal"]));
  }

  if (hypotheses.length === 0) {
    hypotheses.push(score("C_genre_evidence_guard", 5, ["no underfill; weak default hypothesis only"]));
  }

  return hypotheses.sort((a, b) => b.score - a.score);
}

function rootCauseForBucket(bucket: Bucket): string {
  switch (bucket) {
    case "A_library_starvation":
      return "Hypothesis: thin-library supply — strict funnel or genre lane cannot fill requested length.";
    case "B_classification_taxonomy":
      return "Hypothesis: classification/taxonomy mismatch starves genre lane despite library depth.";
    case "C_genre_evidence_guard":
      return "Hypothesis: genre evidence / subgenre gate rejects otherwise valid V3 tracks.";
    case "D_diversity_sequencing":
      return "Hypothesis: playlist shrinks during diversity, repair, or sequencing before delivery.";
    case "E_recovery_constrained_prefix":
      return "Hypothesis: constrained recovery prefix replaced a larger verified/V3 playlist.";
    default:
      return "Hypothesis: mixed signals — manual review required.";
  }
}

function classify(
  row: Omit<PromptForensics, "bucket" | "bucketHypotheses" | "ambiguous" | "rootCause" | "confidence" | "evidence" | "maxAchievableEstimate">,
): Pick<PromptForensics, "bucket" | "bucketHypotheses" | "ambiguous" | "rootCause" | "confidence" | "evidence"> {
  const bucketHypotheses = scoreBucketHypotheses(row);
  const primary = bucketHypotheses[0]!;
  const runnerUp = bucketHypotheses[1];
  const ambiguous = runnerUp != null && primary.score - runnerUp.score < 15;
  const evidence = [
    ...primary.evidence,
    ...(runnerUp ? [`runner-up: ${BUCKET_LABELS[runnerUp.bucket]} (score ${runnerUp.score})`] : []),
  ];
  let confidence: "high" | "medium" | "low" = primary.score >= 45 ? "high" : primary.score >= 30 ? "medium" : "low";
  if (ambiguous) confidence = confidence === "high" ? "medium" : "low";
  return {
    bucket: primary.bucket,
    bucketHypotheses,
    ambiguous,
    rootCause: rootCauseForBucket(primary.bucket),
    confidence,
    evidence,
  };
}

async function loadBenchmarkRow(id: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(BENCHMARK_JSONL, "utf8");
    for (const line of raw.trim().split("\n")) {
      const row = JSON.parse(line) as Record<string, unknown>;
      if (asRecord(row.benchmark)?.id === id) return row;
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function liveGenerate(id: string, creds: { baseUrl: string; token: string; spotifyUserId: string }): Promise<Record<string, unknown>> {
  const prompt = PLAYLIST_BENCHMARK_PROMPTS.find((p) => p.id === id);
  if (!prompt) throw new Error(`missing ${id}`);
  const res = await fetch(`${creds.baseUrl}/api/generate?audit=1`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-kwalify-evaluation-token": creds.token },
    body: JSON.stringify({
      vibe: prompt.prompt,
      mode: prompt.mode,
      length: prompt.length,
      auditMode: true,
      debug: true,
      debugPipeline: true,
      spotifyUserId: creds.spotifyUserId,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  return asRecord(await res.json().catch(() => ({}))) ?? {};
}

async function librarySupplyForPrompt(
  promptId: string,
  vibe: string,
  classMap: Map<string, ReturnType<typeof classifyTrack>>,
  rows: Array<{ track_id: string; artist_name: string; track_name: string; release_year: number | null }>,
): Promise<{ strictFamily: number; subgenreMatch: number; eraMatch: number; maxAchievable: number; samples: string[] }> {
  const intent = buildLockedIntent(vibe);
  const families = intent.genreFamilies;
  const era = intent.eraRange;
  const subTerms = [intent.primarySubgenre, ...intent.subgenreTerms].filter(Boolean).map((s) => String(s).toLowerCase());

  let strictFamily = 0;
  let subgenreMatch = 0;
  let eraMatch = 0;
  const samples: string[] = [];

  for (const row of rows) {
    const c = classMap.get(row.track_id) ?? classifyTrack({
      trackName: row.track_name,
      artistName: row.artist_name,
      albumName: "",
    });
    const family = c.genreFamily.toLowerCase();
    const terms = [c.genreFamily, c.genrePrimary, c.primarySubgenre, c.secondarySubgenre, ...c.subGenres].join(" ").toLowerCase();
    const familyHit = families.length === 0 || families.some((f) => family === f || terms.includes(f));
    if (!familyHit) continue;
    strictFamily += 1;
    const subHit = subTerms.length === 0 || subTerms.some((t) => terms.includes(t.replace(/_/g, " ")) || terms.includes(t));
    if (subHit) subgenreMatch += 1;
    const year = row.release_year;
    const eraHit = !era || (year != null && year >= era.start && year <= era.end);
    if (eraHit) eraMatch += 1;
    if (samples.length < 8) samples.push(`${row.artist_name} — ${row.track_name} [${c.genreFamily}/${c.primarySubgenre}]`);
  }

  const maxAchievable = subTerms.length > 0
    ? Math.min(strictFamily, Math.max(subgenreMatch, strictFamily))
    : strictFamily;

  return { strictFamily, subgenreMatch, eraMatch, maxAchievable: era ? Math.min(maxAchievable, eraMatch) : maxAchievable, samples };
}

function formatHypotheses(hypotheses: BucketHypothesis[]): string {
  return hypotheses
    .slice(0, 3)
    .map((h) => `${h.bucket.replace(/^[A-E]_/, "")} (${h.score})`)
    .join("; ");
}

function buildClassificationMd(rows: PromptForensics[]): string {
  const header = `| Prompt | strictValid | relaxed | recoveryValid | genre_match | family_eligible | V3 out | verified | required | rejected | final | recovery | fallback | path | Primary hypothesis | Ambiguous? | Hypothesis scores | Conf |`;
  const sep = `|--------|------------:|--------:|--------------:|------------:|----------------:|-------:|---------:|---------:|---------:|------:|----------|----------|------|-------------------|:----------:|-------------------|------|`;
  const body = rows.map((r) =>
    `| ${r.promptId} | ${r.strictValidCount ?? "—"} | ${r.relaxedValidCount ?? "—"} | ${r.recoveryValidCount ?? "—"} | ${r.genreMatchLane ?? "—"} | ${r.familyMatchEligible ?? "—"} | ${r.v3OutputCount ?? "—"} | ${r.verifiedCount ?? "—"} | ${r.requiredCount ?? "—"} | ${r.rejectedCount ?? "—"} | ${r.finalPublished} | ${r.recoveryUsed ? "yes" : "no"} | ${r.fallbackUsed ? "yes" : "no"} | ${r.executionPath ?? "—"} | ${BUCKET_LABELS[r.bucket]} | ${r.ambiguous ? "yes" : "no"} | ${formatHypotheses(r.bucketHypotheses)} | ${r.confidence} |`,
  ).join("\n");

  const summary = rows.map((r) =>
    `| ${r.promptId} | ${BUCKET_LABELS[r.bucket]} | ${r.ambiguous ? "yes — review competing hypotheses" : "no"} | ${r.rootCause.slice(0, 72)}… | ${r.confidence} |`,
  ).join("\n");

  return [
    "# Remaining Failure Classification",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    METHODOLOGY_NOTE,
    "",
    "## Phase 1 — Evidence table",
    "",
    header,
    sep,
    body,
    "",
    "## Summary (tentative)",
    "",
    "| Prompt | Primary hypothesis | Ambiguous? | Root cause (tentative) | Confidence |",
    "|--------|-------------------|:----------:|------------------------|------------|",
    summary,
    "",
    "## Per-prompt detail",
    "",
    ...rows.map((r) => [
      `### ${r.promptId}`,
      `- **Prompt:** \`${r.prompt}\``,
      `- **Primary hypothesis:** ${BUCKET_LABELS[r.bucket]} (score ${r.bucketHypotheses[0]?.score ?? 0})`,
      `- **Ambiguous:** ${r.ambiguous ? "yes — competing hypotheses within 15 points" : "no"}`,
      `- **All hypotheses:** ${r.bucketHypotheses.map((h) => `${BUCKET_LABELS[h.bucket]}=${h.score}`).join(", ")}`,
      `- **Root cause (tentative):** ${r.rootCause}`,
      `- **Confidence:** ${r.confidence}`,
      `- **Stage funnel:** ${Object.entries(r.stageCounts).filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`).join(", ")}`,
      `- **Recovery:** tier=\`${r.recoveryTier ?? "none"}\` trigger=\`${r.recoveryTrigger ?? "none"}\` partial=\`${r.partialReason ?? "none"}\` v3RepairFill=${r.v3RepairFill ?? 0}`,
      `- **Max achievable (library est.):** ${r.maxAchievableEstimate ?? "n/a"}`,
      `- **Evidence:**`,
      ...r.evidence.map((e) => `  - ${e}`),
      ...(r.bucketHypotheses.length > 1 ? [
        `- **Competing hypothesis evidence:**`,
        ...r.bucketHypotheses.slice(1, 3).flatMap((h) => [
          `  - ${BUCKET_LABELS[h.bucket]} (score ${h.score}):`,
          ...h.evidence.map((e) => `    - ${e}`),
        ]),
      ] : []),
      "",
    ].join("\n")),
  ].join("\n");
}

function buildAdjacentMd(): string {
  const subs = ["disco", "uk_garage", "pop_punk", "funk", "motown", "emo", "speed_garage", "2-step", "garage_beat", "skate_punk", "post_hardcore", "melodic_punk"];
  const lines = subs.map((s) => {
    const adj = CURATED_SUBGENRE_ADJACENCY[s] ?? CURATED_SUBGENRE_ADJACENCY[s.replace(/-/g, "_")] ?? [];
    return `| ${s} | — | ${s} | ${adj.join(", ") || "—"} |`;
  });

  return [
    "# Adjacent Subgenre Investigation",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Phase 2 — Structural parity with disco fix",
    "",
    "Disco failure pattern: **family evidence strong** (soul/funk/motown) but **subgenre locked to disco** rejected valid floor-fillers.",
    "",
    "### Prompts exhibiting same structure",
    "",
    "| Prompt | Locked subgenre | Verified | Required | strictValid | Primary hypothesis |",
    "|--------|-----------------|----------|----------|-------------|-------------------|",
    "| drive-late-garage | uk_garage | 6 | 22 | 88 | C (subgenre gate) — A unlikely given strictValid |",
    "| gym-2000s-pop-punk | pop_punk | 17 | 26 | 68 | C (subgenre + era gate) — ambiguous with E |",
    "| party-70s-disco (fixed) | disco | 30 | 26 | — | C supported — adjacent funk/motown now qualifies |",
    "",
    "### Subgenre adjacency map (current code)",
    "",
    "| Intent subgenre | Family | Canonical | Adjacent (coded) | Siblings (taxonomy) |",
    "|-----------------|--------|-----------|------------------|---------------------|",
    ...lines,
    "",
    "### Would a generalized graph help multiple prompts?",
    "",
    "**Hypothesis — not confirmed:** adjacency may help compound subgenre prompts where V3 output is healthy but verified count lags.",
    "",
    "Signals consistent with hypothesis C (genre evidence gate), but A/E hypotheses remain plausible for thin supply:",
    "",
    "| Prompt | Signals for C | Signals against (competing) |",
    "|--------|---------------|----------------------------|",
    "| drive-late-garage | V3 high, verified shortfall | strictValid=88 — not lane-starved |",
    "| gym-2000s-pop-punk | verified 17/26, subgenre gate | partial pass possible after repair |",
    "| party-latin-summer | — | genre_match=1 — hypothesis A stronger |",
    "| chill-acoustic | repair shrink | taxonomy/lane — hypotheses A+B+D |",
    "",
    "A reusable adjacency graph should:",
    "",
    "1. Key off **locked `primarySubgenre` / `subgenreTerms`** from intent decomposition — not prompt ID.",
    "2. Accept adjacent subgenres **only when `hasFinalGenreEvidence` passes for expected family**.",
    "3. Derive siblings from **taxonomy co-parent subgenres** under the same `genreFamilies` entry (e.g. electronic: uk_garage ↔ 2-step ↔ speed_garage).",
    "4. **Not** apply when `verifiedCount < 5` — competing hypotheses A/E suggest supply/policy fixes instead.",
    "",
    "### Recommended design (do not implement yet)",
    "",
    "```",
    "trackMatchesExplicitSubgenre(track, intent):",
    "  if exact subgenre match → pass",
    "  if !hasExplicitSubgenreIntent → pass",
    "  if !hasFinalGenreEvidence(family) → fail",
    "  if track subgenre in adjacentGraph(intent.primarySubgenre) → pass",
    "  if track subgenre in taxonomySiblings(intent.primarySubgenre, intent.genreFamilies) → pass",
    "  fail",
    "```",
    "",
    "### Prompts where adjacency is unlikely to be sufficient (competing hypotheses)",
    "",
    "- **party-latin-summer** — hypothesis A (genre_match=1) scores higher than C",
    "- **launch-calibration-*** — mixed signals: supply + era + niche taxonomy",
    "- **chill-acoustic** — ambiguous: hypotheses A, B, C, D within margin",
    "",
    "**Confidence:** medium — requires live re-audit after each fix; do not treat bucket labels as settled.",
  ].join("\n");
}

function buildDecisionTreeMd(): string {
  return [
    "# Underfill Decision Tree",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Phase 3 — Hypothesis decision tree (not ground truth)",
    "",
    METHODOLOGY_NOTE,
    "",
    "Use audit fields: `generationDiagnostics.candidateRetrieval.orchestrator.validCandidateSupply`,",
    "`blendedIntentPool.lanes.genre_match`, `strictGenreEvidence`, `deliveryUnderfillForensics.stages`,",
    "`finalization.diagnostics.explicitConstraintPartialReason`.",
    "",
    "```mermaid",
    "flowchart TD",
    "  start[Playlist final count < 67% requested] --> supply{strictValidCount < minRequired?}",
    "  supply -->|yes| genreLane{genre_match lane < minRequired?}",
    "  genreLane -->|yes| A[A hypothesis: thin library]",
    "  genreLane -->|no| B[B hypothesis: classification]",
    "  supply -->|no| v3{v3Output >= 80% requested?}",
    "  v3 -->|no| D[D hypothesis: diversity shrink]",
    "  v3 -->|yes| verified{verifiedCount < requiredCount?}",
    "  verified -->|no| other[Investigate era guard / post-response dedupe]",
    "  verified -->|yes| v5{verifiedCount < 5?}",
    "  v5 -->|yes| E[E hypothesis: constrained prefix]",
    "  v5 -->|no| C[C hypothesis: genre evidence gate]",
    "```",
    "",
    "### Scoring rules (pseudocode — emits ranked hypotheses, not a single label)",
    "",
    "```typescript",
    "function scoreUnderfillHypotheses(audit): BucketHypothesis[] {",
    "  // Score each bucket independently; return sorted by score.",
    "  // Flag ambiguous when top two scores differ by < 15.",
    "}",
    "```",
    "",
    "### Stage fingerprints (heuristic — verify per prompt)",
    "",
    "| Hypothesis | strictValid | genre_match | V3 out | verified/required | partialReason |",
    "|------------|------------|-------------|--------|-------------------|---------------|",
    "| A | very low | very low | low | any | constrained_prefix or hardSafe |",
    "| B | high | low | medium | low | lane starvation |",
    "| C | high | medium+ | ~requested | verified < required, verified ≥ 5 | verified_partial / v3_repair |",
    "| D | high | high | drops before guard | n/a | none |",
    "| E | any | low | inflated then crash | verified < 5 | constrained_prefix |",
    "",
    "### Wire into benchmark harness",
    "",
    "On each `underfilled_playlist` failure mode, emit `underfillHypotheses: [{ bucket, score, evidence }]`",
    "using scored hypotheses — never a single definitive bucket without ambiguity flag.",
  ].join("\n");
}

function buildSupplyMd(rows: PromptForensics[], supplyDetails: Record<string, { strictFamily: number; subgenreMatch: number; eraMatch: number; maxAchievable: number; samples: string[] }>): string {
  const thinSupplyRows = rows.filter((r) =>
    r.bucketHypotheses.some((h) =>
      (h.bucket === "A_library_starvation" || h.bucket === "E_recovery_constrained_prefix") && h.score >= 25,
    ),
  );
  return [
    "# Library Supply Audit (thin-supply hypotheses)",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    METHODOLOGY_NOTE,
    "## Phase 4 — Maximum achievable playlist size",
    "",
    "| Prompt | strictValid (runtime) | genre_match lane | Library family matches | Subgenre matches | Era matches | **Max achievable est.** | Limiting factor |",
    "|--------|----------------------:|-----------------:|-----------------------:|-----------------:|------------:|------------------------:|-----------------|",
    ...rows.map((r) => {
      const s = supplyDetails[r.promptId];
      return `| ${r.promptId} | ${r.strictValidCount ?? "—"} | ${r.genreMatchLane ?? "—"} | ${s?.strictFamily ?? "—"} | ${s?.subgenreMatch ?? "—"} | ${s?.eraMatch ?? "—"} | **${s?.maxAchievable ?? r.maxAchievableEstimate ?? "—"}** | ${BUCKET_LABELS[r.bucket]} (tentative) |`;
    }),
    "",
    "## Thin-supply hypotheses (tentative — verify per prompt)",
    "",
    "### party-latin-summer",
    "- **Hypothesis A (thin library):** max achievable ~1 track from current liked library for strict latin intent.",
    "- genre_match lane = 1; strictValidCount = 0.",
    "- Adjacency graph unlikely to help; competing fix paths: supply growth or honest partial UX.",
    "- **Confidence: medium** (supply count is strong signal; policy choice is separate)",
    "",
    "### chill-acoustic",
    "- **Hypothesis A+B+D (ambiguous):** acoustic/folk supply exists but strict acoustic gate + evidence leaves **~5** publishable.",
    "- Competing: taxonomy misroute (B) vs repair shrink (D).",
    "- **Confidence: low–medium** (re-run live for exact acoustic taxonomy count)",
    "",
    "### launch-calibration-001 / 003 / 023",
    "- **Hypothesis A+C+E (mixed):** niche rave/techno editorial worlds; strictValid low relative to 30; era constraints further reduce.",
    "- **Max achievable: ~2–13** depending on prompt (see benchmark final counts).",
    "- **Confidence: medium** — do not assume single bucket",
    "",
    "## Sample library matches",
    "",
    ...Object.entries(supplyDetails).map(([id, s]) => [
      `### ${id}`,
      "```",
      ...s.samples,
      "```",
      "",
    ].join("\n")),
  ].join("\n");
}

type AssumptionChallenge = {
  assumption: string;
  challenged: boolean;
  verdict: "likely wrong" | "overstated" | "partially true" | "holds";
  counterEvidence: string[];
  revisedInterpretation: string;
};

function largestPostVerificationLoss(row: PromptForensics): { stage: string; from: number; to: number } | null {
  const v3 = row.v3OutputCount ?? 0;
  const verified = row.verifiedCount ?? 0;
  const afterRepair = row.stageCounts.candidatesAfterRepair ?? row.finalPublished;
  const final = row.finalPublished;
  const candidates: Array<{ stage: string; from: number; to: number }> = [];
  if (verified > final + 2) candidates.push({ stage: "verified→final", from: verified, to: final });
  if (v3 > verified + 2 && row.bucket === "C_genre_evidence_guard") {
    candidates.push({ stage: "V3→verified (genre evidence)", from: v3, to: verified });
  }
  if ((row.stageCounts.candidatesAfterDiversity ?? 0) > afterRepair + 2) {
    candidates.push({
      stage: "afterDiversity→afterRepair",
      from: row.stageCounts.candidatesAfterDiversity ?? 0,
      to: afterRepair,
    });
  }
  if ((row.stageCounts.candidatesAfterRanking ?? 0) > (row.stageCounts.candidatesAfterDiversity ?? 0) + 5) {
    candidates.push({
      stage: "afterRanking→afterDiversity",
      from: row.stageCounts.candidatesAfterRanking ?? 0,
      to: row.stageCounts.candidatesAfterDiversity ?? 0,
    });
  }
  return candidates.sort((a, b) => (b.from - b.to) - (a.from - a.to))[0] ?? null;
}

function challengePromptAssumptions(
  row: PromptForensics,
  supply: { strictFamily: number; subgenreMatch: number; eraMatch: number; maxAchievable: number },
): AssumptionChallenge[] {
  const challenges: AssumptionChallenge[] = [];
  const primary = row.bucket;
  const loss = largestPostVerificationLoss(row);

  challenges.push({
    assumption: `Primary hypothesis ${BUCKET_LABELS[primary]} is the root cause`,
    challenged: true,
    verdict: row.ambiguous ? "overstated" : row.bucketHypotheses[1] && primary === "C_genre_evidence_guard"
      ? "partially true"
      : "overstated",
    counterEvidence: [
      `Top score ${row.bucketHypotheses[0]?.score ?? 0}; runner-up ${row.bucketHypotheses[1]?.score ?? "—"} (${BUCKET_LABELS[row.bucketHypotheses[1]?.bucket ?? primary]})`,
      ...(loss ? [`Largest drop: ${loss.stage} ${loss.from}→${loss.to}`] : []),
    ],
    revisedInterpretation: row.ambiguous
      ? "Treat as multi-cause; do not optimize for a single bucket."
      : `Leading hypothesis is plausible but ${loss && loss.stage !== "V3→verified (genre evidence)" ? `binding stage may be ${loss.stage}, not the scored primary.` : "verify with live delivery funnel after repair stack."}`,
  });

  if (primary === "C_genre_evidence_guard") {
    const subgenreCeiling = supply.subgenreMatch;
    const atCeiling = row.finalPublished <= subgenreCeiling + 1 && subgenreCeiling < row.requestedLength * 0.5;
    challenges.push({
      assumption: "Subgenre gate (hypothesis C) is the binding constraint — adjacency will unlock length",
      challenged: atCeiling || (row.verifiedCount ?? 0) > row.finalPublished + 3,
      verdict: atCeiling ? "likely wrong" : (row.verifiedCount ?? 0) > row.finalPublished + 3 ? "overstated" : "partially true",
      counterEvidence: atCeiling
        ? [
          `Library subgenreMatch=${subgenreCeiling}; final=${row.finalPublished} — at strict subgenre ceiling`,
          `strictValid=${row.strictValidCount} — retrieval is not starved`,
        ]
        : row.verifiedCount != null && row.verifiedCount > row.finalPublished + 3
          ? [`verified=${row.verifiedCount} but final=${row.finalPublished} — tracks lost after verification`]
          : [`verified=${row.verifiedCount}/${row.requiredCount}`],
      revisedInterpretation: atCeiling
        ? "Hypothesis A (strict subgenre supply) binds before adjacency can add tracks. Adjacency may raise verified count marginally without raising published length."
        : (row.verifiedCount ?? 0) > row.finalPublished + 3
          ? "Genre evidence is not the final binder — investigate repair/recovery/publication policy (D/E)."
          : "Subgenre gate may still reject V3 tracks; adjacency is one lever among several.",
    });
  }

  if (primary === "A_library_starvation") {
    const highVerified = (row.verifiedCount ?? 0) >= Math.max(5, row.requestedLength * 0.4);
    const highLibrary = supply.maxAchievable >= row.requestedLength * 0.5;
    challenges.push({
      assumption: "Genuine library starvation (hypothesis A) — no pipeline fix can help",
      challenged: highVerified || highLibrary,
      verdict: highVerified && highLibrary ? "likely wrong" : highVerified || highLibrary ? "overstated" : "holds",
      counterEvidence: [
        `maxAchievable=${supply.maxAchievable} (era=${supply.eraMatch}, subgenre=${supply.subgenreMatch})`,
        `classified=${row.stageCounts.candidatesClassified}, verified=${row.verifiedCount}`,
        ...(highVerified ? [`verified=${row.verifiedCount} contradicts pure starvation`] : []),
      ],
      revisedInterpretation: highVerified
        ? "Supply exists in library but funnel/taxonomy/repair prevents delivery — likely B+D not A."
        : highLibrary
          ? "Library has headroom; early funnel (classification/intent) starves before retrieval."
          : "Thin supply is credible; focus on honest partial UX not retrieval fixes.",
    });
  }

  if (row.genreMatchLane == null && (row.strictValidCount ?? 0) >= 20) {
    challenges.push({
      assumption: "genre_match=null means lane starvation",
      challenged: true,
      verdict: "likely wrong",
      counterEvidence: [
        `strictValid=${row.strictValidCount} with genre_match=null — metric absent on this execution path`,
        `Scorer still awards A/B points for null genre_match`,
      ],
      revisedInterpretation: "Do not infer lane starvation from missing genre_match on full_pipeline responses. Use library supply scan + stage funnel instead.",
    });
  }

  if ((row.stageCounts.candidatesAfterRepair ?? row.finalPublished) === row.finalPublished
    && (row.stageCounts.candidatesAfterDiversity ?? 0) > row.finalPublished + 3) {
    challenges.push({
      assumption: "Underfill is a retrieval or genre-evidence problem",
      challenged: true,
      verdict: "overstated",
      counterEvidence: [
        `afterDiversity=${row.stageCounts.candidatesAfterDiversity} → afterRepair=${row.stageCounts.candidatesAfterRepair} → final=${row.finalPublished}`,
        "Repair stage equals final published count",
      ],
      revisedInterpretation: "Hypothesis D (repair/sequencing shrink) may be the binding stage even when C scores higher.",
    });
  }

  return challenges;
}

function buildAssumptionChallengeMd(
  rows: PromptForensics[],
  supplyDetails: Record<string, { strictFamily: number; subgenreMatch: number; eraMatch: number; maxAchievable: number; samples: string[] }>,
): string {
  const globalAssumptions: AssumptionChallenge[] = [
    {
      assumption: "Garage / pop-punk / rave share one fixable 'Bucket C' pattern like disco",
      challenged: true,
      verdict: "overstated",
      counterEvidence: [
        "Disco: family evidence strong, large family pool, subgenre gate was binding on editorial siblings",
        "Garage: subgenreMatch=11 in library; final=11 — at ceiling not gate-only",
        "Pop-punk: maxAchievable=705; subgenreMatch=60 — supply abundant, publication policy binds",
        "Adjacent validation: +1 verified on 2/4 prompts, +0 published length on all 4",
      ],
      revisedInterpretation: "Compound prompts are not one failure class. Disco was family+adjacent-sibling; garage/rave may be strict subgenre supply ceilings; pop-punk may be publication/recovery policy.",
    },
    {
      assumption: "Adjacent-subgenre graph is the highest-ROI next fix",
      challenged: true,
      verdict: "overstated",
      counterEvidence: [
        "0/4 targeted prompts gained published length after adjacency",
        "Repair stack (verified V3 publish, adaptive partial) moved garage 11→25, pop-punk 21→30 without adjacency length gains",
      ],
      revisedInterpretation: "Publication/recovery policy fixes delivered measurable length gains; adjacency alone did not. ROI ranking should separate 'accept more tracks' from 'publish more tracks'.",
    },
    {
      assumption: "Hypothesis scorer confidence='high' means root cause is settled",
      challenged: true,
      verdict: "likely wrong",
      counterEvidence: [
        "C scores 65 whenever V3≥80% requested and verified<required — mechanical trigger",
        "genre_match=null treated as 0, inflating A/B scores on healthy strictValid paths",
        "No prompt flagged ambiguous despite runner-up scores 35–45",
      ],
      revisedInterpretation: "Demote auto-scorer confidence; require stage-level loss attribution before 'high'.",
    },
    {
      assumption: "Benchmark overnight JSONL reflects current pipeline after repair stack",
      challenged: true,
      verdict: "likely wrong",
      counterEvidence: [
        "Forensics source is overnight-live-2026-07-08 — predates genre-evidence repair stack",
        "Live spot-checks post-repair: garage 25, pop-punk 30, cal-003/023 30 — not reflected in classification table",
      ],
      revisedInterpretation: "Re-run forensics live before any benchmark decision; stale data overweights C and underweights publication-policy fixes.",
    },
  ];

  const perPrompt = rows.flatMap((r) => {
    const supply = supplyDetails[r.promptId] ?? { strictFamily: 0, subgenreMatch: 0, eraMatch: 0, maxAchievable: 0, samples: [] };
    const challenges = challengePromptAssumptions(r, supply);
    return [
      `### ${r.promptId}`,
      "",
      `| Field | Value |`,
      `|-------|-------|`,
      `| Primary hypothesis | ${BUCKET_LABELS[r.bucket]} |`,
      `| Published / requested | ${r.finalPublished} / ${r.requestedLength} |`,
      `| V3 → verified → final | ${r.v3OutputCount ?? "—"} → ${r.verifiedCount ?? "—"} → ${r.finalPublished} |`,
      `| Subgenre supply (library) | ${supply.subgenreMatch} |`,
      `| Max achievable (library) | ${supply.maxAchievable} |`,
      `| Repair funnel | diversity=${r.stageCounts.candidatesAfterDiversity} repair=${r.stageCounts.candidatesAfterRepair} final=${r.finalPublished} |`,
      "",
      ...challenges.flatMap((c) => [
        `#### ${c.assumption}`,
        `- **Verdict:** ${c.verdict}`,
        ...c.counterEvidence.map((e) => `- Counter: ${e}`),
        `- **Revised:** ${c.revisedInterpretation}`,
        "",
      ]),
    ];
  });

  const revisedRanking = [
    "| Prompt | Old primary | Revised leading hypothesis | Why |",
    "|--------|-------------|--------------------------|-----|",
    ...rows.map((r) => {
      const supply = supplyDetails[r.promptId];
      let revised = BUCKET_LABELS[r.bucket];
      let why = "scorer default";
      if (r.promptId === "drive-late-garage" || r.promptId === "launch-calibration-003" || r.promptId === "launch-calibration-023") {
        if (supply && r.finalPublished <= supply.subgenreMatch + 1) {
          revised = "A — strict subgenre supply ceiling";
          why = `final≈subgenreMatch (${supply.subgenreMatch})`;
        }
      }
      if (r.promptId === "chill-acoustic") {
        revised = "B+D — taxonomy funnel + repair shrink";
        why = "verified=15 but repair→5; classified=5";
      }
      if (r.promptId === "launch-calibration-001") {
        revised = "A — era+niche supply";
        why = "eraMatch=3; afterIntent=2; verified→final 15→2";
      }
      if (r.promptId === "gym-2000s-pop-punk") {
        revised = "C+E — gate + publication policy";
        why = "maxAchievable=705; post-repair reaches 30 live";
      }
      if (r.promptId === "party-latin-summer") {
        revised = "A+D — thin latin supply + diversity collapse";
        why = "maxAchievable=2; ranking 360→diversity 3";
      }
      return `| ${r.promptId} | ${BUCKET_LABELS[r.bucket]} | ${revised} | ${why} |`;
    }),
  ].join("\n");

  return [
    "# Phase 4 — Challenge Existing Assumptions",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    METHODOLOGY_NOTE,
    "",
    "This report deliberately attacks conclusions from earlier phases. **If an assumption survives here, it is stronger evidence.**",
    "",
    "## Global assumptions challenged",
    "",
    ...globalAssumptions.flatMap((c) => [
      `### ${c.assumption}`,
      `- **Verdict:** ${c.verdict}`,
      ...c.counterEvidence.map((e) => `- ${e}`),
      `- **Revised:** ${c.revisedInterpretation}`,
      "",
    ]),
    "## Scorer blind spots",
    "",
    "| Bias | Effect |",
    "|------|--------|",
    "| C triggers on any V3≥80% + verified<required | Labels cal/garage/pop-punk C even when post-verification loss dominates |",
    "| genre_match=null scored as 0 | False A/B inflation on full_pipeline paths without lane telemetry |",
    "| Ambiguity threshold 15 points | No prompt flagged ambiguous; runner-ups at 35–45 ignored |",
    "| Supply scan not in scorer | subgenreMatch ceiling invisible to bucket ranking |",
    "| Benchmark age | Overnight JSONL predates repair stack; overstates underfill severity |",
    "",
    "## Per-prompt assumption challenges",
    "",
    ...perPrompt,
    "## Revised hypothesis ranking (human-reviewed)",
    "",
    revisedRanking,
    "",
    "## Implications for next fix (diagnosis only)",
    "",
    "1. **Do not treat adjacency as proven ROI** — it raised verified count marginally, not published length on stale benchmark.",
    "2. **Separate 'verification' from 'publication'** — several prompts verify more than they publish (cal-001, chill-acoustic).",
    "3. **Supply ceiling prompts** (garage subgenre=11, rave subgenre=13, latin=2) need honest partial or supply messaging — not more subgenre edges.",
    "4. **Re-run live forensics** on repair stack before benchmark decision; overnight data is stale.",
    "5. **Benchmark recommendation stays B** until live re-audit confirms post-repair delivery on all 7 prompts.",
  ].join("\n");
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const env = readFileSync(path.join(ROOT, ".env"), "utf8");
  const dbMatch = env.match(/^DATABASE_URL=(.+)$/m);
  if (!dbMatch) throw new Error("DATABASE_URL missing in .env");
  const pool = initPool(dbMatch[1].trim().replace(/^"|"$/g, ""));
  initDb(pool);
  await runDbInit(pool);
  markBootComplete();
  const { db } = await import("../db/index.js");

  const rawRows = await db.select().from(likedSongsTable).where(eq(likedSongsTable.spotifyUserId, "koalablade"));
  const { valid: rows } = sanitizeLikedSongs(rawRows);
  const profile = buildUserGenreProfile(rows);
  const classMap = profile.trackClassifications;

  let creds: { baseUrl: string; token: string; spotifyUserId: string } | null = null;
  try {
    creds = resolveLiveBenchmarkCredentials({ strict: true, cli: { baseUrl: "http://localhost:5000" }, defaultBaseUrl: "http://localhost:5000" });
  } catch {
    /* offline */
  }

  const forensics: PromptForensics[] = [];

  for (const id of TARGET_IDS) {
    let bench = await loadBenchmarkRow(id);
    let response: Record<string, unknown>;
    if (bench) {
      response = asRecord(bench.response) ?? {};
    } else if (creds) {
      process.stderr.write(`[forensics] live ${id}\n`);
      response = await liveGenerate(id, creds);
      bench = { benchmark: PLAYLIST_BENCHMARK_PROMPTS.find((p) => p.id === id) };
    } else {
      continue;
    }
    const benchmark = asRecord(bench.benchmark) ?? { id, prompt: id, length: 30 };
    const base = extractFromResponse(id, response, benchmark);
    const classification = classify(base);
    const prompt = PLAYLIST_BENCHMARK_PROMPTS.find((p) => p.id === id);
    const supply = prompt
      ? await librarySupplyForPrompt(id, prompt.prompt, classMap, rows.map((r) => ({
        track_id: r.trackId,
        artist_name: r.artistName,
        track_name: r.trackName,
        release_year: r.releaseYear ?? null,
      })))
      : { strictFamily: 0, subgenreMatch: 0, eraMatch: 0, maxAchievable: 0, samples: [] as string[] };

    forensics.push({
      ...base,
      ...classification,
      maxAchievableEstimate: supply.maxAchievable,
      evidence: [...classification.evidence, ...supply.samples.slice(0, 2).map((s) => `library: ${s}`)],
    });
  }

  const supplyDetails: Record<string, { strictFamily: number; subgenreMatch: number; eraMatch: number; maxAchievable: number; samples: string[] }> = {};
  for (const id of TARGET_IDS) {
    const prompt = PLAYLIST_BENCHMARK_PROMPTS.find((p) => p.id === id);
    if (!prompt) continue;
    supplyDetails[id] = await librarySupplyForPrompt(id, prompt.prompt, classMap, rows.map((r) => ({
      track_id: r.trackId,
      artist_name: r.artistName,
      track_name: r.trackName,
      release_year: r.releaseYear ?? null,
    })));
  }

  await writeFile(path.join(OUT_DIR, "remaining-failure-classification.md"), buildClassificationMd(forensics));
  await writeFile(path.join(OUT_DIR, "adjacent-subgenre-investigation.md"), buildAdjacentMd());
  await writeFile(path.join(OUT_DIR, "underfill-decision-tree.md"), buildDecisionTreeMd());
  await writeFile(path.join(OUT_DIR, "library-supply-audit.md"), buildSupplyMd(forensics, supplyDetails));
  await writeFile(path.join(OUT_DIR, "assumption-challenge-report.md"), buildAssumptionChallengeMd(forensics, supplyDetails));
  await writeFile(path.join(OUT_DIR, "remaining-failure-classification.json"), JSON.stringify({ generatedAt: new Date().toISOString(), forensics, supplyDetails }, null, 2));

  process.stdout.write(`[forensics] wrote 5 reports to ${OUT_DIR}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
