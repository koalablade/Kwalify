/**
 * Live 500-playlist fault-diagnosis benchmark.
 * Max prompt diversity; rich diagnostics for later root-cause analysis.
 *
 * Usage:
 *   npm run build
 *   node scripts/build-fault-diagnosis-corpus.mjs
 *   npm run benchmark:live-fault-500
 *
 * Options:
 *   --target 500          Total playlist generations (default 500)
 *   --length N            Override track length (default: per-prompt)
 *   --delay-ms 5000       Delay between requests
 *   --timeout-ms 180000   Per-request timeout
 *   --resume              Skip completed runIds
 *   --budget-ms N         Optional wall-clock cap
 */

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveVerifiedProductionCredentials } = require("../backend/dist/lib/benchmark-env");
const { normalizeEvalToken } = require("../backend/dist/lib/eval-token-normalize");
const { readLocalDotEnvValue } = require("../backend/dist/lib/benchmark-env-dotenv");
const { evaluateWouldISave } = require("../backend/dist/core/editorial/would-i-save-evaluator");

const CORPUS_PATH = path.resolve("data/corpus/fault-diagnosis-prompt-corpus.json");
const REPORT_PATH = path.resolve("reports/live-fault-diagnosis-500.json");
const SUMMARY_PATH = path.resolve("reports/live-fault-diagnosis-500-summary.json");
const FAULTS_PATH = path.resolve("reports/live-fault-diagnosis-500-faults.md");

