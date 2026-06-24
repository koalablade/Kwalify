/**
 * Human save regression — live production scene-world quality gates.
 *
 * Usage: node scripts/human-save-regression.mjs
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MIN_CLUSTER_CONSISTENCY = 0.80;

const PROMPTS = [
  { id: "summer_morning", prompt: "Feel-good summer morning music to hype yourself up for the day, getting ready, and commuting to work.", maxOutliers: 4, minFirstTen: 0.52, minClusterConsistency: MIN_CLUSTER_CONSISTENCY },
  { id: "rainy_walk", prompt: "rainy city morning walk with reflective mood", maxOutliers: 5, minFirstTen: 0.48, minClusterConsistency: MIN_CLUSTER_CONSISTENCY },
  { id: "cozy_sunday", prompt: "soft happy Sunday afternoon with light emotional warmth", maxOutliers: 5, minFirstTen: 0.48, minClusterConsistency: MIN_CLUSTER_CONSISTENCY },
  { id: "late_night", prompt: "late night feeling", maxOutliers: 6, minFirstTen: 0.46, minClusterConsistency: 0 },
  { id: "sunset_drive", prompt: "driving at sunset with open windows and golden light", maxOutliers: 5, minFirstTen: 0.48, minClusterConsistency: MIN_CLUSTER_CONSISTENCY },
  { id: "optimistic_commute", prompt: "optimistic commute to work with forward energy", maxOutliers: 4, minFirstTen: 0.50 },
  { id: "study_session", prompt: "music for thinking and study session focus", maxOutliers: 6, minFirstTen: 0.46 },
  { id: "gym_boost", prompt: "gym confidence boost high energy workout", maxOutliers: 6, minFirstTen: 0.46 },
];

async function loadEnv() {
  const env = {};
  try {
    const raw = await readFile(path.join(ROOT, ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch { /* no .env */ }
  return {
    baseUrl: process.env.SMOKE_BASE_URL || env.SMOKE_BASE_URL || "https://kwalify.net",
    token: process.env.PLAYLIST_EVAL_TOKEN || env.PLAYLIST_EVAL_TOKEN || "",
    spotifyUserId: process.env.SMOKE_SPOTIFY_USER_ID || env.SMOKE_SPOTIFY_USER_ID || "koalablade",
  };
}

function obviousOutlier(track, promptId) {
  const g = (track.genreFamily || track.genrePrimary || "unknown").toLowerCase();
  const e = track.energy ?? 0.5;
  const v = track.valence ?? 0.5;
  const name = `${track.trackName} | ${track.artistName}`.toLowerCase();
  if (g === "metal") return true;
  if (name.includes("queens of the stone") || name.includes("ozzy")) return true;
  if (promptId.includes("summer") || promptId.includes("commute")) {
    if (g === "hip_hop" && v < 0.55) return true;
    if (name.includes("folk punk")) return true;
    if (e > 0.62 && v < 0.42) return true;
  }
  if (promptId.includes("rainy") || promptId.includes("cozy") || promptId.includes("late")) {
    if (g === "hip_hop" && e > 0.58) return true;
    if (name.includes("destructo disk")) return true;
  }
  if (promptId.includes("study")) {
    if (g === "hip_hop" || g === "metal") return true;
  }
  return false;
}

const cfg = await loadEnv();
const results = [];
let failed = 0;

for (const item of PROMPTS) {
  const res = await fetch(`${cfg.baseUrl}/api/generate?audit=1`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-kwalify-evaluation-token": cfg.token,
    },
    body: JSON.stringify({
      vibe: item.prompt,
      mode: "balanced",
      length: 25,
      varietyBoost: true,
      auditMode: true,
      spotifyUserId: cfg.spotifyUserId,
    }),
  });
  const data = await res.json();
  const tracks = (data.tracks || []).map((t, i) => ({
    position: i + 1,
    trackName: t.trackName || t.name,
    artistName: t.artistName || t.artist,
    genreFamily: t.genreFamily ?? t.genrePrimary ?? "unknown",
    energy: t.energy ?? null,
    valence: t.valence ?? null,
  }));
  const sceneWorld = data.diagnostics?.v3Pipeline?.sceneWorldLayer ?? data.generationDiagnostics?.sceneWorldLayer ?? null;
  const clusterConsistency =
    sceneWorld?.sceneClusters?.firstTenClusterConsistency ??
    data.diagnostics?.v3Pipeline?.sceneWorldProof?.firstTenClusterConsistency ??
    data.sceneWorldProof?.firstTenClusterConsistency ??
    null;
  const outliers = tracks.filter((track) => obviousOutlier(track, item.id));
  const firstTen = tracks.slice(0, 10);
  const firstTenOutliers = firstTen.filter((track) => obviousOutlier(track, item.id));
  const clusterPass = !item.minClusterConsistency || (clusterConsistency ?? 0) >= item.minClusterConsistency;
  const pass = res.status === 200 &&
    outliers.length <= item.maxOutliers &&
    firstTenOutliers.length <= Math.max(1, Math.floor(item.maxOutliers / 2)) &&
    clusterPass;
  if (!pass) failed++;
  results.push({
    id: item.id,
    pass,
    status: res.status,
    outlierCount: outliers.length,
    firstTenOutliers: firstTenOutliers.length,
    firstTenClusterConsistency: clusterConsistency,
    sceneWorld,
    opening5: tracks.slice(0, 5).map((t) => `${t.trackName} | ${t.artistName} | ${t.genreFamily}`),
    outliers: outliers.slice(0, 8).map((t) => `${t.trackName} | ${t.artistName}`),
  });
  console.log(`${pass ? "PASS" : "FAIL"} ${item.id} outliers=${outliers.length} first10=${firstTenOutliers.length} cluster=${clusterConsistency ?? "n/a"}`);
}

await mkdir(path.join(ROOT, "reports"), { recursive: true });
await writeFile(
  path.join(ROOT, "reports", "human-save-regression.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), failed, results }, null, 2),
);

console.log(`\nRegression: ${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
