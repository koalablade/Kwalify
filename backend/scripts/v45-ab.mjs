#!/usr/bin/env node
/**
 * V45 validation A/B — V44 baseline vs V45 candidate-quality (V41 flags on).
 *
 * Usage:
 *   node backend/scripts/v45-ab.mjs [--baseline 293bc82] [--candidate HEAD] [--limit N] [--skip-baseline]
 */
import { writeFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawn } from "node:child_process";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const OUT_DIR = resolve(ROOT, "reports/playlist-evaluation");
const OUT_JSON = resolve(OUT_DIR, "v45-ab-validation.json");
const OUT_MD = resolve(OUT_DIR, "V45_AB_VALIDATION.md");
const OUT_LOG = resolve(OUT_DIR, "v45-ab-run.log");

const require = createRequire(join(ROOT, "package.json"));

const USER = "koalablade";
const REQUESTED = 25;
const PROMPT_TIMEOUT_MS = 12 * 60 * 1000;
const DELAY_MS = 3000;
const DEFAULT_PORT = 5000;
const V41_ENV = {
  PLAYLIST_CONTRACT_V40: "1",
  PLAYLIST_CONTRACT_V41: "1",
};

const TIGHT_PROBES = [
  { id: "V45-T01", category: "tension", prompt: "sad party bangers" },
  { id: "V45-T02", category: "tension", prompt: "energetic but not cheesy" },
  { id: "V45-T03", category: "tension", prompt: "chilled but not boring" },
  { id: "V45-T04", category: "tension", prompt: "something nostalgic for driving" },
  { id: "V45-T05", category: "compound", prompt: "party but not cheesy" },
  { id: "V45-T06", category: "compound", prompt: "dark but danceable" },
  { id: "V45-T07", category: "compound", prompt: "upbeat indie melancholic" },
];

const VAGUE_PROBES = [
  { id: "V45-V01", category: "vague", prompt: "late night drive" },
  { id: "V45-V02", category: "vague", prompt: "something nostalgic" },
  { id: "V45-V03", category: "vague", prompt: "rainy Sunday" },
  { id: "V45-V04", category: "vague", prompt: "summer evening" },
  { id: "V45-V05", category: "vague", prompt: "old songs that hit different" },
];

const COMPOUND_PROBES = [
  { id: "V45-CMP01", category: "compound", prompt: "dark and danceable" },
  { id: "V45-CMP02", category: "compound", prompt: "warm and melancholic" },
  { id: "V45-CMP03", category: "compound", prompt: "emotional but upbeat" },
  { id: "V45-CMP04", category: "compound", prompt: "relaxed but interesting" },
];

const CONTROL_PROBES = [
  { id: "V45-CTL01", category: "control", prompt: "dad rock BBQ" },
  { id: "V45-CTL02", category: "control", prompt: "cozy sunday morning coffee" },
  { id: "V45-CTL03", category: "control", prompt: "sunset beach reggae" },
  { id: "V45-CTL04", category: "control", prompt: "2000s pop punk gym workout" },
  { id: "V45-CTL05", category: "control", prompt: "lo-fi study focus" },
];

const ALL_PROMPTS = [...TIGHT_PROBES, ...VAGUE_PROBES, ...COMPOUND_PROBES, ...CONTROL_PROBES];

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  return {
    baseline: get("--baseline", "293bc82"),
    candidate: get("--candidate", "HEAD"),
    skipBaseline: args.includes("--skip-baseline"),
    limit: get("--limit", null) ? Number.parseInt(get("--limit", "999"), 10) : ALL_PROMPTS.length,
  };
}

function log(line) {
  const msg = `[${new Date().toISOString()}] ${line}`;
  console.log(msg);
  mkdirSync(OUT_DIR, { recursive: true });
  appendFileSync(OUT_LOG, msg + "\n", "utf8");
}

async function resolveCreds() {
  const { resolveLiveBenchmarkCredentials } = await import("../dist/lib/benchmark-env.js");
  return resolveLiveBenchmarkCredentials({ strict: true, defaultBaseUrl: "http://127.0.0.1:5000" });
}

async function readFullDotEnv() {
  const { readLocalDotEnv } = await import("../dist/lib/benchmark-env-dotenv.js");
  return readLocalDotEnv();
}

async function killLocalPort(port) {
  if (process.platform !== "win32") return;
  try {
    const out = execSync(`netstat -ano | findstr ":${port}"`, { encoding: "utf8" });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.includes("LISTENING")) continue;
      const parts = trimmed.split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid) && Number(pid) > 0) pids.add(pid);
    }
    for (const pid of pids) {
      try { execSync(`taskkill /F /PID ${pid}`); } catch { /* ignore */ }
    }
  } catch { /* port free */ }
}

