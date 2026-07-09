/**
 * ROI diagnosis: orchestrator confidence (gym) + fast-fallback path (party/worst).
 * Diagnosis only — does not change thresholds or generation logic.
 *
 * Usage:
 *   npm run diagnosis:roi-gates
 *   npm run diagnosis:roi-gates -- --live --spawn-local
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureEvalReady } from "../lib/benchmark-local-server";
import { resolveLiveBenchmarkCredentials } from "../lib/benchmark-env";
import {
  explainFastFallback,
  renderFastFallbackMarkdown,
} from "../lib/pipeline-diagnosis/fast-fallback-explain";
import {
  explainOrchestratorConfidence,
  renderConfidenceExplanationMarkdown,
} from "../lib/pipeline-diagnosis/orchestrator-confidence-explain";
import { WORST_PROMPT_IDS } from "../lib/pipeline-diagnosis/worst-prompts";
import { PLAYLIST_BENCHMARK_PROMPTS } from "../lib/playlist-evaluation/benchmark-prompts";

const ROOT = path.resolve(__dirname, "..", "..", "..");

type StoredResult = {
  benchmark: { id: string; category: string; prompt: string; length: number };
  ok: boolean;
  elapsedMs?: number;
  response: Record<string, unknown> | null;
};

type CliConfig = {
  evalDir: string;
  outDir: string;
  live: boolean;
  spawnLocal: boolean;
  baseUrl: string;
  token: string;
  spotifyUserId: string;
};

function parseArgs(argv: string[]): CliConfig {
  const creds = resolveLiveBenchmarkCredentials({ strict: false, defaultBaseUrl: "http://localhost:5000" });
  let evalDir = path.join(ROOT, "reports", "playlist-evaluation", "live-6h");
  let outDir = path.join(ROOT, "reports", "playlist-evaluation", "roi-gate-fallback-diagnosis");
  let live = false;
  let spawnLocal = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--eval-dir" && argv[i + 1]) evalDir = path.resolve(argv[++i]);
    else if (arg === "--out" && argv[i + 1]) outDir = path.resolve(argv[++i]);
    else if (arg === "--base-url" && argv[i + 1]) creds.baseUrl = argv[++i];
    else if (arg === "--live") live = true;
    else if (arg === "--spawn-local") spawnLocal = true;
  }

  return {
    evalDir,
    outDir,
    live,
    spawnLocal,
    baseUrl: creds.baseUrl,
    token: creds.token ?? "",
    spotifyUserId: creds.spotifyUserId ?? "koalablade",
  };
}

async function loadJsonl(dir: string): Promise<Map<string, StoredResult>> {
  const filePath = path.join(dir, "evaluation-results.jsonl");
  const text = await readFile(filePath, "utf8");
  const map = new Map<string, StoredResult>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as StoredResult;
    map.set(row.benchmark.id, row);
  }
  return map;
}

async function fetchAudit(
  config: CliConfig,
  prompt: (typeof PLAYLIST_BENCHMARK_PROMPTS)[number],
): Promise<Record<string, unknown>> {
  const res = await fetch(`${config.baseUrl}/api/generate?audit=1&debug=1`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kwalify-evaluation-token": config.token,
    },
    body: JSON.stringify({
      vibe: prompt.prompt,
      mode: prompt.mode,
      length: prompt.length,
      auditMode: true,
      spotifyUserId: config.spotifyUserId,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

function orchestratorFromResponse(response: Record<string, unknown>): Record<string, unknown> {
  return (response.retrievalOrchestrator as Record<string, unknown> | undefined) ?? {};
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  console.error("[roi-diagnosis] Loading evaluation results...");
  const results = await loadJsonl(config.evalDir);

  let shutdown: (() => void) | null = null;
  if (config.live) {
    if (!config.token) throw new Error("--live requires PLAYLIST_EVAL_TOKEN in .env");
    const ready = await ensureEvalReady(config.baseUrl, config.token, config.spawnLocal);
    config.baseUrl = ready.baseUrl;
    shutdown = ready.shutdown;
  }

  const gymPrompts = PLAYLIST_BENCHMARK_PROMPTS.filter((p) => p.category === "gym");
  const fallbackPromptIds = WORST_PROMPT_IDS.filter((id) => !id.startsWith("gym-"));

  const confidenceReports = [];
  const fallbackReports = [];

  try {
    for (const meta of gymPrompts) {
      const stored = results.get(meta.id);
      let response = stored?.response ?? {};
      if (config.live) {
        console.error(`[roi-diagnosis] Live fetch gym: ${meta.id}`);
        response = await fetchAudit(config, meta);
      }

      const orch = orchestratorFromResponse(response);
      const cap = (orch.libraryCapability as Record<string, unknown> | undefined)
        ?? (response.libraryCapability as Record<string, unknown> | undefined)
        ?? {};

      confidenceReports.push(explainOrchestratorConfidence({
        promptId: meta.id,
        prompt: meta.prompt,
        requestedLength: meta.length,
        activity: "gym",
        libraryCapability: cap,
        retrievalAttempts: Number(orch.retrievalAttempts ?? 0),
        combinedConfidence: Number(orch.combinedConfidence ?? response.combinedConfidence ?? cap.score ?? 0),
        validCandidateSupply: orch.validCandidateSupply as Record<string, unknown> | undefined,
        failureCode: String(response.code ?? response.reason ?? ""),
      }));
    }

    for (const promptId of fallbackPromptIds) {
      const meta = PLAYLIST_BENCHMARK_PROMPTS.find((p) => p.id === promptId);
      if (!meta) continue;
      const stored = results.get(promptId);
      let response = stored?.response ?? {};
      if (config.live) {
        console.error(`[roi-diagnosis] Live fetch fallback: ${promptId}`);
        response = await fetchAudit(config, meta);
      }

      fallbackReports.push(explainFastFallback({
        promptId,
        prompt: meta.prompt,
        response,
        elapsedMs: stored?.elapsedMs,
      }));
    }
  } finally {
    shutdown?.();
  }

  const gym28 = confidenceReports.filter((r) => r.reportedScore === 28);
  const conflictBlocked = confidenceReports.filter((r) => r.roiAnswer.conflictIsPrimaryBlocker);
  const intentCollapse = fallbackReports.filter((r) => r.wasIntentPoolCollapse);
  const budgetFallback = fallbackReports.filter((r) => r.was42sFastFallback);

  const md: string[] = [
    "# ROI Gate & Fallback Diagnosis",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Source: \`${config.evalDir}\`${config.live ? " + live re-fetch" : ""}`,
    "",
    "## Executive summary",
    "",
    "### Why combinedConfidence = 28 (gym cluster)",
    "",
    "For gym prompts, `combinedConfidence` equals `libraryCapability.score` because **retrieval never runs** (`retrievalAttempts: 0`).",
    "The score is built from six weighted components, then **hard-capped at 28** when `library_prompt_conflict` fires.",
    "",
    "Typical gym pattern:",
    "- **activityScore ~99** (library tracks match gym activity labels)",
    "- **energyScore 0**, **genreScore 0–2**, **openerScore 0**, **sonicScore 0–100**",
    "- Weighted sum ≈ 28 even before cap",
    "- **library_prompt_conflict**: library mean energy < 0.52 AND one genre family ≥45% of sample",
    "- Gate: conflict + relaxed valid supply < minRequired → `LIBRARY_INSUFFICIENT_FOR_PROMPT`",
    "",
    `Gym prompts at score 28: **${gym28.length}/${confidenceReports.length}**`,
    `Blocked primarily by library_prompt_conflict: **${conflictBlocked.length}/${confidenceReports.length}**`,
    "",
    "**Energy mismatch is NOT 60% of the score** — activity contributes ~90% of the weighted sum.",
    "Energy contributes **0%** when energyScore=0. The blocker is the **conflict flag + supply gate**, not activity weighting.",
    "",
    "### Fast fallback (party / worst prompts)",
    "",
    `Intent pool collapse (NOT 42s timeout): **${intentCollapse.length}/${fallbackReports.length}**`,
    `42s request-budget fast fallback: **${budgetFallback.length}/${fallbackReports.length}**`,
    "",
    "Stored benchmark shows party worst prompts fail in **~1s** via `intent_pool_collapse_fallback` during `candidate_shape`,",
    "then **recovery** fills the playlist. V3/scoring/opening curator are **bypassed** (`executionPath: timeout_fallback` is a recovery label, not a 42s timeout).",
    "",
    "### ROI #3 framing (decision, not implemented)",
    "",
    "- **Option A (honest):** Gym library genuinely conflicts — low-energy, single-family liked songs vs gym intent.",
    "- **Option B (permissive):** Enough workout-suitable tracks may exist under relaxed supply counts, but conflict gate blocks before retrieval measures them.",
    "- **Current evidence:** Stored responses omit `validCandidateSupply` on early failure — run `--live` to confirm relaxed counts.",
    "",
    "---",
    "",
    "## ROI #1 — Gym orchestrator confidence (per prompt)",
    "",
  ];

  for (const report of confidenceReports) {
    md.push(renderConfidenceExplanationMarkdown(report));
  }

  md.push("---", "", "## ROI #2 — Fast fallback / recovery (worst non-gym prompts)", "");
  for (const report of fallbackReports) {
    md.push(renderFastFallbackMarkdown(report));
  }

  md.push(
    "---",
    "",
    "## Cross-prompt classification",
    "",
    "### Gym gate blockers",
    ...confidenceReports.map((r) => `- \`${r.promptId}\`: gate=\`${r.likelyGate}\`, drag=\`${r.roiAnswer.dominantDrag}\``),
    "",
    "### Fallback classifiers",
    ...fallbackReports.map((r) => `- \`${r.promptId}\`: \`${r.classification}\` (${r.totalElapsedMs ?? "?"}ms)`),
    "",
  );

  const bundle = {
    generatedAt: new Date().toISOString(),
    evalDir: config.evalDir,
    liveRefetch: config.live,
    summary: {
      gymPromptCount: confidenceReports.length,
      gymScore28Count: gym28.length,
      conflictBlockedCount: conflictBlocked.length,
      intentPoolCollapseCount: intentCollapse.length,
      budgetFallbackCount: budgetFallback.length,
    },
    gymConfidence: confidenceReports,
    fallbackDiagnosis: fallbackReports,
  };

  await mkdir(config.outDir, { recursive: true });
  const jsonPath = path.join(config.outDir, "roi-gate-fallback-diagnosis.json");
  const mdPath = path.join(config.outDir, "roi-gate-fallback-diagnosis.md");
  await writeFile(jsonPath, JSON.stringify(bundle, null, 2), "utf8");
  await writeFile(mdPath, md.join("\n"), "utf8");

  console.error(`[roi-diagnosis] Wrote ${jsonPath}`);
  console.error(`[roi-diagnosis] Wrote ${mdPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
