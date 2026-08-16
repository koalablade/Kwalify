#!/usr/bin/env node
/**
 * V48 human-quality A/B — baseline vs candidate with full tracklists + curator proxy.
 *
 * Usage:
 *   node backend/scripts/v48-ab.mjs [--baseline a151cd8] [--candidate HEAD] [--limit N] [--skip-baseline] [--candidate-only]
 */
import { writeFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const OUT_DIR = resolve(ROOT, "reports/playlist-evaluation");
const OUT_JSON = resolve(OUT_DIR, "v48-ab-validation.json");
const OUT_MD = resolve(OUT_DIR, "V48_AB_VALIDATION.md");
const OUT_LOG = resolve(OUT_DIR, "v48-ab-run.log");

const USER = "koalablade";
const REQUESTED = 25;
const PROMPT_TIMEOUT_MS = 12 * 60 * 1000;
const DELAY_MS = 3000;
const DEFAULT_PORT = 5000;
const V41_ENV = {
  PLAYLIST_CONTRACT_V40: "1",
  PLAYLIST_CONTRACT_V41: "1",
};

const COMPOUND_PROBES = [
  { id: "V48-C01", category: "compound", prompt: "sad party bangers" },
  { id: "V48-C02", category: "compound", prompt: "party but not cheesy" },
  { id: "V48-C03", category: "compound", prompt: "party but restrained" },
  { id: "V48-C04", category: "compound", prompt: "melancholic and danceable" },
  { id: "V48-C05", category: "compound", prompt: "energetic but not cheesy" },
  { id: "V48-C06", category: "compound", prompt: "chilled but not boring" },
  { id: "V48-C07", category: "compound", prompt: "dark and danceable" },
  { id: "V48-C08", category: "compound", prompt: "warm and melancholic" },
  { id: "V48-C09", category: "compound", prompt: "emotional but upbeat" },
  { id: "V48-C10", category: "compound", prompt: "aggressive but controlled" },
  { id: "V48-C11", category: "compound", prompt: "something nostalgic for driving" },
  { id: "V48-C12", category: "compound", prompt: "90s indie road trip nostalgia" },
];

const VAGUE_PROBES = [
  { id: "V48-V01", category: "vague", prompt: "late night drive" },
  { id: "V48-V02", category: "vague", prompt: "something nostalgic" },
  { id: "V48-V03", category: "vague", prompt: "rainy Sunday" },
  { id: "V48-V04", category: "vague", prompt: "summer evening" },
  { id: "V48-V05", category: "vague", prompt: "long drive" },
  { id: "V48-V06", category: "vague", prompt: "old songs that hit different" },
  { id: "V48-V07", category: "vague", prompt: "feeling weird" },
  { id: "V48-V08", category: "vague", prompt: "quiet night" },
  { id: "V48-V09", category: "vague", prompt: "cozy Sunday morning" },
  { id: "V48-V10", category: "vague", prompt: "lo-fi study" },
];

const CONTROL_PROBES = [
  { id: "V48-CTL01", category: "control", prompt: "dad rock BBQ" },
  { id: "V48-CTL02", category: "control", prompt: "sunset beach reggae" },
  { id: "V48-CTL03", category: "control", prompt: "2000s pop punk gym workout" },
  { id: "V48-CTL04", category: "control", prompt: "cozy sunday morning coffee" },
  { id: "V48-CTL05", category: "control", prompt: "lo-fi study focus" },
];

const ALL_PROMPTS = [...COMPOUND_PROBES, ...VAGUE_PROBES, ...CONTROL_PROBES];

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  return {
    baseline: get("--baseline", "a151cd8"),
    candidate: get("--candidate", "HEAD"),
    skipBaseline: args.includes("--skip-baseline"),
    candidateOnly: args.includes("--candidate-only"),
    limit: get("--limit", null) ? Number.parseInt(get("--limit", "999"), 10) : ALL_PROMPTS.length,
    promptFilter: get("--prompt", null),
  };
}

function log(line) {
  const msg = `[${new Date().toISOString()}] ${line}`;
  console.log(msg);
  mkdirSync(OUT_DIR, { recursive: true });
  appendFileSync(OUT_LOG, msg + "\n", "utf8");
}

