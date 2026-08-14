#!/usr/bin/env node
/**
 * V30 V3 input pool routing fix — live audit verification.
 * Usage: node backend/scripts/v30-v3-input-routing-fix-run.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const OUT_DIR = resolve(ROOT, "reports/playlist-evaluation");
const OUT_JSON = resolve(OUT_DIR, "v30-v3-input-routing-fix.json");
const OUT_MD = resolve(OUT_DIR, "V30_V3_INPUT_ROUTING_FIX.md");
const OUT_LOG = resolve(OUT_DIR, "v30-routing-fix-run.log");

const PROMPT_TIMEOUT_MS = 12 * 60 * 1000;
const DELAY_MS = 5000;

const PROMPTS = [
  { id: "V30-01", prompt: "sunset beach reggae" },
  { id: "V30-02", prompt: "hard techno gym" },
  { id: "V30-03", prompt: "late night UK garage drive" },
  { id: "V30-04", prompt: "2000s pop punk gym workout" },
];

const V29_BEFORE = {
  "sunset beach reggae": { afterIntent: 200, v3Input: 17, v3PreFilter: 17, postPurity: 6, delivered: 6 },
  "hard techno gym": { afterIntent: 8703, v3Input: 8703, v3PreFilter: 91, postPurity: 4, delivered: 4 },
  "late night UK garage drive": { afterIntent: 8651, v3Input: 8651, v3PreFilter: 85, postPurity: 8, delivered: 8 },
  "2000s pop punk gym workout": { afterIntent: 2204, v3Input: 2204, v3PreFilter: 53, postPurity: 6, delivered: 6 },
};

function log(line) {
  const msg = `[${new Date().toISOString()}] ${line}`;
  console.log(msg);
  mkdirSync(OUT_DIR, { recursive: true });
  appendFileSync(OUT_LOG, msg + "\n", "utf8");
}

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function getHeadCommit() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8", cwd: ROOT }).trim();
  } catch {
    return "unknown";
  }
}

async function resolveCreds() {
  const { resolveLiveBenchmarkCredentials } = await import("../dist/lib/benchmark-env.js");
  return resolveLiveBenchmarkCredentials({ strict: true, defaultBaseUrl: "http://127.0.0.1:5000" });
}

async function generate(creds, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROMPT_TIMEOUT_MS);
  try {
    const res = await fetch(`${creds.baseUrl}/api/generate?audit=1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-kwalify-evaluation-token": creds.token,
      },
      body: JSON.stringify({
        vibe: prompt,
        mode: "balanced",
        length: 25,
        varietyBoost: true,
        auditMode: true,
        spotifyUserId: creds.spotifyUserId ?? "koalablade",
        requestId: `v30-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
  const v3 = data.v3Diagnostics ?? {};
  const controlled = v3.controlledGeneration ?? {};
  const latencyGuard = controlled.retrievalLatencyGuard ?? {};
  const v3InputRouting = latencyGuard.v3InputRouting ?? null;
  const deliveryLoss = gd.deliveryLossFunnel ?? {};
  const afterIntent = num(gd.candidatesAfterIntent) ?? num(v3.waterfall?.contractCount);

  return {
    afterIntent,
    v3Input: num(v3InputRouting?.inputPoolSize),
    v3InputRouting,
    v3PreFilter: num(deliveryLoss.v3PreFilterSurvivors) ?? num(latencyGuard.candidatePoolSizeFinal),
    v3Composed: num(deliveryLoss.v3Composed),
    postPurity: num(deliveryLoss.postPurity),
    delivered: (data.tracks ?? []).length,
    preV3Applied: gd.preV3WorldSampling?.applied ?? null,
    retrievalSafetyExpanded: latencyGuard.active ?? null,
    wrongWorldLeakage: (data.tracks ?? []).some((t) =>
      /mgmt|wallows|the 1975/i.test(String(t.artistName ?? t.artist ?? "")),
    ),
    tracks: (data.tracks ?? []).slice(0, 10).map((t, i) => ({
      position: i + 1,
      artist: t.artistName ?? t.artist,
      track: t.trackName ?? t.name,
    })),
  };
}

function renderMd(payload) {
  const lines = [];
  lines.push("# V30 V3 Input Pool Routing Fix");
  lines.push("");
  lines.push(`**Generated:** ${payload.generatedAt}`);
  lines.push(`**Commit:** ${payload.commit}`);
  lines.push("");
  lines.push("## 1. Root cause");
  lines.push("");
  lines.push(payload.rootCause);
  lines.push("");
  lines.push("## 2. Code path changed");
  lines.push("");
  lines.push(payload.codePath);
  lines.push("");
  lines.push("## 3. Before / after funnel");
  lines.push("");
  lines.push("| Prompt | afterIntent (V29→V30) | V3 input (V29→V30) | v3PreFilter (V29→V30) | postPurity (V29→V30) | delivered (V29→V30) |");
  lines.push("|---|---|---|---|---|---|");
  for (const row of payload.liveResults) {
    const before = V29_BEFORE[row.prompt] ?? {};
    const m = row.metrics;
    lines.push(
      `| ${row.prompt} | ${before.afterIntent ?? "—"}→${m.afterIntent ?? "—"} | ${before.v3Input ?? "—"}→${m.v3Input ?? "—"} | ${before.v3PreFilter ?? "—"}→${m.v3PreFilter ?? "—"} | ${before.postPurity ?? "—"}→${m.postPurity ?? "—"} | ${before.delivered ?? "—"}→${m.delivered ?? "—"} |`,
    );
  }
  lines.push("");
  lines.push("## 4. Regression tests");
  lines.push("");
  lines.push(payload.testResults.summary);
  lines.push("");
  lines.push("## 5. Live audit results");
  lines.push("");
  for (const row of payload.liveResults) {
    lines.push(`### ${row.prompt}`);
    lines.push("");
    lines.push(`- routing: ${row.metrics.v3InputRouting?.routingReason ?? "n/a"}`);
    lines.push(`- wrong-world leakage: ${row.metrics.wrongWorldLeakage ? "YES" : "no"}`);
    lines.push(`- delivered tracks (first 5): ${row.metrics.tracks.slice(0, 5).map((t) => `${t.artist} — ${t.track}`).join("; ") || "none"}`);
    lines.push("");
  }
  lines.push("## 6. Regressions");
  lines.push("");
  lines.push(payload.regressions.length ? payload.regressions.map((r) => `- ${r}`).join("\n") : "None observed in live audit.");
  lines.push("");
  lines.push("## 7. Next bottleneck");
  lines.push("");
  lines.push(payload.nextBottleneck);
  lines.push("");
  lines.push("## 8. Production changes");
  lines.push("");
  lines.push("Only `backend/core/v3-input-pool-routing.ts` and wiring in `playlist-pipeline.ts`. No purity, Share, retrieval, profile, or padding changes.");
  return lines.join("\n");
}

async function main() {
  log("V30 V3 input routing fix verification starting");
  const commit = getHeadCommit();
  let testResults = { summary: "not run", passed: false };
  try {
    execSync("npm run build", { cwd: ROOT, stdio: "pipe" });
    const out = execSync(
      "node --test backend/dist/tests/v29-v3-input-pool-routing.test.js backend/dist/tests/v28-pre-v3-world-sampling.test.js",
      { cwd: ROOT, encoding: "utf8" },
    );
    testResults = { summary: out.trim().split("\n").slice(-3).join(" | "), passed: !/fail/i.test(out) };
    log(`Tests: ${testResults.summary}`);
  } catch (err) {
    testResults = { summary: String(err.stdout ?? err.message), passed: false };
    log(`Tests FAILED: ${testResults.summary}`);
  }

  const creds = await resolveCreds();
  const liveResults = [];
  for (const { id, prompt } of PROMPTS) {
    log(`Generating audit: ${prompt}`);
    const { httpStatus, data } = await generate(creds, prompt);
    liveResults.push({ id, prompt, httpStatus, metrics: extractMetrics(data), success: data.success === true });
    log(`  afterIntent=${liveResults.at(-1).metrics.afterIntent} v3Input=${liveResults.at(-1).metrics.v3Input} v3PreFilter=${liveResults.at(-1).metrics.v3PreFilter} delivered=${liveResults.at(-1).metrics.delivered}`);
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  const reggae = liveResults.find((r) => r.prompt === "sunset beach reggae")?.metrics;
  const regressions = [];
  for (const row of liveResults) {
    if (row.metrics.wrongWorldLeakage) regressions.push(`${row.prompt}: wrong-world leakage in delivered tracks`);
    const before = V29_BEFORE[row.prompt];
    if (before && row.prompt !== "sunset beach reggae" && row.metrics.v3PreFilter != null && before.v3PreFilter != null) {
      if (row.metrics.v3PreFilter < before.v3PreFilter * 0.5) {
        regressions.push(`${row.prompt}: v3PreFilter dropped sharply (${before.v3PreFilter}→${row.metrics.v3PreFilter})`);
      }
    }
  }

  let nextBottleneck = "Undetermined — inspect live funnel.";
  if (reggae) {
    if (reggae.v3Input != null && reggae.v3Input > 17 && reggae.v3PreFilter != null && reggae.v3PreFilter > 17) {
      if (reggae.delivered != null && reggae.delivered <= 8) {
        nextBottleneck = `Routing fix verified (v3Input=${reggae.v3Input}, v3PreFilter=${reggae.v3PreFilter}). Next causal loss is likely post-purity (${reggae.postPurity ?? "n/a"}) or delivery — not the 200→17 pre-filter routing gap.`;
      } else {
        nextBottleneck = `Routing fix verified. Delivery improved to ${reggae.delivered}; inspect post-purity separately before further changes.`;
      }
    } else if (reggae.v3Input != null && reggae.v3Input <= 20) {
      nextBottleneck = "Routing fix did NOT reach live server — verify stale process / rebuild.";
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    commit,
    rootCause: "V29 proved V28 contractGuardedScoredPool (200) sat parallel to safetyRetrievalPool (17). candidate.pool won at buildV3CandidatePool input selection when retrievalSafetyExpanded=true and hardLockVerifiedCandidatePool was null for reggae.",
    codePath: "backend/core/v3-input-pool-routing.ts resolveV3BuildInputPool(); wired in playlist-pipeline.ts before buildV3CandidatePool(). When preV3WorldSampling.applied && retrievalSafetyExpanded, merge contractGuardedScoredPool + safetyRetrievalPool (deduped, capped). hard_lock_verified path unchanged.",
    testResults,
    liveResults,
    v29Before: V29_BEFORE,
    regressions,
    nextBottleneck,
  };

  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), "utf8");
  writeFileSync(OUT_MD, renderMd(payload), "utf8");
  log(`Wrote ${OUT_MD}`);
  log(`Wrote ${OUT_JSON}`);
}

main().catch((err) => {
  log(`FATAL: ${err.stack ?? err.message}`);
  process.exit(1);
});
