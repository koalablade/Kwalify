#!/usr/bin/env node
/**
 * V50 human-quality eval — full playlist output + independent verifier + ROI aggregation.
 *
 * Usage:
 *   node backend/scripts/v50-eval.mjs [--baseline fda40de] [--candidate HEAD] [--skip-baseline] [--candidate-only] [--limit N] [--prompt "text"]
 */
import { writeFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const OUT_DIR = resolve(ROOT, "reports/playlist-evaluation");
const OUT_JSON = resolve(OUT_DIR, "v50-eval-validation.json");
const OUT_MD = resolve(OUT_DIR, "V50_EVAL_VALIDATION.md");
const OUT_LOG = resolve(OUT_DIR, "v50-eval-run.log");

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
  { id: "V50-C01", category: "compound", prompt: "sad party bangers" },
  { id: "V50-C02", category: "compound", prompt: "party but not cheesy" },
  { id: "V50-C03", category: "compound", prompt: "party but restrained" },
  { id: "V50-C04", category: "compound", prompt: "melancholic and danceable" },
  { id: "V50-C05", category: "compound", prompt: "energetic but not cheesy" },
  { id: "V50-C06", category: "compound", prompt: "chilled but not boring" },
  { id: "V50-C07", category: "compound", prompt: "dark and danceable" },
  { id: "V50-C08", category: "compound", prompt: "warm and melancholic" },
  { id: "V50-C09", category: "compound", prompt: "emotional but upbeat" },
  { id: "V50-C10", category: "compound", prompt: "aggressive but controlled" },
  { id: "V50-C11", category: "compound", prompt: "relaxed but interesting" },
  { id: "V50-C12", category: "compound", prompt: "nostalgic driving" },
];

const VAGUE_PROBES = [
  { id: "V50-V01", category: "vague", prompt: "late night drive" },
  { id: "V50-V02", category: "vague", prompt: "long drive" },
  { id: "V50-V03", category: "vague", prompt: "rainy Sunday" },
  { id: "V50-V04", category: "vague", prompt: "feeling weird" },
  { id: "V50-V05", category: "vague", prompt: "something for driving" },
  { id: "V50-V06", category: "vague", prompt: "something nostalgic" },
  { id: "V50-V07", category: "vague", prompt: "chill evening" },
  { id: "V50-V08", category: "vague", prompt: "good vibes" },
  { id: "V50-V09", category: "vague", prompt: "background music" },
  { id: "V50-V10", category: "vague", prompt: "road trip" },
  { id: "V50-V11", category: "vague", prompt: "summer evening" },
  { id: "V50-V12", category: "vague", prompt: "quiet night" },
];

const GENRE_PROBES = [
  { id: "V50-G01", category: "genre", prompt: "90s indie road trip" },
  { id: "V50-G09", category: "genre", prompt: "90s indie road trip nostalgia" },
  { id: "V50-G02", category: "genre", prompt: "dad rock BBQ" },
  { id: "V50-G03", category: "genre", prompt: "pop punk gym" },
  { id: "V50-G04", category: "genre", prompt: "sunset reggae" },
  { id: "V50-G05", category: "genre", prompt: "cozy sunday coffee" },
  { id: "V50-G06", category: "genre", prompt: "lo-fi study" },
  { id: "V50-G07", category: "genre", prompt: "2000s pop punk gym workout" },
  { id: "V50-G08", category: "genre", prompt: "sunset beach reggae" },
];

const COMBO_PROBES = [
  { id: "V50-X01", category: "combo", prompt: "melancholic road trip but not sad" },
  { id: "V50-X02", category: "combo", prompt: "party vibes without EDM" },
  { id: "V50-X03", category: "combo", prompt: "cozy rainy day indie" },
  { id: "V50-X04", category: "combo", prompt: "late night study focus" },
  { id: "V50-X05", category: "combo", prompt: "upbeat workout but not cheesy pop" },
  { id: "V50-X06", category: "combo", prompt: "dark chill electronic" },
];

const ADVERSARIAL_PROBES = [
  { id: "V50-A01", category: "adversarial", prompt: "happy but lonely" },
  { id: "V50-A02", category: "adversarial", prompt: "angry but calm" },
  { id: "V50-A03", category: "adversarial", prompt: "nostalgic but modern" },
  { id: "V50-A04", category: "adversarial", prompt: "upbeat but sad" },
  { id: "V50-A05", category: "adversarial", prompt: "romantic but not cheesy" },
  { id: "V50-A06", category: "adversarial", prompt: "energetic but laid back" },
  { id: "V50-A07", category: "adversarial", prompt: "intense but controlled" },
  { id: "V50-A08", category: "adversarial", prompt: "sad but hopeful" },
];