async function loadHumanScore() {
  const { evaluateHumanCurationScore } = await import("../dist/core/editorial/human-curation-score.js");
  return { evaluateHumanCurationScore };
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

function humanCuratorProxy(score, delivered) {
  if (delivered === 0 || !score) return "weak";
  if (score.totalScore >= 72 && score.wouldSave === "YES") return "strong";
  if (score.totalScore >= 58 && (score.wouldSave === "YES" || score.wouldSave === "MAYBE")) return "strong";
  if (score.totalScore >= 45 || score.wouldSave === "MAYBE" || score.wouldPressPlay === "YES") return "mixed";
  return "weak";
}

function obviousMisfits(score, tracks) {
  const misfits = [];
  if (!score?.trackDiagnostics?.length) return misfits;
  for (const d of score.trackDiagnostics) {
    if (d.contribution <= 3 || d.promptFit <= 2) {
      misfits.push(`${d.artistName} — ${d.trackName} (${d.notes[0] ?? "low fit"})`);
    }
  }
  // Spam / techno heuristic
  for (const t of tracks) {
    const txt = `${t.track} ${t.artist}`.toLowerCase();
    if (/\btechno\b|\bvip\b|stutter/i.test(txt)) {
      misfits.push(`${t.artist} — ${t.track} (techno/spam smell)`);
    }
  }
  return [...new Set(misfits)].slice(0, 8);
}

function extractRow(spec, httpStatus, data, arm, sha, evaluateHumanCurationScore) {
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
    danceability: t.danceability ?? null,
    axisScores: t.contractCompositionMeta?.axisScores ?? null,
    intersectionStrength: t.contractCompositionMeta?.intersectionStrength ?? null,
  }));
  const mapped = tracks.map((t) => ({
    trackName: t.track,
    artistName: t.artist,
    energy: t.energy,
    valence: t.valence,
    danceability: t.danceability,
  }));
  const humanScore = evaluateHumanCurationScore(spec.prompt, mapped);
  const proxy = humanCuratorProxy(humanScore, tracks.length);
  const misfits = obviousMisfits(humanScore, tracks);
  const energies = tracks.map((t) => t.energy).filter((e) => typeof e === "number");
  const highEnergyShare = energies.length ? energies.filter((e) => e > 0.72).length / energies.length : null;
  const spamHits = tracks.filter((t) => /\btechno\b|\bvip\b|stutter/i.test(t.track)).length;
  const partyEnergyHits = tracks.filter((t) => (t.axisScores?.party_energy ?? 0) >= 0.42).length;
  const melancholyHits = tracks.filter((t) => (t.axisScores?.melancholy ?? 0) >= 0.42).length;
  const compoundHits = tracks.filter((t) => (t.intersectionStrength ?? 0) >= 0.32).length;
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
    compoundHits,
    spamHits,
    deliveredTracks: tracks,
    humanScore: {
      totalScore: humanScore.totalScore,
      wouldPressPlay: humanScore.wouldPressPlay,
      wouldSave: humanScore.wouldSave,
      wouldShare: humanScore.wouldShare,
      aiObviousness: humanScore.aiObviousness,
      saveabilityDeliveryTier: humanScore.saveabilityDeliveryTier,
      momentEvidence: humanScore.dimensions.momentUnderstanding.evidence.slice(0, 3),
    },
    humanCuratorProxy: proxy,
    obviousMisfits: misfits,
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
        requestId: `v48-ab-${arm}-${id}-${Date.now()}`,
      }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { httpStatus: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function runArm(arm, sha, prompts, baseUrl, token, evaluateHumanCurationScore) {
  const rows = [];
  for (const spec of prompts) {
    log(`[${arm}@${sha.slice(0, 7)}] [${spec.id}] ${spec.prompt}`);
    try {
      const { httpStatus, data } = await generateOne(baseUrl, token, spec.prompt, arm, spec.id);
      const row = extractRow(spec, httpStatus, data, arm, sha, evaluateHumanCurationScore);
      rows.push(row);
      log(`  → del=${row.delivered} proxy=${row.humanCuratorProxy} score=${row.humanScore.totalScore} spam=${row.spamHits} misfits=${row.obviousMisfits.length}`);
    } catch (err) {
      rows.push({ id: spec.id, prompt: spec.prompt, arm, sha, error: String(err.message ?? err), humanCuratorProxy: "weak", delivered: 0 });
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
    baselineProxy: aRow.humanCuratorProxy ?? "weak",
    candidateProxy: bRow.humanCuratorProxy ?? "weak",
    baselineScore: aRow.humanScore?.totalScore ?? 0,
    candidateScore: bRow.humanScore?.totalScore ?? 0,
    deltaScore: (bRow.humanScore?.totalScore ?? 0) - (aRow.humanScore?.totalScore ?? 0),
    baselineSuccess: aRow.success ?? false,
    candidateSuccess: bRow.success ?? false,
    deltaDelivered: (bRow.delivered ?? 0) - (aRow.delivered ?? 0),
    baselineSpam: aRow.spamHits ?? 0,
    candidateSpam: bRow.spamHits ?? 0,
    baselineCompound: aRow.compoundHits ?? 0,
    candidateCompound: bRow.compoundHits ?? 0,
    trackOverlapPct: Math.round((overlap / union) * 1000) / 1000,
    baselineMisfits: aRow.obviousMisfits ?? [],
    candidateMisfits: bRow.obviousMisfits ?? [],
  };
}

function scoreComparison(c) {
  if (c.category === "control") {
    const overlapOk = c.trackOverlapPct >= 0.75;
    const deliveryOk = Math.abs(c.deltaDelivered) <= 2;
    const proxyOk = c.candidateProxy !== "weak" || c.baselineProxy === "weak";
    if (overlapOk && deliveryOk && proxyOk) return "equivalent";
    if (c.deltaScore > 5 && c.candidateProxy !== "weak") return "modestly_better";
    if (c.deltaScore < -5 || (c.candidateProxy === "weak" && c.baselineProxy !== "weak")) return "worse";
    return deliveryOk ? "mixed" : "worse";
  }
  let score = 0;
  if (c.candidateProxy === "strong" && c.baselineProxy !== "strong") score += 5;
  if (c.candidateProxy === "mixed" && c.baselineProxy === "weak") score += 3;
  if (c.deltaScore >= 8) score += 3;
  if (c.deltaScore >= 4) score += 2;
  if (c.candidateSuccess && !c.baselineSuccess) score += 4;
  if (c.deltaDelivered > 0) score += 1;
  if (c.candidateDelivered >= 20) score += 1;
  if (c.deltaDelivered > 5) score += 2;
  if (c.candidateSpam < c.baselineSpam) score += 3;
  if (c.candidateSpam === 0 && c.baselineSpam > 0) score += 2;
  if (c.candidateCompound > c.baselineCompound) score += 2;
  if (c.candidateMisfits.length < c.baselineMisfits.length) score += 2;
  if (c.candidateProxy === "weak" && c.baselineProxy !== "weak") score -= 4;
  if (score >= 6) return "materially_better";
  if (score >= 3) return "modestly_better";
  if (score >= 1) return "equivalent";
  if (c.candidateDelivered < c.baselineDelivered && c.candidateSpam > c.baselineSpam) return "worse";
  if (score < 0) return "worse";
  return "mixed";
}

function overallVerdict(comparisons) {
  const nonControl = comparisons.filter((c) => c.category !== "control");
  const controls = comparisons.filter((c) => c.category === "control");
  const verdicts = nonControl.map((c) => scoreComparison(c));
  const controlOk = controls.every((c) => scoreComparison(c) !== "worse");
  const betterCount = verdicts.filter((v) => v === "materially_better" || v === "modestly_better").length;
  const worseCount = verdicts.filter((v) => v === "worse").length;
  const strongCount = comparisons.filter((c) => c.candidateProxy === "strong").length;
  const weakCount = comparisons.filter((c) => c.candidateProxy === "weak").length;
  let verdict = "INCONCLUSIVE";
  if (controlOk && betterCount >= 8 && worseCount <= 1) verdict = "MATERIALLY_BETTER";
  else if (controlOk && betterCount >= 5 && worseCount <= 2) verdict = "MODESTLY_BETTER";
  else if (controlOk && worseCount <= 1) verdict = "EQUIVALENT";
  else if (worseCount > betterCount) verdict = "WORSE";
  else verdict = "MIXED";
  return { verdict, betterCount, worseCount, controlOk, strongCount, weakCount, perPrompt: Object.fromEntries(comparisons.map((c) => [c.prompt, scoreComparison(c)])) };
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

function formatPlaylistSection(row) {
  const lines = [];
  lines.push(`### ORIGINAL PROMPT: "${row.prompt}"`);
  lines.push(`- **Arm:** ${row.arm} | **Delivered:** ${row.delivered} | **Human-curator proxy:** ${row.humanCuratorProxy}`);
  lines.push(`- **Score:** ${row.humanScore?.totalScore ?? 0}/100 | Save: ${row.humanScore?.wouldSave ?? "?"} | Press Play: ${row.humanScore?.wouldPressPlay ?? "?"}`);
  if (row.obviousMisfits?.length) {
    lines.push(`- **Obvious misfits:** ${row.obviousMisfits.join("; ")}`);
  } else {
    lines.push(`- **Obvious misfits:** none flagged`);
  }
  lines.push("");
  lines.push("**Tracklist:**");
  for (const t of row.deliveredTracks ?? []) {
    lines.push(`${t.position}. ${t.artist} — ${t.track}`);
  }
  if (!(row.deliveredTracks?.length)) lines.push("(empty)");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const { baseline, candidate, skipBaseline, candidateOnly, limit, promptFilter } = parseArgs();
  let prompts = ALL_PROMPTS.slice(0, limit);
  if (promptFilter) {
    prompts = prompts.filter((p) => p.prompt === promptFilter || p.id === promptFilter);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  appendFileSync(OUT_LOG, `\n=== V48 A/B ${new Date().toISOString()} baseline=${baseline} candidate=${candidate} ===\n`, "utf8");

  const { evaluateHumanCurationScore } = await loadHumanScore();
  const baselineSha = execSync(`git rev-parse ${baseline}`, { cwd: ROOT, encoding: "utf8" }).trim();
  const candidateSha = execSync(`git rev-parse ${candidate}`, { cwd: ROOT, encoding: "utf8" }).trim();
  const baselineWorktree = resolve(ROOT, "..", `Kwalify-v48-baseline-${baselineSha.slice(0, 7)}`);

  buildAt(ROOT, `candidate@${candidateSha.slice(0, 7)}`);

  let baselineRows = [];
  const creds = await resolveCreds();

  if (!skipBaseline && !candidateOnly) {
    ensureWorktree(baselineSha, baselineWorktree);
    buildAt(baselineWorktree, `baseline@${baselineSha.slice(0, 7)}`);
    log("=== BASELINE ARM ===");
    const spawnedA = await spawnApiServer(baselineWorktree, {}, creds.token);
    baselineRows = await runArm("baseline", baselineSha, prompts, spawnedA.baseUrl, spawnedA.token, evaluateHumanCurationScore);
    if (spawnedA.server) spawnedA.server.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 4000));
  }

  log("=== CANDIDATE ARM ===");
  const spawnedB = await spawnApiServer(ROOT, {}, creds.token);
  const candidateRows = await runArm("candidate", candidateSha, prompts, spawnedB.baseUrl, spawnedB.token, evaluateHumanCurationScore);
  if (spawnedB.server) spawnedB.server.kill("SIGTERM");

  const baseByPrompt = Object.fromEntries(baselineRows.map((r) => [r.prompt, r]));
  const candByPrompt = Object.fromEntries(candidateRows.map((r) => [r.prompt, r]));
  const comparisons = prompts.map((p) =>
    comparePrompt(
      baseByPrompt[p.prompt] ?? { prompt: p.prompt, category: p.category, id: p.id, delivered: 0, deliveredTracks: [], humanCuratorProxy: "weak", humanScore: { totalScore: 0 } },
      candByPrompt[p.prompt] ?? { prompt: p.prompt, category: p.category, id: p.id, delivered: 0, deliveredTracks: [], humanCuratorProxy: "weak", humanScore: { totalScore: 0 } },
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

  const md = [];
  md.push(`# V48 Human-Quality A/B Validation`);
  md.push("");
  md.push(`**Baseline:** \`${baselineSha}\``);
  md.push(`**Candidate:** \`${candidateSha}\``);
  md.push(`**Verdict:** ${verdict.verdict}`);
  md.push(`**Strong/Mixed/Weak (candidate):** ${verdict.strongCount}/${comparisons.filter((c) => c.candidateProxy === "mixed").length}/${verdict.weakCount}`);
  md.push("");
  md.push("## Summary by prompt");
  md.push("");
  for (const c of comparisons) {
    md.push(`- **${c.prompt}** [${c.category}]: ${verdict.perPrompt[c.prompt]} | proxy ${c.baselineProxy}→${c.candidateProxy} | del ${c.baselineDelivered}→${c.candidateDelivered} | score ${c.baselineScore}→${c.candidateScore}`);
  }
  md.push("");
  md.push("## Candidate playlists (full tracklists)");
  md.push("");
  for (const row of candidateRows) {
    md.push(formatPlaylistSection(row));
  }
  if (baselineRows.length) {
    md.push("## Baseline playlists (full tracklists)");
    md.push("");
    for (const row of baselineRows) {
      md.push(formatPlaylistSection(row));
    }
  }
  writeFileSync(OUT_MD, md.join("\n"), "utf8");

  log(`Wrote ${OUT_JSON}`);
  log(`Wrote ${OUT_MD}`);
  log(`Verdict: ${verdict.verdict} (better=${verdict.betterCount} worse=${verdict.worseCount} strong=${verdict.strongCount} weak=${verdict.weakCount})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
