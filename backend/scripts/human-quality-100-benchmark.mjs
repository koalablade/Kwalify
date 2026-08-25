#!/usr/bin/env node
/**
 * 100-generation human-centric quality benchmark.
 * Uses real audit-mode /api/generate — does NOT modify the engine.
 */
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveLiveBenchmarkCredentials } = require("../dist/lib/benchmark-env.js");
const {
  build100GenerationRunPlan,
  build100GenerationReport,
  evaluateRecordFromResponse,
  BENCHMARK100_PLAYLIST_LENGTH,
} = require("../dist/lib/human-quality-evaluator/benchmark-100.js");
const { deploymentVersion } = require("../dist/lib/deployment-version.js");

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  return {
    dryRun: args.includes("--dry-run"),
    resume: args.includes("--resume"),
    limit: get("--limit", null) ? Number.parseInt(get("--limit", "100"), 10) : 100,
    delayMs: Number.parseInt(get("--delay-ms", "4000"), 10),
    timeoutMs: Number.parseInt(get("--timeout-ms", "180000"), 10),
    outDir: get("--out", join(process.cwd(), "reports", "human-quality", "100-gen")),
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function readJsonl(path) {
  try {
    const raw = await readFile(path, "utf8");
    return raw.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

async function generateAudit(creds, runItem, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${creds.baseUrl}/api/generate?audit=1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-kwalify-evaluation-token": creds.token,
      },
      body: JSON.stringify({
        vibe: runItem.prompt,
        mode: "balanced",
        length: BENCHMARK100_PLAYLIST_LENGTH,
        varietyBoost: true,
        auditMode: true,
        spotifyUserId: creds.spotifyUserId,
        requestId: runItem.requestId,
        seed: runItem.seed,
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = { parseError: true, rawPreview: text.slice(0, 200) };
    }
    return { httpStatus: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const opts = parseArgs();
  const plan = build100GenerationRunPlan(opts.limit);
  let benchmarkRunId = `hq100-${randomUUID().slice(0, 8)}`;

  await mkdir(opts.outDir, { recursive: true });
  const resultsPath = join(opts.outDir, "results.jsonl");
  const metaPath = join(opts.outDir, "run-meta.json");

  if (opts.resume) {
    try {
      const meta = JSON.parse(await readFile(metaPath, "utf8"));
      benchmarkRunId = meta.benchmarkRunId ?? benchmarkRunId;
    } catch {
      /* fresh meta */
    }
  } else {
    await writeFile(
      metaPath,
      `${JSON.stringify({
        benchmarkRunId,
        startedAt: new Date().toISOString(),
        target: opts.limit,
        engineCommit: deploymentVersion(),
      })}\n`,
    );
  }

  const existing = opts.resume ? await readJsonl(resultsPath) : [];
  const doneIds = new Set(existing.map((r) => r.runItem?.promptId));

  if (opts.dryRun) {
    console.log(`Dry run: ${plan.length} generations | run ${benchmarkRunId}`);
    for (const item of plan) console.log(`  ${item.promptId}: [${item.category}] ${item.prompt}`);
    return;
  }

  const creds = resolveLiveBenchmarkCredentials({
    strict: true,
    defaultBaseUrl: "http://127.0.0.1:5000",
    cli: {
      baseUrl: process.env.KWALIFY_BENCHMARK_BASE_URL || process.env.SMOKE_BASE_URL || "http://127.0.0.1:5000",
    },
  });

  console.log(`[hq100] ${benchmarkRunId} | plan ${plan.length} | done ${existing.length} | ${creds.baseUrl}`);
  const records = [...existing];

  for (let index = 0; index < plan.length; index++) {
    const runItem = plan[index];
    if (doneIds.has(runItem.promptId)) continue;

    console.log(`[hq100] ${index + 1}/${plan.length} ${runItem.promptId}`);
    const startedAt = new Date().toISOString();
    let record;

    try {
      const { httpStatus, data } = await generateAudit(creds, runItem, opts.timeoutMs);
      const trackCount = Array.isArray(data.tracks) ? data.tracks.length : 0;
      const success = httpStatus >= 200 && httpStatus < 300 && data.success === true && trackCount > 0;
      record = {
        benchmarkRunId,
        runItem,
        startedAt,
        completedAt: new Date().toISOString(),
        httpStatus,
        success,
        error: success ? null : String(data.message ?? data.error ?? data.code ?? `http_${httpStatus}`),
        commit: deploymentVersion(),
        evaluated: evaluateRecordFromResponse(runItem, { ...data, requestId: runItem.requestId }, httpStatus),
        rawResponse: {
          candidateFunnel: data.candidateFunnel ?? null,
          candidateLineage: data.candidateLineage ?? null,
          deliveryLossFunnel: data.deliveryLossFunnel ?? null,
          retrievalFunnel: data.retrievalFunnel ?? null,
          puritySubFunnel: data.puritySubFunnel ?? null,
          count: Array.isArray(data.tracks) ? data.tracks.length : 0,
          success: data.success ?? false,
          httpStatus,
          error: data.message ?? data.error ?? data.code ?? null,
        },
      };
    } catch (err) {
      record = {
        benchmarkRunId,
        runItem,
        startedAt,
        completedAt: new Date().toISOString(),
        httpStatus: 0,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        commit: deploymentVersion(),
        evaluated: evaluateRecordFromResponse(runItem, { tracks: [], vibe: runItem.prompt }, 0),
        rawResponse: null,
      };
    }

    records.push(record);
    await appendFile(resultsPath, `${JSON.stringify(record)}\n`);
    doneIds.add(runItem.promptId);
    console.log(
      `[hq100]   ${record.success ? "OK" : "FAIL"} ${record.evaluated.tracks.length} tracks | ${record.evaluated.automated.automatedHypothesis.humanQuality}`,
    );

    if (index + 1 < plan.length) await sleep(opts.delayMs);
  }

  const { markdown, summary } = build100GenerationReport({
    benchmarkRunId,
    engineCommit: deploymentVersion(),
    records,
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const mdPath = join(opts.outDir, `100-generation-report-${stamp}.md`);
  const jsonPath = join(opts.outDir, `100-generation-report-${stamp}.json`);
  await writeFile(mdPath, markdown);
  await writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`[hq100] Report: ${mdPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
