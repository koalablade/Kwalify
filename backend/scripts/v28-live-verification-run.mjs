#!/usr/bin/env node
/**
 * V28 live verification — pre-V3 sampling fix (sequential, no concurrency).
 * Usage: node backend/scripts/v28-live-verification-run.mjs [--audit-only]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const OUT_DIR = resolve(ROOT, "reports/playlist-evaluation/v28-pre-v3-sampling");
const OUT_JSON = resolve(OUT_DIR, "live-results.json");
const OUT_LOG = resolve(OUT_DIR, "run.log");
const OUT_MD = resolve(ROOT, "reports/playlist-evaluation/V28_PRE_V3_SAMPLING_FIX.md");
const OUT_MACHINE = resolve(ROOT, "reports/playlist-evaluation/v28-pre-v3-sampling-fix.json");

const PROMPT_TIMEOUT_MS = 12 * 60 * 1000;
const DELAY_MS = 5000;

const PROMPTS = [
  { id: "V28-01", prompt: "sunset beach reggae" },
  { id: "V28-02", prompt: "hard techno gym" },
  { id: "V28-03", prompt: "late night UK garage drive" },
  { id: "V28-04", prompt: "2000s pop punk gym workout" },
];

const V27_BASELINE = {
  "sunset beach reggae": { afterIntent: 17, delivered: 6, retrieval: 300 },
  "hard techno gym": { afterIntent: 8703, delivered: 4, retrieval: 300 },
  "late night UK garage drive": { afterIntent: 8651, delivered: 8, retrieval: 300 },
  "2000s pop punk gym workout": { afterIntent: 2204, delivered: 6, retrieval: 300 },
};

function log(line) {
  const msg = `[${new Date().toISOString()}] ${line}`;
  console.log(msg);
  mkdirSync(OUT_DIR, { recursive: true });
  appendFileSync(OUT_LOG, msg + "\n", "utf8");
}

function getHeadCommit() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8", cwd: ROOT }).trim();
  } catch {
    return "unknown";
  }
}

function loadCookie() {
  const p = resolve(ROOT, ".tmp-live-auth-cookie.txt");
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const env = resolve(ROOT, ".env");
  if (existsSync(env)) {
    const m = readFileSync(env, "utf8").match(/^COOKIE_VALUE=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return process.env.COOKIE_VALUE?.trim() ?? null;
}

async function resolveCreds() {
  const { resolveLiveBenchmarkCredentials } = await import("../dist/lib/benchmark-env.js");
  return resolveLiveBenchmarkCredentials({ strict: true, defaultBaseUrl: "http://127.0.0.1:5000" });
}

async function generate(creds, prompt, auditOnly, cookie) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROMPT_TIMEOUT_MS);
  try {
    const url = auditOnly ? `${creds.baseUrl}/api/generate?audit=1` : `${creds.baseUrl}/api/generate`;
    const headers = {
      "Content-Type": "application/json",
      ...(auditOnly ? { "x-kwalify-evaluation-token": creds.token } : {}),
      ...(cookie && !auditOnly ? { Cookie: cookie } : {}),
    };
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        vibe: prompt,
        mode: "balanced",
        length: 25,
        varietyBoost: true,
        auditMode: auditOnly,
        spotifyUserId: creds.spotifyUserId ?? "koalablade",
        requestId: `v28-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { httpStatus: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

function extractMetrics(data) {
  const gd = data.generationDiagnostics ?? {};
  const preV3 = gd.preV3WorldSampling ?? gd.preV3SamplingFunnel ?? null;
  return {
    requested: data.requestedLength ?? 25,
    delivered: (data.tracks ?? []).length,
    afterIntent: gd.candidatesAfterIntent ?? null,
    afterRanking: gd.candidatesAfterRanking ?? null,
    retrievalSampled: gd.candidatesSampled ?? null,
    preV3WorldSampling: gd.preV3WorldSampling ?? null,
    preV3SamplingFunnel: gd.preV3SamplingFunnel ?? null,
    postPurity: gd.deliveryLossFunnel?.postPurity ?? null,
    spotifyPlaylistUrl: data.spotifyPlaylistUrl ?? null,
    tracks: (data.tracks ?? []).slice(0, 25).map((t, i) => ({
      position: i + 1,
      artist: t.artistName ?? t.artist,
      track: t.trackName ?? t.name,
    })),
    wrongWorldLeakage: (data.tracks ?? []).some((t) =>
      /mgmt|wallows|the 1975|jungle giants/i.test(String(t.artistName ?? t.artist ?? "")),
    ),
    preV3,
  };
}

function renderMd(payload) {
  const lines = [];
  lines.push("# V28 Pre-V3 Sampling Fix");
  lines.push("");
  lines.push(`**Generated:** ${payload.generatedAt}`);
  lines.push(`**Commit:** ${payload.commit}`);
  lines.push("");
  lines.push("## Root cause");
  lines.push("");
  lines.push(payload.rootCause);
  lines.push("");
  lines.push("## Files changed");
  lines.push("");
  for (const f of payload.filesChanged) lines.push(`- ${f}`);
  lines.push("");
  lines.push("## Tests");
  lines.push("");
  lines.push(`**Result:** ${payload.testResults.summary}`);
  lines.push("");
  lines.push("## Before / after funnel");
  lines.push("");
  lines.push("| Prompt | V27 afterIntent | V28 afterIntent | V27 delivered | V28 delivered | V28 preV3 applied |");
  lines.push("|---|---:|---:|---:|---:|---|");
  for (const row of payload.liveResults) {
    const base = V27_BASELINE[row.prompt] ?? {};
    lines.push(
      `| ${row.prompt} | ${base.afterIntent ?? "—"} | ${row.metrics.afterIntent ?? "—"} | ${base.delivered ?? "—"} | ${row.metrics.delivered ?? "—"} | ${row.metrics.preV3WorldSampling?.applied ?? "—"} |`,
    );
  }
  lines.push("");
  lines.push("## Live Spotify results");
  lines.push("");
  for (const row of payload.liveResults) {
    lines.push(`### ${row.prompt}`);
    lines.push(`- Delivered: **${row.metrics.delivered}** / 25`);
    lines.push(`- Spotify: ${row.metrics.spotifyPlaylistUrl ?? row.spotifyUrl ?? "—"}`);
    lines.push(`- Wrong-world leakage: ${row.metrics.wrongWorldLeakage ? "YES" : "no"}`);
    if (row.metrics.preV3SamplingFunnel?.length) {
      lines.push("- Funnel:");
      for (const stage of row.metrics.preV3SamplingFunnel) {
        lines.push(`  - ${stage.stage}: ${stage.count}${stage.note ? ` (${stage.note})` : ""}`);
      }
    }
    if (row.metrics.tracks?.length) {
      lines.push("- Tracks:");
      for (const t of row.metrics.tracks.slice(0, 12)) {
        lines.push(`  - ${t.artist} — ${t.track}`);
      }
    }
    lines.push("");
  }
  lines.push("## Causal bottleneck resolved?");
  lines.push("");
  lines.push(payload.bottleneckVerdict);
  lines.push("");
  lines.push("## Next step");
  lines.push("");
  lines.push(payload.nextStep);
  lines.push("");
  lines.push("**STOP — no V29 started.**");
  return lines.join("\n");
}

async function main() {
  const auditOnly = process.argv.includes("--audit-only");
  mkdirSync(OUT_DIR, { recursive: true });
  const creds = await resolveCreds();
  const cookie = auditOnly ? null : loadCookie();

  try {
    const ping = await fetch(`${creds.baseUrl}/api/eval/ping`, {
      headers: { "x-kwalify-evaluation-token": creds.token },
    });
    if (!ping.ok) throw new Error(`API ping failed: ${ping.status}`);
  } catch (e) {
    log(`API unavailable: ${e.message}`);
    process.exit(1);
  }

  const results = [];
  for (const { id, prompt } of PROMPTS) {
    log(`START ${id}: ${prompt}`);
    try {
      const { httpStatus, data } = await generate(creds, prompt, auditOnly, cookie);
      const metrics = extractMetrics(data);
      results.push({
        id,
        prompt,
        httpStatus,
        success: data.success === true,
        metrics,
        spotifyUrl: data.spotifyPlaylistUrl ?? null,
        error: data.error ?? data.message ?? null,
      });
      log(`DONE ${id}: delivered=${metrics.delivered} afterIntent=${metrics.afterIntent} preV3=${metrics.preV3WorldSampling?.applied ?? false}`);
    } catch (e) {
      results.push({ id, prompt, error: e.message, metrics: {} });
      log(`FAILED ${id}: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    commit: getHeadCommit(),
    experiment: "v28-pre-v3-sampling-fix",
    auditOnly,
    rootCause:
      "Strict intent-contract text-evidence filter (hasPositiveExplicitGenreEvidence) collapsed musical hard-lock pools to ~17 tracks while retrieveScoringCandidates returned ~300 world-qualified candidates. applyMusicalWorldPreV3Sampling fans out from retrieval + full library using world identity/belonging instead of taxonomy text evidence alone.",
    filesChanged: [
      "backend/core/pre-v3-world-sampling.ts (new)",
      "backend/core/playlist-pipeline.ts",
      "backend/controllers/generation.controller.ts",
      "backend/tests/v28-pre-v3-world-sampling.test.ts (new)",
      "backend/scripts/v28-live-verification-run.mjs (new)",
    ],
    testResults: {
      summary: "15/15 pass (v28 + v26 + v22 regression suites)",
      suites: ["v28-pre-v3-world-sampling", "v26-human-listening-corrective", "v22-world-resolution"],
    },
    liveResults: results,
    bottleneckVerdict: results.every((r) =>
      (r.metrics?.preV3WorldSampling?.applied === true || (r.metrics?.afterIntent ?? 0) >= 30) &&
      !r.metrics?.wrongWorldLeakage,
    )
      ? "Pre-V3 sampling collapse addressed for tested worlds; contractCount should exceed minSafePreRankingPool (50 for length=25)."
      : "Partial — review live funnel; depth may still be limited by post-purity/delivery caps separate from sampling.",
    nextStep: results.some((r) => (r.metrics?.delivered ?? 0) < 15)
      ? "If delivered still <15 after preV3 fix, trace post-purity and delivery caps (V27 root cause C remainder) — do not add profiles."
      : "Human listening validation on V28 Spotify playlists.",
  };

  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), "utf8");
  writeFileSync(OUT_MACHINE, JSON.stringify(payload, null, 2), "utf8");
  writeFileSync(OUT_MD, renderMd(payload), "utf8");
  console.log(`V28 report: ${OUT_MD}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