const CONTROL_PROBES = [
  { id: "V50-CTL01", category: "control", prompt: "cozy sunday morning coffee" },
  { id: "V50-CTL02", category: "control", prompt: "lo-fi study focus" },
];

const ALL_PROMPTS = [
  ...COMPOUND_PROBES,
  ...VAGUE_PROBES,
  ...GENRE_PROBES,
  ...COMBO_PROBES,
  ...ADVERSARIAL_PROBES,
  ...CONTROL_PROBES,
];

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  return {
    baseline: get("--baseline", "fda40de"),
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

async function loadEvaluators() {
  const { evaluateHumanCurationScore } = await import("../dist/core/editorial/human-curation-score.js");
  const { verifyIndependentHumanQuality } = await import(
    "../dist/core/editorial/independent-human-quality-verifier.js"
  );
  return { evaluateHumanCurationScore, verifyIndependentHumanQuality };
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

function remixInfo(title) {
  const t = (title ?? "").toLowerCase();
  if (/\bsped up\b|\bspeed up\b/.test(t)) return "sped-up";
  if (/\bslowed\b|\breverb\b/.test(t)) return "slowed/reverb";
  if (/\bvip\b|\bclub mix\b|\bremix\b|\bedit\b|\bmix\b/.test(t)) return "remix/edit";
  return null;
}

function weakTailFlags(verifierTracks, delivered) {
  if (delivered < 8) return { weakTailCount: 0, weakTailShare: 0 };
  const tailStart = Math.max(0, delivered - 5);
  const tail = verifierTracks.slice(tailStart);
  const weak = tail.filter((t) => t.flag === "misfit" || t.flag === "borderline").length;
  return { weakTailCount: weak, weakTailShare: weak / tail.length };
}

function firstFiveQuality(verifierTracks) {
  const head = verifierTracks.slice(0, 5);
  const misfits = head.filter((t) => t.flag === "misfit").length;
  const strong = head.filter((t) => t.flag === "strong").length;
  return { misfits, strong, verdict: misfits >= 2 ? "weak" : strong >= 4 ? "strong" : "mixed" };
}

function extractIntentContract(data) {
  const trust = data.generationTrust ?? data.trust ?? null;
  const contract = data.playlistContract ?? data.playlistContractV41?.contract ?? null;
  const world =
    data.committedWorld ??
    data.generationDiagnostics?.committedWorld ??
    trust?.dominantIntentContract?.musicalWorldId ??
    null;
  return {
    intentSignature: trust?.intentSignature ?? data.intentSignature ?? null,
    intentSurvivalSummary: trust?.intentSurvivalSummary ?? null,
    matchQuality: trust?.matchQuality ?? null,
    playlistWhy: trust?.playlistWhy ?? null,
    contractAxes: contract?.tension?.map((t) => t.axes?.join("+")) ?? null,
    committedWorld: typeof world === "object" ? world?.id ?? world?.musicalWorldId : world,
    sceneContracts: trust?.sceneContracts ?? null,
  };
}

function extractRow(spec, httpStatus, data, arm, sha, evaluateHumanCurationScore, verifyIndependentHumanQuality) {
  const v41 = data.playlistContractV41 ?? null;
  const rebalance = v41?.rebalance ?? null;
  const poolSelection = v41?.poolSelection ?? null;
  const intentContract = extractIntentContract(data);

  const tracks = (data.tracks ?? []).map((t, i) => {
    const meta = t.contractCompositionMeta ?? {};
    return {
      position: i + 1,
      trackId: t.trackId ?? t.id ?? null,
      artist: t.artistName ?? t.artist ?? "",
      track: t.trackName ?? t.name ?? "",
      remixInfo: remixInfo(t.trackName ?? t.name ?? ""),
      energy: t.energy ?? null,
      valence: t.valence ?? null,
      danceability: t.danceability ?? null,
      acousticness: t.acousticness ?? null,
      popularity: t.popularity ?? null,
      genreFamily: t.genreFamily ?? t.genre ?? null,
      releaseYear: t.releaseYear ?? null,
      axisScores: meta.axisScores ?? null,
      intersectionStrength: meta.intersectionStrength ?? null,
      contractScore: meta.contractScore ?? null,
      admissible: meta.admissible ?? null,
      selectionPhase: meta.selectionPhase ?? null,
      rejectionReasons: meta.rejectionReasons ?? meta.violations ?? [],
    };
  });

  const mapped = tracks.map((t) => ({
    trackName: t.track,
    artistName: t.artist,
    energy: t.energy,
    valence: t.valence,
    danceability: t.danceability,
    acousticness: t.acousticness,
    popularity: t.popularity,
    genreFamily: t.genreFamily,
    releaseYear: t.releaseYear,
  }));

  const humanScore = evaluateHumanCurationScore(spec.prompt, mapped);
  const proxy = humanCuratorProxy(humanScore, tracks.length);
  const verifier = verifyIndependentHumanQuality(spec.prompt, mapped);
  const verifierMisfits = verifier.tracks
    .filter((t) => t.flag === "misfit")
    .map((t) => `${t.artistName} — ${t.trackName} (${t.reasons[0] ?? "misfit"})`);
  const weakTail = weakTailFlags(verifier.tracks, tracks.length);
  const firstFive = firstFiveQuality(verifier.tracks);

  const energies = tracks.map((t) => t.energy).filter((e) => typeof e === "number");
  const highEnergyShare = energies.length ? energies.filter((e) => e > 0.72).length / energies.length : null;
  const spamHits = tracks.filter((t) => /\btechno\b|\bvip\b|stutter|sped up|phonk/i.test(t.track)).length;
  const remixHits = tracks.filter((t) => t.remixInfo).length;
  const partyEnergyHits = tracks.filter((t) => (t.axisScores?.party_energy ?? 0) >= 0.42).length;
  const melancholyHits = tracks.filter((t) => (t.axisScores?.melancholy ?? 0) >= 0.42).length;
  const compoundHits = tracks.filter((t) => (t.intersectionStrength ?? 0) >= 0.32).length;
  const inadmissibleDelivered = tracks.filter((t) => t.admissible === false).length;

  return {
    id: spec.id,
    category: spec.category,
    prompt: spec.prompt,
    arm,
    sha,
    httpStatus,
    success: data.success === true,
    error: data.error ?? null,
    intentContract,
    v41,
    axisCoverage: rebalance?.dimensionCoverage ?? poolSelection?.dimensionCoverage ?? null,
    intersectionCoverage: rebalance?.intersectionCoverage ?? null,
    rebalanced: rebalance?.rebalanced ?? false,
    delivered: tracks.length,
    requested: REQUESTED,
    highEnergyShare,
    partyEnergyHits,
    melancholyHits,
    compoundHits,
    spamHits,
    remixHits,
    inadmissibleDelivered,
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
    weakTail,
    firstFive,
    independentVerifier: {
      playlistVerdict: verifier.playlistVerdict,
      failureReasons: verifier.failureReasons,
      roiFailures: verifier.roiFailures.slice(0, 8),
      misfitCount: verifier.tracks.filter((t) => t.flag === "misfit").length,
      borderlineCount: verifier.tracks.filter((t) => t.flag === "borderline").length,
      strongCount: verifier.tracks.filter((t) => t.flag === "strong").length,
      compoundSummary: verifier.compoundSummary,
      clustering: verifier.clustering,
      tracks: verifier.tracks,
      trackFlags: verifier.tracks.map((t) => ({
        position: t.position,
        artist: t.artistName,
        track: t.trackName,
        flag: t.flag,
        signals: t.signals,
        reasons: t.reasons,
      })),
    },
    verifierMisfits,
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
        requestId: `v50-eval-${arm}-${id}-${Date.now()}`,
      }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { httpStatus: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function runArm(arm, sha, prompts, baseUrl, token, evaluators, spawnServer) {
  const { evaluateHumanCurationScore, verifyIndependentHumanQuality } = evaluators;
  const rows = [];
  let activeBaseUrl = baseUrl;
  let activeToken = token;
  for (const spec of prompts) {
    log(`[${arm}@${sha.slice(0, 7)}] [${spec.id}] ${spec.prompt}`);
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const { httpStatus, data } = await generateOne(activeBaseUrl, activeToken, spec.prompt, arm, spec.id);
        const row = extractRow(
          spec,
          httpStatus,
          data,
          arm,
          sha,
          evaluateHumanCurationScore,
          verifyIndependentHumanQuality,
        );
        rows.push(row);
        log(
          `  → del=${row.delivered} proxy=${row.humanCuratorProxy} verifier=${row.independentVerifier.playlistVerdict} score=${row.humanScore.totalScore} spam=${row.spamHits} misfits=${row.independentVerifier.misfitCount} weakTail=${row.weakTail.weakTailCount}`,
        );
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        log(`  ERROR (attempt ${attempt + 1}/3): ${err.message ?? err}`);
        if (attempt < 2 && spawnServer) {
          log("  Restarting API server after fetch failure...");
          const respawned = await spawnServer();
          activeBaseUrl = respawned.baseUrl;
          activeToken = respawned.token;
          await new Promise((r) => setTimeout(r, 4000));
        }
      }
    }
    if (lastErr) {
      rows.push({
        id: spec.id,
        prompt: spec.prompt,
        arm,
        sha,
        error: String(lastErr.message ?? lastErr),
        humanCuratorProxy: "weak",
        independentVerifier: { playlistVerdict: "weak", misfitCount: 0 },
        delivered: 0,
      });
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
    baselineVerifier: aRow.independentVerifier?.playlistVerdict ?? "weak",
    candidateVerifier: bRow.independentVerifier?.playlistVerdict ?? "weak",
    baselineScore: aRow.humanScore?.totalScore ?? 0,
    candidateScore: bRow.humanScore?.totalScore ?? 0,
    deltaScore: (bRow.humanScore?.totalScore ?? 0) - (aRow.humanScore?.totalScore ?? 0),
    deltaDelivered: (bRow.delivered ?? 0) - (aRow.delivered ?? 0),
    baselineSpam: aRow.spamHits ?? 0,
    candidateSpam: bRow.spamHits ?? 0,
    baselineMisfits: aRow.independentVerifier?.misfitCount ?? 0,
    candidateMisfits: bRow.independentVerifier?.misfitCount ?? 0,
    baselineWeakTail: aRow.weakTail?.weakTailCount ?? 0,
    candidateWeakTail: bRow.weakTail?.weakTailCount ?? 0,
    trackOverlapPct: Math.round((overlap / union) * 1000) / 1000,
    candidateRoiFailures: bRow.independentVerifier?.roiFailures ?? [],
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
  if (c.candidateVerifier === "strong" && c.baselineVerifier !== "strong") score += 5;
  if (c.candidateVerifier === "mixed" && c.baselineVerifier === "weak") score += 3;
  if (c.candidateProxy === "strong" && c.baselineProxy !== "strong") score += 3;
  if (c.deltaScore >= 8) score += 3;
  if (c.deltaScore >= 4) score += 2;
  if (c.deltaDelivered > 0) score += 1;
  if (c.candidateDelivered >= 20) score += 1;
  if (c.candidateSpam < c.baselineSpam) score += 3;
  if (c.candidateMisfits < c.baselineMisfits) score += 3;
  if (c.candidateWeakTail < c.baselineWeakTail) score += 2;
  if (c.candidateVerifier === "weak" && c.baselineVerifier !== "weak") score -= 4;
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
  const strongCount = comparisons.filter((c) => c.candidateVerifier === "strong").length;
  const weakCount = comparisons.filter((c) => c.candidateVerifier === "weak").length;
  let verdict = "INCONCLUSIVE";
  if (controlOk && betterCount >= 8 && worseCount <= 1) verdict = "MATERIALLY_BETTER";
  else if (controlOk && betterCount >= 5 && worseCount <= 2) verdict = "MODESTLY_BETTER";
  else if (controlOk && worseCount <= 1) verdict = "EQUIVALENT";
  else if (worseCount > betterCount) verdict = "WORSE";
  else verdict = "MIXED";
  return {
    verdict,
    betterCount,
    worseCount,
    controlOk,
    strongCount,
    weakCount,
    perPrompt: Object.fromEntries(comparisons.map((c) => [c.prompt, scoreComparison(c)])),
  };
}

function aggregateGlobalRoi(rows) {
  const buckets = new Map();
  for (const row of rows) {
    for (const roi of row.independentVerifier?.roiFailures ?? []) {
      const key = roi.code;
      const existing = buckets.get(key);
      if (existing) {
        existing.impact += roi.impact;
        existing.prompts.add(row.prompt);
        existing.affectedTracks += roi.affectedTracks;
      } else {
        buckets.set(key, {
          code: roi.code,
          reason: roi.reason,
          impact: roi.impact,
          prompts: new Set([row.prompt]),
          affectedTracks: roi.affectedTracks,
        });
      }
    }
  }
  return [...buckets.values()]
    .map((b) => ({
      code: b.code,
      reason: b.reason,
      impact: b.impact,
      promptCount: b.prompts.size,
      affectedTracks: b.affectedTracks,
      prompts: [...b.prompts].slice(0, 8),
    }))
    .sort((a, b) => b.impact - a.impact);
}

function summarizeRows(rows) {
  const delivered = rows.map((r) => r.delivered ?? 0);
  const avgDelivered = delivered.length ? delivered.reduce((a, b) => a + b, 0) / delivered.length : 0;
  const strong = rows.filter((r) => r.independentVerifier?.playlistVerdict === "strong").length;
  const mixed = rows.filter((r) => r.independentVerifier?.playlistVerdict === "mixed").length;
  const weak = rows.filter((r) => r.independentVerifier?.playlistVerdict === "weak").length;
  const totalMisfits = rows.reduce((s, r) => s + (r.independentVerifier?.misfitCount ?? 0), 0);
  const totalSpam = rows.reduce((s, r) => s + (r.spamHits ?? 0), 0);
  return { avgDelivered, strong, mixed, weak, totalMisfits, totalSpam, promptCount: rows.length };
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
  lines.push(
    `- **Arm:** ${row.arm} | **Delivered:** ${row.delivered}/${row.requested ?? REQUESTED} | **Human proxy:** ${row.humanCuratorProxy} | **Verifier:** ${row.independentVerifier?.playlistVerdict ?? "?"}`,
  );
  lines.push(
    `- **World:** ${row.intentContract?.committedWorld ?? "?"} | **Score:** ${row.humanScore?.totalScore ?? 0}/100 | Save: ${row.humanScore?.wouldSave ?? "?"} | Misfits: ${row.independentVerifier?.misfitCount ?? 0} | Weak tail: ${row.weakTail?.weakTailCount ?? 0} | First-5: ${row.firstFive?.verdict ?? "?"}`,
  );
  if (row.independentVerifier?.failureReasons?.length) {
    lines.push(`- **Verifier failures:** ${row.independentVerifier.failureReasons.join("; ")}`);
  }
  lines.push("");
  lines.push("**Tracklist:**");
  for (const t of row.deliveredTracks ?? []) {
    const flag = row.independentVerifier?.trackFlags?.find((f) => f.position === t.position)?.flag ?? "?";
    const remix = t.remixInfo ? ` (${t.remixInfo})` : "";
    const adm = t.admissible === false ? " INADMISSIBLE" : "";
    lines.push(
      `${t.position}. ${t.artist} — ${t.track}${remix} [${flag}]${adm} E=${t.energy?.toFixed?.(2) ?? "?"} int=${t.intersectionStrength?.toFixed?.(2) ?? "?"}`,
    );
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
  appendFileSync(
    OUT_LOG,
    `\n=== V50 EVAL ${new Date().toISOString()} baseline=${baseline} candidate=${candidate} prompts=${prompts.length} ===\n`,
    "utf8",
  );

  const evaluators = await loadEvaluators();
  const baselineSha = execSync(`git rev-parse ${baseline}`, { cwd: ROOT, encoding: "utf8" }).trim();
  const candidateSha = execSync(`git rev-parse ${candidate}`, { cwd: ROOT, encoding: "utf8" }).trim();
  const baselineWorktree = resolve(ROOT, "..", `Kwalify-v50-baseline-${baselineSha.slice(0, 7)}`);

  buildAt(ROOT, `candidate@${candidateSha.slice(0, 7)}`);

  let baselineRows = [];
  const creds = await resolveCreds();

  if (!skipBaseline && !candidateOnly) {
    ensureWorktree(baselineSha, baselineWorktree);
    buildAt(baselineWorktree, `baseline@${baselineSha.slice(0, 7)}`);
    log("=== BASELINE ARM ===");
    const spawnedA = await spawnApiServer(baselineWorktree, {}, creds.token);
    const respawnBaseline = async () => {
      if (spawnedA.server) spawnedA.server.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 2000));
      return spawnApiServer(baselineWorktree, {}, creds.token);
    };
    baselineRows = await runArm("baseline", baselineSha, prompts, spawnedA.baseUrl, spawnedA.token, evaluators, respawnBaseline);
    if (spawnedA.server) spawnedA.server.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 4000));
  }

  log("=== CANDIDATE ARM ===");
  const spawnedB = await spawnApiServer(ROOT, {}, creds.token);
  const respawnCandidate = async () => {
    if (spawnedB.server) spawnedB.server.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 2000));
    return spawnApiServer(ROOT, {}, creds.token);
  };
  const candidateRows = await runArm("candidate", candidateSha, prompts, spawnedB.baseUrl, spawnedB.token, evaluators, respawnCandidate);
  if (spawnedB.server) spawnedB.server.kill("SIGTERM");

  const baseByPrompt = Object.fromEntries(baselineRows.map((r) => [r.prompt, r]));
  const candByPrompt = Object.fromEntries(candidateRows.map((r) => [r.prompt, r]));
  const comparisons = prompts.map((p) =>
    comparePrompt(
      baseByPrompt[p.prompt] ?? {
        prompt: p.prompt,
        category: p.category,
        id: p.id,
        delivered: 0,
        deliveredTracks: [],
        humanCuratorProxy: "weak",
        independentVerifier: { playlistVerdict: "weak", misfitCount: 0 },
        humanScore: { totalScore: 0 },
      },
      candByPrompt[p.prompt] ?? {
        prompt: p.prompt,
        category: p.category,
        id: p.id,
        delivered: 0,
        deliveredTracks: [],
        humanCuratorProxy: "weak",
        independentVerifier: { playlistVerdict: "weak", misfitCount: 0 },
        humanScore: { totalScore: 0 },
      },
    ),
  );
  const verdict = overallVerdict(comparisons);
  const globalRoi = aggregateGlobalRoi(candidateRows);
  const baselineSummary = summarizeRows(baselineRows);
  const candidateSummary = summarizeRows(candidateRows);

  const payload = {
    generatedAt: new Date().toISOString(),
    baselineSha,
    candidateSha,
    promptCount: prompts.length,
    configuration: { flags: V41_ENV },
    baselineSummary,
    candidateSummary,
    arms: { baseline: baselineRows, candidate: candidateRows },
    comparisons,
    verdict: { overall: verdict.verdict, ...verdict },
    globalRoiFailures: globalRoi,
  };

  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), "utf8");

  const md = [];
  md.push(`# V50 Human-Quality Eval`);
  md.push("");
  md.push(`**Baseline:** \`${baselineSha}\``);
  md.push(`**Candidate:** \`${candidateSha}\``);
  md.push(`**Verdict:** ${verdict.verdict}`);
  md.push(
    `**Candidate verifier strong/mixed/weak:** ${candidateSummary.strong}/${candidateSummary.mixed}/${candidateSummary.weak} | avg delivered ${candidateSummary.avgDelivered.toFixed(1)} | misfits ${candidateSummary.totalMisfits} | spam ${candidateSummary.totalSpam}`,
  );
  if (baselineRows.length) {
    md.push(
      `**Baseline verifier strong/mixed/weak:** ${baselineSummary.strong}/${baselineSummary.mixed}/${baselineSummary.weak} | avg delivered ${baselineSummary.avgDelivered.toFixed(1)} | misfits ${baselineSummary.totalMisfits} | spam ${baselineSummary.totalSpam}`,
    );
  }
  md.push("");
  md.push("## Global ROI failures (candidate)");
  md.push("");
  for (const roi of globalRoi.slice(0, 10)) {
    md.push(`- **${roi.code}** (impact=${roi.impact}, prompts=${roi.promptCount}): ${roi.reason}`);
  }
  md.push("");
  md.push("## Summary by prompt");
  md.push("");
  for (const c of comparisons) {
    md.push(
      `- **${c.prompt}** [${c.category}]: ${verdict.perPrompt[c.prompt]} | verifier ${c.baselineVerifier}→${c.candidateVerifier} | del ${c.baselineDelivered}→${c.candidateDelivered} | misfits ${c.baselineMisfits}→${c.candidateMisfits} | weakTail ${c.baselineWeakTail}→${c.candidateWeakTail}`,
    );
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
  log(
    `Verdict: ${verdict.verdict} (better=${verdict.betterCount} worse=${verdict.worseCount} strong=${verdict.strongCount} weak=${verdict.weakCount})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
