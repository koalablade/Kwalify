/**
 * Stage-by-stage pipeline diagnosis for the 10 worst-performing benchmark prompts.
 * Diagnosis only — does not modify generation logic.
 *
 * Usage:
 *   npm run diagnosis:worst-prompts
 *   npm run diagnosis:worst-prompts -- --live --spawn-local
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureEvalReady } from "../lib/benchmark-local-server";
import { resolveLiveBenchmarkCredentials } from "../lib/benchmark-env";
import { analyzeConvergence } from "../lib/pipeline-diagnosis/compare";
import { extractPipelineTrace } from "../lib/pipeline-diagnosis/extract";
import {
  renderMarkdownReport,
  type DiagnosisReportBundle,
  type PromptDiagnosisReport,
} from "../lib/pipeline-diagnosis/report";
import { WORST_PROMPT_IDS } from "../lib/pipeline-diagnosis/worst-prompts";
import { PLAYLIST_BENCHMARK_PROMPTS } from "../lib/playlist-evaluation/benchmark-prompts";

type StoredResult = {
  benchmark: { id: string; category: string; prompt: string };
  ok: boolean;
  response: Record<string, unknown> | null;
};

type CliConfig = {
  baselineDir: string;
  currentDir: string;
  outDir: string;
  live: boolean;
  spawnLocal: boolean;
  baseUrl: string;
  spotifyUserId: string;
  token: string;
};

const ROOT = path.resolve(__dirname, "..", "..", "..");

function parseArgs(argv: string[]): CliConfig {
  const creds = resolveLiveBenchmarkCredentials({
    cli: {},
    strict: false,
    defaultBaseUrl: "http://localhost:5000",
  });

  let baselineDir = path.join(ROOT, "reports", "playlist-evaluation", "live-6h-baseline-2026-07-07");
  let currentDir = path.join(ROOT, "reports", "playlist-evaluation", "live-6h");
  let outDir = path.join(ROOT, "reports", "playlist-evaluation", "pipeline-trace-worst-10");
  let live = false;
  let spawnLocal = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--baseline-dir" && argv[i + 1]) baselineDir = path.resolve(argv[++i]);
    else if (arg === "--current-dir" && argv[i + 1]) currentDir = path.resolve(argv[++i]);
    else if (arg === "--out" && argv[i + 1]) outDir = path.resolve(argv[++i]);
    else if (arg === "--base-url" && argv[i + 1]) creds.baseUrl = argv[++i];
    else if (arg === "--live") live = true;
    else if (arg === "--spawn-local") spawnLocal = true;
  }

  if (!creds.token || !creds.spotifyUserId) {
    if (live) {
      throw new Error("Missing PLAYLIST_EVAL_TOKEN or SMOKE_SPOTIFY_USER_ID in repo-root .env (required for --live)");
    }
  }

  return {
    baselineDir,
    currentDir,
    outDir,
    live,
    spawnLocal,
    baseUrl: creds.baseUrl,
    spotifyUserId: creds.spotifyUserId ?? "koalablade",
    token: creds.token ?? "",
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

async function fetchLiveTrace(
  config: CliConfig,
  prompt: (typeof PLAYLIST_BENCHMARK_PROMPTS)[number],
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-kwalify-evaluation-token": config.token,
  };

  const body = {
    vibe: prompt.prompt,
    mode: prompt.mode,
    length: prompt.length,
    auditMode: true,
    spotifyUserId: config.spotifyUserId,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
  try {
    const res = await fetch(`${config.baseUrl}/api/generate?audit=1&debug=1`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ...data, _diagnosisHttp: { status: res.status, ok: res.ok } };
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  console.error("[diagnosis] Loading stored benchmark results...");
  const [baselineMap, currentMap] = await Promise.all([
    loadJsonl(config.baselineDir),
    loadJsonl(config.currentDir),
  ]);

  let shutdown: (() => void) | null = null;
  if (config.live) {
    if (!config.token) {
      throw new Error("--live requires PLAYLIST_EVAL_TOKEN in repo-root .env");
    }
    process.env["EVAL_AUDIT_MAX_TRACKS"] = "30";
    process.env["EVAL_AUDIT_MAX_ARRAY_ITEMS"] = "25";
    process.env["EVAL_AUDIT_MAX_STAGE_TRACE"] = "32";
    const ready = await ensureEvalReady(
      config.baseUrl,
      config.token,
      config.spawnLocal,
      "npm run diagnosis:worst-prompts -- --live --spawn-local",
    );
    config.baseUrl = ready.baseUrl;
    shutdown = ready.shutdown;
    console.error(`[diagnosis] Live API ready at ${config.baseUrl}`);
  }

  const prompts: PromptDiagnosisReport[] = [];

  try {
    for (const promptId of WORST_PROMPT_IDS) {
      const meta = PLAYLIST_BENCHMARK_PROMPTS.find((p) => p.id === promptId);
      if (!meta) {
        console.error(`[diagnosis] WARN: prompt ${promptId} not in benchmark catalog`);
        continue;
      }

      const baselineRow = baselineMap.get(promptId);
      const currentRow = currentMap.get(promptId);
      if (!baselineRow?.response || !currentRow?.response) {
        console.error(`[diagnosis] WARN: missing stored result for ${promptId}`);
        continue;
      }

      let currentResponse = currentRow.response;
      if (config.live) {
        console.error(`[diagnosis] Live fetch: ${promptId}...`);
        currentResponse = await fetchLiveTrace(config, meta);
      }

      const baselineTrace = extractPipelineTrace(promptId, baselineRow.response, "stored");
      const currentTrace = extractPipelineTrace(
        promptId,
        currentResponse,
        config.live ? "live" : "stored",
      );
      const convergence = analyzeConvergence(baselineTrace, currentTrace, baselineRow.response);

      prompts.push({
        promptId,
        prompt: meta.prompt,
        category: meta.category,
        baseline: baselineTrace,
        current: currentTrace,
        convergence,
      });

      console.error(
        `[diagnosis] ${promptId}: final jaccard=${convergence.finalJaccard}, convergence=${convergence.firstStageMatchingBaselineFinal ?? "never"}`,
      );
    }
  } finally {
    shutdown?.();
  }

  const bundle: DiagnosisReportBundle = {
    generatedAt: new Date().toISOString(),
    baselineDir: config.baselineDir,
    currentDir: config.currentDir,
    liveRefetch: config.live,
    prompts,
  };

  await mkdir(config.outDir, { recursive: true });
  const jsonPath = path.join(config.outDir, "pipeline-diagnosis.json");
  const mdPath = path.join(config.outDir, "pipeline-diagnosis.md");
  await writeFile(jsonPath, JSON.stringify(bundle, null, 2), "utf8");
  await writeFile(mdPath, renderMarkdownReport(bundle), "utf8");

  console.error(`[diagnosis] Wrote ${jsonPath}`);
  console.error(`[diagnosis] Wrote ${mdPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
