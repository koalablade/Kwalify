/**
 * Scene World proof via audit API (requires server with sceneWorldProof support).
 *
 * Usage:
 *   node scripts/scene-world-proof-remote.mjs
 *   node scripts/scene-world-proof-remote.mjs --base-url http://127.0.0.1:3000
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PROMPTS = [
  "feel-good summer morning",
  "rainy city walk",
  "cozy Sunday morning",
  "late night thinking",
  "optimistic commute",
  "driving at sunset",
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
    baseUrl: process.env.SMOKE_BASE_URL || env.SMOKE_BASE_URL || "http://127.0.0.1:3000",
    token: process.env.PLAYLIST_EVAL_TOKEN || env.PLAYLIST_EVAL_TOKEN || "",
    spotifyUserId: process.env.SMOKE_SPOTIFY_USER_ID || env.SMOKE_SPOTIFY_USER_ID || "koalablade",
  };
}

function formatRemoval(row) {
  return [
    `${row.title} — ${row.artist}`,
    `Rank before: ${row.previousRank}`,
    `World score: ${row.worldMembershipScore.toFixed(2)}`,
    `Removed: ${row.removalReason}`,
  ].join("\n");
}

const baseUrlArg = process.argv.find((arg, i) => process.argv[i - 1] === "--base-url");
const cfg = await loadEnv();
const baseUrl = baseUrlArg || cfg.baseUrl;
const results = [];

for (const prompt of PROMPTS) {
  const res = await fetch(`${baseUrl}/api/generate?audit=1&sceneWorldProof=1`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-kwalify-evaluation-token": cfg.token,
    },
    body: JSON.stringify({
      vibe: prompt,
      mode: "balanced",
      length: 25,
      auditMode: true,
      sceneWorldProof: true,
      spotifyUserId: cfg.spotifyUserId,
    }),
  });
  const data = await res.json();
  const proof = data.sceneWorldProof ?? data.v3Diagnostics?.sceneWorldProof ?? null;
  if (!proof) {
    console.error(`FAIL ${prompt}: no sceneWorldProof in response (status ${res.status})`);
    results.push({ prompt, pass: false, error: "missing sceneWorldProof payload" });
    continue;
  }
  const pass = proof.sceneWorldActive && res.status === 200;
  results.push({ prompt, pass, proof, status: res.status });
  console.log(`\n=== ${prompt} ===`);
  console.log(`Archetype: ${proof.archetype?.label}`);
  console.log(`Replacement: ${proof.candidateReplacementPct}% | first10 cohesion: ${proof.firstTenCohesion} | cluster: ${proof.firstTenClusterConsistency ?? "n/a"}`);
  console.log(`Top 5 BEFORE: ${proof.top50Before.slice(0, 5).map((t) => `${t.title} | ${t.genreFamily}`).join("; ")}`);
  console.log(`Top 5 AFTER: ${proof.top50After.slice(0, 5).map((t) => `${t.title} | ${t.genreFamily}`).join("; ")}`);
  if (proof.membershipFiltered.slice(0, 3).length) {
    console.log("Sample removals:");
    for (const row of proof.membershipFiltered.slice(0, 3)) console.log(formatRemoval(row));
  }
}

await mkdir(path.join(ROOT, "reports"), { recursive: true });
await writeFile(
  path.join(ROOT, "reports", "scene-world-proof-remote.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl, results }, null, 2),
);

const failed = results.filter((row) => !row.proof?.sceneWorldActive).length;
console.log(`\n${results.length - failed}/${results.length} prompts returned sceneWorldProof`);
process.exit(failed > 0 ? 1 : 0);