function authCookie() {
  const raw =
    process.env.PLAYLIST_BENCHMARK_AUTH_COOKIE?.trim()
    || process.env.COOKIE_VALUE?.trim()
    || readLocalDotEnvValue("PLAYLIST_BENCHMARK_AUTH_COOKIE")
    || readLocalDotEnvValue("COOKIE_VALUE");
  if (!raw) return null;
  if (raw.includes("=")) return raw;
  return `connect.sid=${raw}`;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  return {
    target: Number.parseInt(get("--target", "500"), 10),
    lengthOverride: get("--length", null) ? Number.parseInt(get("--length", "25"), 10) : null,
    delayMs: Number.parseInt(get("--delay-ms", "5000"), 10),
    timeoutMs: Number.parseInt(get("--timeout-ms", "180000"), 10),
    budgetMs: get("--budget-ms", null) ? Number.parseInt(get("--budget-ms", "0"), 10) : null,
    resume: args.includes("--resume"),
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function lockedIntentStub() {
  return {
    genreFamilies: [],
    primaryGenre: null,
    primarySubgenre: null,
    secondarySubgenre: null,
    subgenreTerms: [],
    eraRange: null,
    mood: [],
    activity: null,
    energy: null,
  };
}

function toPatternTrack(t) {
  return {
    trackId: `${t.artistName ?? t.artist}-${t.trackName ?? t.name}`.toLowerCase().replace(/\s+/g, "-"),
    trackName: t.trackName ?? t.name ?? "?",
    artistName: t.artistName ?? t.artist ?? "?",
    genreFamily: t.genreFamily ?? null,
    energy: t.energy ?? null,
    valence: t.valence ?? null,
    danceability: t.danceability ?? null,
    acousticness: t.acousticness ?? null,
    rediscoveryScore: t.rediscoveryScore ?? 0.4,
  };
}

function classifyFailure(row) {
  if (row.httpStatus === 200 && row.trackCount >= row.requestedLength * 0.85) return "success_full";
  if (row.httpStatus === 200 && row.trackCount >= 15) return "success_partial_fill";
  if (row.httpStatus === 200 && row.trackCount > 0) return "success_sparse";
  if (row.httpStatus === 422) {
    const err = `${row.error ?? ""} ${row.rejectionReasons.join(" ")}`.toLowerCase();
    if (err.includes("insufficient_intent_pool") || err.includes("post_filter=0")) return "fault_intent_pool_collapse";
    if (err.includes("opening_eligible")) return "fault_opening_eligible_zero";
    if (err.includes("incompatible_with") || err.includes("archetype")) return "fault_archetype_mismatch";
    if (err.includes("human_saveability") || err.includes("curator_score")) return "fault_gate_rejection";
    return "fault_422_other";
  }
  if (row.httpStatus === 409) return "fault_conflict";
  if (row.httpStatus === 429) return "fault_rate_limit";
  if (row.httpStatus === 0 || row.error?.includes("abort")) return "fault_timeout";
  if (row.executionPath === "timeout_fallback") return "fault_timeout_fallback";
  if (row.httpStatus >= 500) return "fault_server_error";
  return "fault_other";
}

function buildRunPlan(corpus, target) {
  const prompts = corpus.prompts ?? [];
  if (!prompts.length) throw new Error("Empty corpus");
  const seeds = [1, 2, 3, 4, 5];
  const plan = [];
  let seedIdx = 0;
  let promptIdx = 0;
  while (plan.length < target) {
    const p = prompts[promptIdx % prompts.length];
    const seed = seeds[seedIdx % seeds.length];
    const runId = `${p.id}__seed${seed}__${plan.length + 1}`;
    plan.push({
      runId,
      promptId: p.id,
      prompt: p.prompt,
      category: p.category,
      tags: p.tags ?? [],
      source: p.source,
      mode: p.mode ?? "balanced",
      length: p.length ?? 25,
      seed,
    });
    promptIdx += 1;
    if (promptIdx % prompts.length === 0) seedIdx += 1;
  }
  return plan;
}

function extractDiagnostics(data, httpStatus, requestedLength) {
  const trace = data.playlistExecutionTrace ?? {};
  const gate = data.humanSaveabilityGate ?? {};
  const intent = data.intentCollapseLayer ?? trace.intentCollapseLayer ?? null;
  const counts = trace.trackCounts ?? {};
  const stage = trace.stageAttribution ?? {};
  const tracks = Array.isArray(data.tracks) ? data.tracks : [];
  const samplerRan = stage.sampler?.status === "completed" || (counts.after_sampler ?? 0) > 0;

  return {
    httpStatus,
    executionPath: trace.executionPath ?? null,
    funnelCollapseStage: trace.funnelCollapseStage ?? null,
    editorialWorldTag: intent?.editorialWorldTag ?? null,
    retrievalCount: counts.retrieved ?? intent?.preFilterCount ?? null,
    postFilterCount: intent?.postFilterCount ?? null,
    samplerCount: counts.after_sampler ?? null,
    samplerExecuted: samplerRan,
    gateExecuted: trace.debugFlags?.gateExecuted === true || gate.humanSaveable != null,
    humanSaveable: trace.humanSaveable === true || gate.humanSaveable === true,
    gateBypassed: trace.debugFlags?.gateBypassed === true,
    curatorScore: trace.curatorScore ?? gate.curatorScore ?? null,
    rejectionReasons: trace.rejectionReasons ?? [],
    error: data.error ?? data.message ?? null,
    trackCount: tracks.length,
    requestedLength,
    fillRatio: requestedLength > 0 ? tracks.length / requestedLength : 0,
    spotifyPlaylistUrl: data.spotifyPlaylistUrl ?? data.playlistUrl ?? null,
    pairwiseSelection: data.v3Diagnostics?.controlledGeneration?.pairwiseSelection ?? null,
    candidateSelectionMethod: data.v3Diagnostics?.controlledGeneration?.candidateSelectionMethod ?? null,
    candidateCount: data.v3Diagnostics?.controlledGeneration?.pairwiseSelection?.candidateCount ?? null,
    firstTen: tracks.slice(0, 10).map((t) =>
      `${t.artistName ?? t.artist ?? "?"} — ${t.trackName ?? t.name ?? "?"}`,
    ),
    tracks: tracks.map(toPatternTrack),
  };
}

function summarizeRuns(runs) {
  const n = runs.length || 1;
  const buckets = {};
  const byCategory = {};
  const byHttpStatus = {};
  const byExecutionPath = {};
  for (const r of runs) {
    buckets[r.failureBucket] = (buckets[r.failureBucket] ?? 0) + 1;
    byCategory[r.category] = byCategory[r.category] ?? { total: 0, success: 0, faults: 0 };
    byCategory[r.category].total += 1;
    if (r.httpStatus === 200 && r.trackCount >= 15) byCategory[r.category].success += 1;
    else byCategory[r.category].faults += 1;
    byHttpStatus[String(r.httpStatus)] = (byHttpStatus[String(r.httpStatus)] ?? 0) + 1;
    const ep = r.executionPath ?? "unknown";
    byExecutionPath[ep] = (byExecutionPath[ep] ?? 0) + 1;
  }

  const wouldSave = runs.map((r) => r.wouldISave?.combinedScore).filter((s) => typeof s === "number");
  return {
    completedRuns: runs.length,
    http200: runs.filter((r) => r.httpStatus === 200).length,
    http422: runs.filter((r) => r.httpStatus === 422).length,
    http409: runs.filter((r) => r.httpStatus === 409).length,
    successRate: runs.filter((r) => r.failureBucket.startsWith("success")).length / n,
    humanSaveableRate: runs.filter((r) => r.humanSaveable).length / n,
    samplerExecutedRate: runs.filter((r) => r.samplerExecuted).length / n,
    timeoutFallbackRate: runs.filter((r) => r.executionPath === "timeout_fallback").length / n,
    avgFillRatio: runs.filter((r) => r.httpStatus === 200).length
      ? runs.filter((r) => r.httpStatus === 200).reduce((a, b) => a + b.fillRatio, 0) / runs.filter((r) => r.httpStatus === 200).length
      : null,
    avgWouldSaveScore: wouldSave.length ? wouldSave.reduce((a, b) => a + b, 0) / wouldSave.length : null,
    failureBuckets: buckets,
    byCategory,
    byHttpStatus,
    byExecutionPath,
  };
}

function buildFaultMarkdown(payload) {
  const s = payload.summary;
  const lines = [
    "# Live Fault Diagnosis — 500 playlist benchmark",
    "",
    `Generated: ${payload.generatedAt}`,
    `Deploy: \`${payload.productionCommit?.slice(0, 7) ?? "?"}\``,
    `Mode: ${payload.mode} | User: ${payload.spotifyUserId}`,
    `Completed: ${s.completedRuns}/${payload.targetRuns} | Unique prompts in corpus: ${payload.uniquePromptCount}`,
    "",
    "## Failure buckets (for diagnosis)",
    "",
    "| Bucket | Count | Share |",
    "|--------|------:|------:|",
  ];
  const total = s.completedRuns || 1;
  for (const [bucket, count] of Object.entries(s.failureBuckets ?? {}).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${bucket} | ${count} | ${Math.round((count / total) * 1000) / 10}% |`);
  }
  lines.push("", "## By category", "", "| Category | Total | OK | Faults |", "|----------|------:|---:|-------:|");
  for (const [cat, row] of Object.entries(s.byCategory ?? {}).sort((a, b) => b[1].faults - a[1].faults)) {
    lines.push(`| ${cat} | ${row.total} | ${row.success} | ${row.faults} |`);
  }
  lines.push(
    "",
    "## Headline rates",
    "",
    `- Success (any): ${Math.round(s.successRate * 1000) / 10}%`,
    `- humanSaveable gate: ${Math.round(s.humanSaveableRate * 1000) / 10}%`,
    `- HTTP 422: ${s.http422}/${total}`,
    `- Sampler executed: ${Math.round(s.samplerExecutedRate * 1000) / 10}%`,
    `- Timeout fallback: ${Math.round(s.timeoutFallbackRate * 1000) / 10}%`,
    `- Avg fill ratio (200s): ${s.avgFillRatio != null ? Math.round(s.avgFillRatio * 1000) / 10 + "%" : "—"}`,
    "",
  );
  return lines.join("\n");
}

async function generateOne(creds, token, cookie, planItem, length, timeoutMs) {
  const useLiveAuth = !!cookie;
  const url = useLiveAuth ? `${creds.baseUrl}/api/generate` : `${creds.baseUrl}/api/generate?audit=1`;
  const headers = useLiveAuth
    ? { "Content-Type": "application/json", Cookie: cookie }
    : { "Content-Type": "application/json", "x-kwalify-evaluation-token": token };
  const body = useLiveAuth
    ? {
      vibe: planItem.prompt,
      mode: planItem.mode,
      length,
      varietyBoost: true,
      seed: planItem.seed,
      requestId: `fault500-${planItem.runId}`,
    }
    : {
      vibe: planItem.prompt,
      mode: planItem.mode,
      length,
      spotifyUserId: creds.spotifyUserId,
      seed: planItem.seed,
      auditMode: true,
      requestId: `fault500-${planItem.runId}`,
    };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
    const data = await res.json();
    return { httpStatus: res.status, data };
  } catch (err) {
    return { httpStatus: 0, data: { error: String(err) } };
  } finally {
    clearTimeout(timer);
  }
}

async function ensureCorpus() {
  try {
    await access(CORPUS_PATH);
  } catch {
    process.stderr.write("[fault-500] building corpus...\n");
    const { execSync } = await import("node:child_process");
    execSync("node scripts/build-fault-diagnosis-corpus.mjs", { stdio: "inherit", cwd: process.cwd() });
  }
  return JSON.parse(await readFile(CORPUS_PATH, "utf8"));
}

async function main() {
  const config = parseArgs();
  const creds = await resolveVerifiedProductionCredentials({ strict: true });
  const token = normalizeEvalToken(creds.token);
  const cookie = authCookie();
  const mode = cookie ? "live-auth" : "audit";

  const ready = await fetch(`${creds.baseUrl}/api/readyz`);
  const readyData = await ready.json();

  if (cookie) {
    const meRes = await fetch(`${creds.baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
    const me = await meRes.json();
    if (!meRes.ok) throw new Error(`Auth failed: ${me.error ?? me.message}`);
    process.stderr.write(`[fault-500] live auth as ${me.id ?? me.spotifyUserId ?? "?"}\n`);
  } else {
    process.stderr.write(`[fault-500] audit mode user=${creds.spotifyUserId}\n`);
  }

  const corpus = await ensureCorpus();
  const plan = buildRunPlan(corpus, config.target);

  let existing = [];
  if (config.resume) {
    try {
      existing = JSON.parse(await readFile(REPORT_PATH, "utf8")).runs ?? [];
    } catch {
      existing = [];
    }
  }
  const done = new Set(existing.map((r) => r.runId));
  const runs = [...existing];
  const startedAt = Date.now();

  process.stderr.write(
    `[fault-500] deploy=${readyData.commit?.slice(0, 7)} target=${config.target} corpus=${corpus.uniquePromptCount} todo=${plan.length - done.size}\n`,
  );

  for (const item of plan) {
    if (done.has(item.runId)) continue;
    if (config.budgetMs && Date.now() - startedAt >= config.budgetMs) {
      process.stderr.write("[fault-500] budget exhausted\n");
      break;
    }

    const length = config.lengthOverride ?? item.length;
    const t0 = Date.now();
    process.stderr.write(`[fault-500] ${runs.length + 1}/${config.target} ${item.runId}...\n`);

    const gen = await generateOne(creds, token, cookie, item, length, config.timeoutMs);
    const diag = extractDiagnostics(gen.data ?? {}, gen.httpStatus, length);
    const wouldISave = evaluateWouldISave({
      prompt: item.prompt,
      tracks: diag.tracks,
      context: null,
      lockedIntent: lockedIntentStub(),
    });

    const row = {
      runId: item.runId,
      promptId: item.promptId,
      prompt: item.prompt,
      category: item.category,
      tags: item.tags,
      source: item.source,
      mode: item.mode,
      seed: item.seed,
      requestedLength: length,
      durationMs: Date.now() - t0,
      ...diag,
      wouldISave,
      failureBucket: classifyFailure({ ...diag, requestedLength: length }),
    };
    delete row.tracks;

    runs.push(row);
    done.add(item.runId);

    const payload = {
      generatedAt: new Date().toISOString(),
      productionCommit: readyData.commit ?? null,
      baseUrl: creds.baseUrl,
      mode,
      spotifyUserId: creds.spotifyUserId,
      targetRuns: config.target,
      uniquePromptCount: corpus.uniquePromptCount,
      elapsedMs: Date.now() - startedAt,
      summary: summarizeRuns(runs),
      runs,
    };

    await mkdir(path.dirname(REPORT_PATH), { recursive: true });
    await writeFile(REPORT_PATH, JSON.stringify(payload, null, 2));
    await writeFile(SUMMARY_PATH, JSON.stringify(payload.summary, null, 2));
    await writeFile(FAULTS_PATH, buildFaultMarkdown(payload));

    process.stderr.write(
      `[fault-500] ${item.runId} → ${row.httpStatus} tracks=${row.trackCount} bucket=${row.failureBucket}\n`,
    );

    if (runs.length < config.target) await sleep(config.delayMs);
  }

  const finalPayload = {
    generatedAt: new Date().toISOString(),
    productionCommit: readyData.commit ?? null,
    baseUrl: creds.baseUrl,
    mode,
    spotifyUserId: creds.spotifyUserId,
    targetRuns: config.target,
    uniquePromptCount: corpus.uniquePromptCount,
    elapsedMs: Date.now() - startedAt,
    summary: summarizeRuns(runs),
    runs,
  };

  await writeFile(REPORT_PATH, JSON.stringify(finalPayload, null, 2));
  await writeFile(SUMMARY_PATH, JSON.stringify(finalPayload.summary, null, 2));
  await writeFile(FAULTS_PATH, buildFaultMarkdown(finalPayload));

  console.log(JSON.stringify({
    report: REPORT_PATH,
    summary: SUMMARY_PATH,
    faults: FAULTS_PATH,
    completed: runs.length,
    target: config.target,
    summaryStats: finalPayload.summary,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
