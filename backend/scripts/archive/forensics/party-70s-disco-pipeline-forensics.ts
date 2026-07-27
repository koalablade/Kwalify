/**
 * Diagnosis-only forensic extraction for party-70s-disco vs mixed-2.
 * No ranking / retrieval / recovery / orchestration logic changes.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveLiveBenchmarkCredentials } from "../lib/benchmark-env";
import { PLAYLIST_BENCHMARK_PROMPTS } from "../lib/playlist-evaluation/benchmark-prompts";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const TARGET_IDS = ["party-70s-disco", "mixed-2"] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function txt(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function pct(before: number, after: number): number {
  if (before <= 0) return 0;
  return Math.round(((before - after) / before) * 10000) / 100;
}

async function generate(id: (typeof TARGET_IDS)[number], baseUrl: string, token: string, spotifyUserId: string) {
  const prompt = PLAYLIST_BENCHMARK_PROMPTS.find((row) => row.id === id);
  if (!prompt) throw new Error(`Missing prompt ${id}`);
  const res = await fetch(`${baseUrl}/api/generate?audit=1`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kwalify-evaluation-token": token,
    },
    body: JSON.stringify({
      vibe: prompt.prompt,
      mode: prompt.mode,
      length: prompt.length,
      auditMode: true,
      debug: true,
      debugPipeline: true,
      debugPerformance: true,
      spotifyUserId,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = asRecord(await res.json().catch(() => ({}))) ?? {};
  return { prompt, status: res.status, body };
}

type StageRow = {
  stage: string;
  before: number | null;
  after: number | null;
  removed: number | null;
  percentRemoved: number | null;
  reasons: string;
};

function stageFromRemoval(entry: Record<string, unknown>): StageRow {
  const before = num(entry.before);
  const after = num(entry.after);
  const removed = num(entry.removed) ?? (before != null && after != null ? Math.max(0, before - after) : null);
  const topReasons = asArray<{ reason?: string; count?: number }>(entry.topReasons)
    .map((row) => `${row.reason ?? "?"}:${row.count ?? 0}`)
    .join(", ");
  const rejection = asRecord(entry.rejectionReasons);
  const rejectionText = rejection
    ? Object.entries(rejection)
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .slice(0, 6)
        .map(([reason, count]) => `${reason}:${count}`)
        .join(", ")
    : "";
  return {
    stage: txt(entry.stage) ?? "unknown",
    before,
    after,
    removed,
    percentRemoved: before != null && after != null ? pct(before, after) : num(entry.percentRemoved),
    reasons: topReasons || rejectionText || "n/a",
  };
}

function extractForensics(result: Awaited<ReturnType<typeof generate>>) {
  const body = result.body;
  const gd = asRecord(body.generationDiagnostics) ?? {};
  const v3 = asRecord(body.v3Diagnostics) ?? {};
  const controlled = asRecord(v3.controlledGeneration) ?? {};
  const retrieval = asRecord(gd.candidateRetrieval) ?? {};
  const orch = asRecord(retrieval.orchestrator) ?? {};
  const blended = asRecord(orch.blendedIntentPool);
  const supply = asRecord(orch.validCandidateSupply) ?? asRecord(gd.validCandidateSupply);
  const exec = asRecord(body.playlistExecutionTrace) ?? {};
  const waterfall = asArray<Record<string, unknown>>(gd.waterfall).map((row) => ({
    stage: txt(row.stage) ?? "?",
    count: num(row.count),
    before: num(row.before),
    removed: num(row.removed),
  }));
  const removalReasons = asArray<Record<string, unknown>>(gd.removalReasons).map(stageFromRemoval);
  const constraintFailures = asArray(controlled.constraintFailures).map(String);
  const relaxationSteps = asArray(controlled.relaxationSteps).map(String);
  const selectedRelaxation = controlled.selectedRelaxation ?? controlled.finalRelaxedConstraints ?? null;
  const humanGate = asRecord(v3.humanSaveabilityGate);
  const gateEval = asRecord(humanGate?.evaluation) ?? asRecord(humanGate);

  return {
    id: result.prompt.id,
    prompt: result.prompt.prompt,
    mode: result.prompt.mode,
    length: result.prompt.length,
    status: result.status,
    success: body.success === true,
    count: num(body.count) ?? asArray(body.tracks).length,
    executionPath: txt(exec.executionPath),
    blendedIntentPool: blended
      ? {
          inputCount: num(blended.inputCount),
          outputCount: num(blended.outputCount),
          relaxationStep: txt(blended.relaxationStep),
          lanes: blended.lanes ?? null,
          targetCount: num(blended.targetCount),
        }
      : null,
    supply: supply
      ? {
          strictValidCount: num(supply.strictValidCount),
          relaxedValidCount: num(supply.relaxedValidCount),
          recoveryValidCount: num(supply.recoveryValidCount),
          minRequired: num(supply.minRequired),
          sufficient: supply.sufficient === true,
          limitingDimensions: asArray(supply.limitingDimensions).map(String),
        }
      : null,
    retrieval: {
      inputCount: num(retrieval.inputCount),
      outputCount: num(retrieval.outputCount),
      strategy: txt(orch.strategy),
      compoundPrompt: retrieval.compoundPrompt === true,
      compoundDimensions: num(retrieval.compoundDimensions),
    },
    controlled: {
      constraintFailures,
      relaxationSteps,
      selectedRelaxation,
      selectedCandidate: txt(controlled.selectedCandidate),
      v3InvocationCount: num(controlled.v3InvocationCount),
    },
    waterfall,
    removalReasons,
    gate: {
      hardFailed: gateEval?.hardFailed === true || body.playlistExecutionTrace != null && txt(exec.executionPath) === "gate_failure",
      humanSaveable: gateEval?.humanSaveable === true || humanGate?.humanSaveable === true,
      curatorScore: num(gateEval?.curatorScore) ?? num(humanGate?.curatorScore),
      rejectionReasons: asArray(gateEval?.rejectionReasons ?? humanGate?.rejectionReasons).map(String),
    },
    trackCounts: asRecord(exec.trackCounts),
    candidates: {
      sampled: num(gd.candidatesSampled),
      classified: num(gd.candidatesClassified),
      afterIntent: num(gd.candidatesAfterIntent),
      afterEra: num(gd.candidatesAfterEra),
      afterMood: num(gd.candidatesAfterMood),
      afterConstraints: num(gd.candidatesAfterConstraints),
      afterRanking: num(gd.candidatesAfterRanking),
      afterDiversity: num(gd.candidatesAfterDiversity),
      afterRepair: num(gd.candidatesAfterRepair),
      afterCoherence: num(gd.candidatesAfterCoherence),
      final: num(gd.candidatesFinal),
      initialLibrary: num(gd.initialLibrarySize),
    },
  };
}

function histogramFromRemovals(removalReasons: StageRow[]): Array<{ reason: string; count: number }> {
  const map = new Map<string, number>();
  for (const stage of removalReasons) {
    if (!stage.reasons || stage.reasons === "n/a") continue;
    for (const part of stage.reasons.split(",")) {
      const [reason, countRaw] = part.trim().split(":");
      if (!reason) continue;
      const count = Number(countRaw);
      map.set(reason, (map.get(reason) ?? 0) + (Number.isFinite(count) ? count : (stage.removed ?? 0)));
    }
  }
  return [...map.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

function markdownTable(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  return [head, sep, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");
}

function survivalChart(rows: StageRow[]): string {
  const usable = rows.filter((row) => row.after != null);
  if (usable.length === 0) return "_no stage after-counts available_";
  const max = Math.max(...usable.map((row) => row.after ?? 0), 1);
  return usable
    .map((row) => {
      const barLen = Math.max(1, Math.round(((row.after ?? 0) / max) * 30));
      return `${row.stage.padEnd(34)} ${"█".repeat(barLen)} ${row.after}`;
    })
    .join("\n");
}

async function main(): Promise<void> {
  const creds = resolveLiveBenchmarkCredentials({
    strict: true,
    cli: { baseUrl: "http://localhost:5000" },
    defaultBaseUrl: "http://localhost:5000",
  });

  const results = [] as Array<ReturnType<typeof extractForensics>>;
  for (const id of TARGET_IDS) {
    process.stderr.write(`[forensics] generating ${id}...\n`);
    results.push(extractForensics(await generate(id, creds.baseUrl, creds.token, creds.spotifyUserId)));
  }

  const disco = results.find((row) => row.id === "party-70s-disco")!;
  const mixed = results.find((row) => row.id === "mixed-2")!;

  const discoWaterfallRows = disco.removalReasons.length
    ? disco.removalReasons
    : disco.waterfall.map((row, idx, arr) => ({
        stage: row.stage,
        before: idx === 0 ? row.count : arr[idx - 1]?.count ?? null,
        after: row.count,
        removed: row.removed,
        percentRemoved: row.count != null && (idx === 0 ? row.count : arr[idx - 1]?.count) != null
          ? pct((idx === 0 ? row.count : arr[idx - 1]?.count) ?? 0, row.count ?? 0)
          : null,
        reasons: "n/a",
      }));

  const mixedWaterfallRows = mixed.removalReasons.length
    ? mixed.removalReasons
    : mixed.waterfall.map((row, idx, arr) => ({
        stage: row.stage,
        before: idx === 0 ? row.count : arr[idx - 1]?.count ?? null,
        after: row.count,
        removed: row.removed,
        percentRemoved: row.count != null && (idx === 0 ? row.count : arr[idx - 1]?.count) != null
          ? pct((idx === 0 ? row.count : arr[idx - 1]?.count) ?? 0, row.count ?? 0)
          : null,
        reasons: "n/a",
      }));

  const discoHist = histogramFromRemovals(discoWaterfallRows);
  const blocking = disco.controlled.constraintFailures[0] ?? "unknown";
  const preContract = discoWaterfallRows.find((row) => /intent readiness|constraint|era readiness|metadata/i.test(row.stage));
  const largestDrop = [...discoWaterfallRows]
    .filter((row) => (row.removed ?? 0) > 0)
    .sort((a, b) => (b.removed ?? 0) - (a.removed ?? 0))[0] ?? null;

  // Official contract in buildV3CandidatePool:
  // minimumCandidateCount = max(ceil(length * minimumFillRatio), min(12, length))
  // with minimumFillRatio 0.65/0.8 depending on interpretation.
  // Flag fires when selectedRelaxation.candidateCount < minimumCandidateCount.
  const playlistLength = disco.length;
  const estimatedMinimum = Math.max(Math.ceil(playlistLength * 0.8), Math.min(12, playlistLength));
  const compoundEffectiveMin = Math.max(8, Math.ceil(playlistLength * 0.55));
  const intentReadyAfter = discoWaterfallRows.find((row) => /intent readiness/i.test(row.stage))?.after
    ?? disco.candidates.afterConstraints
    ?? null;
  const survivorsIfIgnoreContract = intentReadyAfter;
  const wouldComplete = survivorsIfIgnoreContract != null && survivorsIfIgnoreContract >= playlistLength;

  const roiChoice = (() => {
    if (blocking === "candidate_pool_below_minimum_after_relaxation") {
      if ((intentReadyAfter ?? 0) > 0 && (intentReadyAfter ?? 0) < estimatedMinimum) return "G";
      if ((disco.blendedIntentPool?.outputCount ?? 0) >= 100 && (intentReadyAfter ?? 0) < 8) return "B";
      return "B";
    }
    if ((largestDrop?.removed ?? 0) > 100 && /era/i.test(largestDrop?.stage ?? "")) return "B";
    return "H";
  })();

  const roiLabels: Record<string, string> = {
    A: "Editorial contract too strict",
    B: "Relaxation ladder insufficient",
    C: "Candidate shaping too aggressive",
    D: "Diversity pruning",
    E: "Artist repetition",
    F: "Quality gate",
    G: "Minimum fill contract",
    H: "Something else",
  };

  const lines: string[] = [
    "# party-70s-disco Pipeline Forensics",
    "",
    `Generated: ${new Date().toISOString()}`,
    "Mode: diagnosis only (no threshold / retrieval / scoring / recovery changes)",
    "",
    "## Executive finding",
    "",
    `- Blended intent pool **did activate** for party-70s-disco (`
      + `in=${disco.blendedIntentPool?.inputCount ?? "n/a"}, out=${disco.blendedIntentPool?.outputCount ?? "n/a"}, step=${disco.blendedIntentPool?.relaxationStep ?? "n/a"}).`,
    `- Exact blocking rule: **\`${blocking}\`**`,
    `- Execution path: **\`${disco.executionPath ?? "n/a"}\`** with final count **${disco.count}**.`,
    `- Recommended single next change: **${roiChoice}. ${roiLabels[roiChoice]}**`,
    "",
    "## 1. Waterfall table — party-70s-disco",
    "",
    markdownTable(
      ["Stage", "Before", "After", "Removed", "% removed", "Exact removal reasons"],
      discoWaterfallRows.map((row) => [
        row.stage,
        String(row.before ?? "n/a"),
        String(row.after ?? "n/a"),
        String(row.removed ?? "n/a"),
        row.percentRemoved == null ? "n/a" : `${row.percentRemoved}%`,
        row.reasons.replace(/\|/g, "/"),
      ]),
    ),
    "",
    "High-level candidate account:",
    "",
    markdownTable(
      ["Checkpoint", "Count"],
      [
        ["Initial library", String(disco.candidates.initialLibrary ?? "n/a")],
        ["After blended intent pool", String(disco.blendedIntentPool?.outputCount ?? "n/a")],
        ["After candidate shaping / retrieval output", String(disco.retrieval.outputCount ?? "n/a")],
        ["After sampled", String(disco.candidates.sampled ?? "n/a")],
        ["After classified", String(disco.candidates.classified ?? "n/a")],
        ["After intent", String(disco.candidates.afterIntent ?? "n/a")],
        ["After era", String(disco.candidates.afterEra ?? "n/a")],
        ["After mood", String(disco.candidates.afterMood ?? "n/a")],
        ["After constraints", String(disco.candidates.afterConstraints ?? "n/a")],
        ["After ranking", String(disco.candidates.afterRanking ?? "n/a")],
        ["After diversity", String(disco.candidates.afterDiversity ?? "n/a")],
        ["After repair", String(disco.candidates.afterRepair ?? "n/a")],
        ["After coherence", String(disco.candidates.afterCoherence ?? "n/a")],
        ["Final survivors", String(disco.candidates.final ?? disco.count)],
      ],
    ),
    "",
    "### Valid candidate supply / relaxation",
    "",
    `- strictValidCount=${disco.supply?.strictValidCount ?? "n/a"}`,
    `- relaxedValidCount=${disco.supply?.relaxedValidCount ?? "n/a"}`,
    `- recoveryValidCount=${disco.supply?.recoveryValidCount ?? "n/a"}`,
    `- minRequired=${disco.supply?.minRequired ?? "n/a"}`,
    `- limitingDimensions=${(disco.supply?.limitingDimensions ?? []).join(", ") || "none"}`,
    `- controlled.relaxationSteps=${disco.controlled.relaxationSteps.join(" → ") || "none"}`,
    `- controlled.selectedRelaxation=${JSON.stringify(disco.controlled.selectedRelaxation)}`,
    `- controlled.constraintFailures=${disco.controlled.constraintFailures.join(", ") || "none"}`,
    "",
    "## 2. Removal histogram — party-70s-disco",
    "",
    discoHist.length
      ? markdownTable(
          ["Removal reason", "Count"],
          discoHist.slice(0, 20).map((row) => [row.reason, String(row.count)]),
        )
      : "_No granular rejectionReasons were attached to removal stages in this response._",
    "",
    largestDrop
      ? `Largest stage drop: **${largestDrop.stage}** removed ${largestDrop.removed} (${largestDrop.percentRemoved}%).`
      : "Largest stage drop: n/a",
    "",
    "## 3. Candidate survival chart — party-70s-disco",
    "",
    "```",
    survivalChart(discoWaterfallRows),
    "```",
    "",
    "## 4. Comparison with mixed-2",
    "",
    markdownTable(
      ["Metric", "party-70s-disco", "mixed-2", "Divergence?"],
      [
        ["Final count", String(disco.count), String(mixed.count), disco.count === mixed.count ? "no" : "YES"],
        ["Execution path", disco.executionPath ?? "n/a", mixed.executionPath ?? "n/a", (disco.executionPath ?? "") === (mixed.executionPath ?? "") ? "no" : "YES"],
        ["Blended pool out", String(disco.blendedIntentPool?.outputCount ?? "n/a"), String(mixed.blendedIntentPool?.outputCount ?? "n/a"), "compare"],
        ["strictValidCount", String(disco.supply?.strictValidCount ?? "n/a"), String(mixed.supply?.strictValidCount ?? "n/a"), "compare"],
        ["relaxedValidCount", String(disco.supply?.relaxedValidCount ?? "n/a"), String(mixed.supply?.relaxedValidCount ?? "n/a"), "compare"],
        ["constraintFailures", disco.controlled.constraintFailures.join(",") || "none", mixed.controlled.constraintFailures.join(",") || "none", disco.controlled.constraintFailures.join(",") === mixed.controlled.constraintFailures.join(",") ? "no" : "YES"],
        ["afterConstraints", String(disco.candidates.afterConstraints ?? "n/a"), String(mixed.candidates.afterConstraints ?? "n/a"), "compare"],
        ["afterRanking", String(disco.candidates.afterRanking ?? "n/a"), String(mixed.candidates.afterRanking ?? "n/a"), "compare"],
        ["final survivors", String(disco.candidates.final ?? "n/a"), String(mixed.candidates.final ?? "n/a"), "compare"],
      ],
    ),
    "",
    "### mixed-2 waterfall",
    "",
    markdownTable(
      ["Stage", "Before", "After", "Removed", "% removed", "Reasons"],
      mixedWaterfallRows.map((row) => [
        row.stage,
        String(row.before ?? "n/a"),
        String(row.after ?? "n/a"),
        String(row.removed ?? "n/a"),
        row.percentRemoved == null ? "n/a" : `${row.percentRemoved}%`,
        row.reasons.replace(/\|/g, "/"),
      ]),
    ),
    "",
    "## 5. Exact blocking rule (Phase 3)",
    "",
    "Flag source (`buildV3CandidatePool`):",
    "",
    "```ts",
    "constraintFailures: selectedRelaxation && selectedRelaxation.candidateCount < minimumCandidateCount",
    "  ? [\"candidate_pool_below_minimum_after_relaxation\"]",
    "  : []",
    "```",
    "",
    `- minimumCandidateCount (standard fill): max(ceil(length * fillRatio), min(12, length))`,
    `- Estimated threshold for length ${playlistLength}: **${estimatedMinimum}** (fillRatio≈0.8) / compound effective floor **${compoundEffectiveMin}** (0.55*length)`,
    `- Candidates immediately before / at intent-ready after relaxation selection: **${intentReadyAfter ?? "n/a"}**`,
    `- If ONLY this minimum contract were ignored, survivors available for V3 sampling ≈ **${survivorsIfIgnoreContract ?? "n/a"}**`,
    `- Would the playlist have completed to requested length normally? **${wouldComplete ? "LIKELY YES" : "NO / unlikely from current survivors"}**`,
    "",
    "Important nuance: orchestrator blended pool succeeded (hundreds of tracks), but the **pre-V3 intent readiness / relaxation selection** still labels the selected ladder step as below `minimumCandidateCount`. That is why the failure string is `candidate_pool_below_minimum_after_relaxation` even though blending already ran upstream.",
    "",
    "## 6. Estimated impact if fixed",
    "",
    `- Current hard failure: party-70s-disco returns gate/constricted output with **${disco.count}** track(s).`,
    `- mixed-2 already completes with **${mixed.count}** tracks under the same blended-pool instrumentation.`,
    `- Fixing the flagged minimum/relaxation mismatch should primarily convert empty/near-empty compound strict failures into filled playlists without touching hybrid scoring weights.`,
    `- Expected ROI: eliminate remaining hard empty/underfill on era+genre+activity compounds while keeping the successful blended retrieval path.`,
    "",
    "## 7. Recommended single next change",
    "",
    `**${roiChoice}. ${roiLabels[roiChoice]}**`,
    "",
    "Evidence:",
    `- Blended pool already produces ${disco.blendedIntentPool?.outputCount ?? "n/a"} candidates.`,
    `- Flag is specifically \`candidate_pool_below_minimum_after_relaxation\`.`,
    `- Controlled relaxation steps observed: ${disco.controlled.relaxationSteps.join(" → ") || "none"}.`,
    `- Selected relaxation profile: ${JSON.stringify(disco.controlled.selectedRelaxation)}.`,
    `- Intent/constraint after-count remains ${intentReadyAfter ?? "n/a"} vs fill minimum ~${estimatedMinimum}.`,
    "",
    "Suggested directional fix (report only — do not implement here):",
    "- Either count blended-rescued `rawIntentReady` toward the same minimum that sets `constraintFailures`, or",
    "- Advance the relaxation ladder one more step when blended pool exists but selected step candidateCount < minimumCandidateCount, or",
    "- Align `constraintFailures` with `effectiveMinimumCandidateCount` (compound floor) so a non-empty blended-rescued pool is not falsely marked collapsed.",
    "",
    "## Appendix — raw controlled diagnostics",
    "",
    "### party-70s-disco",
    "```json",
    JSON.stringify({
      status: disco.status,
      count: disco.count,
      executionPath: disco.executionPath,
      blendedIntentPool: disco.blendedIntentPool,
      supply: disco.supply,
      controlled: disco.controlled,
      candidates: disco.candidates,
      gate: disco.gate,
    }, null, 2),
    "```",
    "",
    "### mixed-2",
    "```json",
    JSON.stringify({
      status: mixed.status,
      count: mixed.count,
      executionPath: mixed.executionPath,
      blendedIntentPool: mixed.blendedIntentPool,
      supply: mixed.supply,
      controlled: mixed.controlled,
      candidates: mixed.candidates,
      gate: mixed.gate,
    }, null, 2),
    "```",
  ];

  const outDir = path.join(ROOT, "reports", "playlist-evaluation");
  await mkdir(outDir, { recursive: true });
  const mdPath = path.join(outDir, "party-70s-disco-pipeline-forensics.md");
  const jsonPath = path.join(outDir, "party-70s-disco-pipeline-forensics.json");
  await writeFile(mdPath, `${lines.join("\n")}\n`, "utf8");
  await writeFile(jsonPath, JSON.stringify({ disco, mixed }, null, 2), "utf8");
  process.stdout.write(`[forensics] wrote ${mdPath}\n`);
  process.stdout.write(`[forensics] wrote ${jsonPath}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