async function healthOk(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/api/healthz`, { signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch { return false; }
}

async function evalPingOk(baseUrl, token) {
  try {
    const res = await fetch(`${baseUrl}/api/eval/ping`, {
      method: "POST",
      headers: { "x-kwalify-evaluation-token": token },
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    return data.tokenAccepted === true;
  } catch { return false; }
}

async function spawnApiServer(cwd, envOverrides, tokenOverride) {
  const dotenv = await readFullDotEnv();
  const creds = tokenOverride ? { token: tokenOverride } : await resolveCreds();
  const token = creds.token;
  if (!token) throw new Error("PLAYLIST_EVAL_TOKEN missing");

  const baseUrl = `http://127.0.0.1:${DEFAULT_PORT}`;
  await killLocalPort(DEFAULT_PORT);
  await new Promise((r) => setTimeout(r, 2000));

  const env = {
    ...process.env,
    ...dotenv,
    PORT: String(DEFAULT_PORT),
    PLAYLIST_EVAL_TOKEN: token,
    PLAYLIST_CONTRACT_SHADOW: "",
    PLAYLIST_CONTRACT_RETRIEVAL: "",
    PLAYLIST_CONTRACT_VALIDATION: "",
    PLAYLIST_CONTRACT_WORLD_GATE: "",
    ...V41_ENV,
    ...envOverrides,
  };

  const server = spawn(process.execPath, [join(cwd, "backend", "dist", "server.js")], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let bootLog = "";
  for (const stream of [server.stderr, server.stdout]) {
    stream?.on("data", (chunk) => {
      bootLog += chunk.toString();
      if (bootLog.length > 8000) bootLog = bootLog.slice(-8000);
    });
  }

  for (let i = 0; i < 90; i += 1) {
    await new Promise((r) => setTimeout(r, 2000));
    if ((await healthOk(baseUrl)) && (await evalPingOk(baseUrl, token))) {
      return { server, baseUrl, token };
    }
  }
  server.kill("SIGTERM");
  throw new Error(`API did not become eval-ready${bootLog ? `\n${bootLog.slice(-1200)}` : ""}`);
}

function extractRow(spec, httpStatus, data, arm, sha) {
  const v41 = data.playlistContractV41 ?? null;
  const rebalance = v41?.rebalance ?? null;
  const poolSelection = v41?.poolSelection ?? null;
  const tracks = (data.tracks ?? []).map((t, i) => ({
    position: i + 1,
    trackId: t.trackId ?? t.id ?? null,
    artist: t.artistName ?? t.artist ?? "",
    track: t.trackName ?? t.name ?? "",
    energy: t.energy ?? null,
    valence: t.valence ?? null,
    axisScores: t.contractCompositionMeta?.axisScores ?? null,
    intersectionStrength: t.contractCompositionMeta?.intersectionStrength ?? null,
  }));
  const energies = tracks.map((t) => t.energy).filter((e) => typeof e === "number");
  const highEnergyShare = energies.length ? energies.filter((e) => e > 0.72).length / energies.length : null;
  const spamHits = tracks.filter((t) => /\btechno\b|\bvip\b|stutter/i.test(t.track)).length;
  const partyEnergyHits = tracks.filter((t) => (t.axisScores?.party_energy ?? 0) >= 0.42).length;
  const melancholyHits = tracks.filter((t) => (t.axisScores?.melancholy ?? 0) >= 0.42).length;
  return {
    id: spec.id,
    category: spec.category,
    prompt: spec.prompt,
    arm,
    sha,
    httpStatus,
    success: data.success === true,
    error: data.error ?? null,
    v41,
    axisCoverage: rebalance?.dimensionCoverage ?? poolSelection?.dimensionCoverage ?? null,
    intersectionCoverage: rebalance?.intersectionCoverage ?? null,
    rebalanced: rebalance?.rebalanced ?? false,
    delivered: tracks.length,
    highEnergyShare,
    partyEnergyHits,
    melancholyHits,
    spamHits,
    deliveredTracks: tracks,
  };
}

async function generateOne(baseUrl, token, prompt, arm, id) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROMPT_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/api/generate?audit=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-kwalify-evaluation-token": token },
      body: JSON.stringify({
        vibe: prompt,
        mode: "balanced",
        length: REQUESTED,
        varietyBoost: true,
        auditMode: true,
        spotifyUserId: USER,
        requestId: `v45-ab-${arm}-${id}-${Date.now()}`,
      }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { httpStatus: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function runArm(arm, sha, prompts, baseUrl, token) {
  const rows = [];
  for (const spec of prompts) {
    log(`[${arm}@${sha.slice(0, 7)}] [${spec.id}] ${spec.prompt}`);
    try {
      const { httpStatus, data } = await generateOne(baseUrl, token, spec.prompt, arm, spec.id);
      const row = extractRow(spec, httpStatus, data, arm, sha);
      rows.push(row);
      log(`  → del=${row.delivered} ok=${row.success} rebal=${row.rebalanced} spam=${row.spamHits} party=${row.partyEnergyHits} mel=${row.melancholyHits}`);
    } catch (err) {
      rows.push({ id: spec.id, prompt: spec.prompt, arm, sha, error: String(err.message ?? err) });
      log(`  ERROR: ${err.message ?? err}`);
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }
  return rows;
}

function trackKey(t) {
  return `${(t.artist ?? "").toLowerCase()}|${(t.track ?? "").toLowerCase()}`;
}

function comparePrompt(aRow, bRow) {
  const aTracks = new Set((aRow.deliveredTracks ?? []).map(trackKey));
  const bTracks = new Set((bRow.deliveredTracks ?? []).map(trackKey));
  const overlap = [...aTracks].filter((k) => bTracks.has(k)).length;
  const union = new Set([...aTracks, ...bTracks]).size || 1;
  return {
    id: aRow.id,
    prompt: aRow.prompt,
    category: aRow.category,
    baselineDelivered: aRow.delivered ?? 0,
    candidateDelivered: bRow.delivered ?? 0,
    baselineSuccess: aRow.success ?? false,
    candidateSuccess: bRow.success ?? false,
    deltaDelivered: (bRow.delivered ?? 0) - (aRow.delivered ?? 0),
    baselineSpam: aRow.spamHits ?? 0,
    candidateSpam: bRow.spamHits ?? 0,
    trackOverlapPct: Math.round((overlap / union) * 1000) / 1000,
    baselineSample: (aRow.deliveredTracks ?? []).slice(0, 6).map((t) => `${t.artist} — ${t.track}`),
    candidateSample: (bRow.deliveredTracks ?? []).slice(0, 6).map((t) => `${t.artist} — ${t.track}`),
  };
}

function scoreComparison(c) {
  if (c.category === "control") {
    const overlapOk = c.trackOverlapPct >= 0.75;
    const deliveryOk = Math.abs(c.deltaDelivered) <= 2;
    return overlapOk && deliveryOk ? "equivalent" : deliveryOk && c.trackOverlapPct >= 0.6 ? "modestly_better" : deliveryOk ? "mixed" : "worse";
  }
  let score = 0;
  if (c.candidateSuccess && !c.baselineSuccess) score += 4;
  if (c.deltaDelivered > 0) score += 1;
  if (c.candidateDelivered >= 20) score += 1;
  if (c.deltaDelivered > 5) score += 2;
  if (c.candidateSpam < c.baselineSpam) score += 3;
  if (c.candidateSpam === 0 && c.baselineSpam > 0) score += 2;
  if (score >= 6) return "materially_better";
  if (score >= 3) return "modestly_better";
  if (score >= 1) return "equivalent";
  if (c.candidateDelivered < c.baselineDelivered && c.candidateSpam > c.baselineSpam) return "worse";
  return "mixed";
}

function overallVerdict(comparisons) {
  const nonControl = comparisons.filter((c) => c.category !== "control");
  const controls = comparisons.filter((c) => c.category === "control");
  const verdicts = nonControl.map((c) => scoreComparison(c));
  const controlOk = controls.every((c) => scoreComparison(c) !== "worse");
  const betterCount = verdicts.filter((v) => v === "materially_better" || v === "modestly_better").length;
  const worseCount = verdicts.filter((v) => v === "worse").length;
  let verdict = "INCONCLUSIVE";
  if (controlOk && betterCount >= 8 && worseCount <= 1) verdict = "MATERIALLY_BETTER";
  else if (controlOk && betterCount >= 5 && worseCount <= 2) verdict = "MODESTLY_BETTER";
  else if (controlOk && worseCount <= 1) verdict = "EQUIVALENT";
  else if (worseCount > betterCount) verdict = "WORSE";
  else verdict = "MIXED";
  return { verdict, betterCount, worseCount, controlOk, perPrompt: Object.fromEntries(comparisons.map((c) => [c.prompt, scoreComparison(c)])) };
}

function ensureWorktree(sha, worktreePath) {
  if (existsSync(worktreePath)) {
    const head = execSync("git rev-parse HEAD", { cwd: worktreePath, encoding: "utf8" }).trim();
    if (head.startsWith(sha)) {
      linkNodeModules(worktreePath);
      return;
    }
    execSync(`git worktree remove --force "${worktreePath}"`, { cwd: ROOT, stdio: "inherit" });
  }
  execSync(`git worktree add "${worktreePath}" ${sha} --detach`, { cwd: ROOT, stdio: "inherit" });
  linkNodeModules(worktreePath);
}

function linkNodeModules(worktreePath) {
  const link = join(worktreePath, "node_modules");
  const source = join(ROOT, "node_modules");
  if (existsSync(link)) return;
  if (process.platform === "win32") {
    execSync(`cmd /c mklink /J "${link}" "${source}"`, { stdio: "inherit" });
  } else {
    execSync(`ln -s "${source}" "${link}"`, { stdio: "inherit" });
  }
}

function buildAt(cwd, label) {
  log(`Building ${label} at ${cwd}...`);
  execSync("npm run build", { cwd, stdio: "inherit" });
}

async function main() {
  const { baseline, candidate, skipBaseline, limit } = parseArgs();
  const prompts = ALL_PROMPTS.slice(0, limit);
  mkdirSync(OUT_DIR, { recursive: true });
  appendFileSync(OUT_LOG, `\n=== V45 A/B ${new Date().toISOString()} baseline=${baseline} candidate=${candidate} ===\n`, "utf8");

  const baselineSha = execSync(`git rev-parse ${baseline}`, { cwd: ROOT, encoding: "utf8" }).trim();
  const candidateSha = execSync(`git rev-parse ${candidate}`, { cwd: ROOT, encoding: "utf8" }).trim();
  const baselineWorktree = resolve(ROOT, "..", `Kwalify-v45-baseline-${baselineSha.slice(0, 7)}`);

  buildAt(ROOT, `candidate@${candidateSha.slice(0, 7)}`);

  let baselineRows = [];
  const creds = await resolveCreds();

  if (!skipBaseline) {
    ensureWorktree(baselineSha, baselineWorktree);
    buildAt(baselineWorktree, `baseline@${baselineSha.slice(0, 7)}`);
    log("=== BASELINE (V44) ARM ===");
    const spawnedA = await spawnApiServer(baselineWorktree, {}, creds.token);
    baselineRows = await runArm("baseline", baselineSha, prompts, spawnedA.baseUrl, spawnedA.token);
    if (spawnedA.server) spawnedA.server.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 4000));
  }

  log("=== CANDIDATE (V45) ARM ===");
  const spawnedB = await spawnApiServer(ROOT, {}, creds.token);
  const candidateRows = await runArm("candidate", candidateSha, prompts, spawnedB.baseUrl, spawnedB.token);
  if (spawnedB.server) spawnedB.server.kill("SIGTERM");

  const baseByPrompt = Object.fromEntries(baselineRows.map((r) => [r.prompt, r]));
  const candByPrompt = Object.fromEntries(candidateRows.map((r) => [r.prompt, r]));
  const comparisons = prompts.map((p) =>
    comparePrompt(
      baseByPrompt[p.prompt] ?? { prompt: p.prompt, category: p.category, id: p.id, delivered: 0, deliveredTracks: [] },
      candByPrompt[p.prompt] ?? { prompt: p.prompt, category: p.category, id: p.id, delivered: 0, deliveredTracks: [] },
    ),
  );
  const verdict = overallVerdict(comparisons);

  const payload = {
    generatedAt: new Date().toISOString(),
    baselineSha,
    candidateSha,
    promptCount: prompts.length,
    configuration: { flags: V41_ENV },
    arms: { baseline: baselineRows, candidate: candidateRows },
    comparisons,
    verdict: { overall: verdict.verdict, ...verdict },
  };

  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), "utf8");
  writeFileSync(
    OUT_MD,
    `# V45 A/B Validation\n\n**Baseline (V44):** \`${baselineSha}\`\n**Candidate (V45):** \`${candidateSha}\`\n**Verdict:** ${verdict.verdict}\n\n` +
      comparisons.map((c) => `- ${c.prompt}: ${verdict.perPrompt[c.prompt]} (del ${c.baselineDelivered}→${c.candidateDelivered}, spam ${c.baselineSpam}→${c.candidateSpam})`).join("\n"),
    "utf8",
  );
  log(`Wrote ${OUT_JSON}`);
  log(`Verdict: ${verdict.verdict} (better=${verdict.betterCount} worse=${verdict.worseCount})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
