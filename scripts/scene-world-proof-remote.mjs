/**
 * Scene World proof via audit API (requires server with sceneWorldProof support).
 *
 * Usage:
 *   node scripts/scene-world-proof-remote.mjs
 *   node scripts/scene-world-proof-remote.mjs --base-url http://127.0.0.1:3000
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { assertAuditResponse, loadBenchmarkEnv, requireProductionAuth } from "./load-benchmark-env.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PROMPTS = [
  "feel-good summer morning",
  "rainy city walk",
  "cozy Sunday morning",
  "late night thinking",
  "optimistic commute",
  "driving at sunset",
];

function formatRemoval(row) {
  return [
    `${row.title} — ${row.artist}`,
    `Rank before: ${row.previousRank}`,
    `World score: ${row.worldMembershipScore?.toFixed?.(2) ?? row.worldMembershipScore}`,
    `Removed: ${row.removalReason}`,
  ].join("\n");
}

const baseUrlArg = process.argv.find((arg, i) => process.argv[i - 1] === "--base-url");
const cfg = await requireProductionAuth(await loadBenchmarkEnv({ defaultBaseUrl: baseUrlArg || "https://kwalify.net" }));
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
  assertAuditResponse(res, data, { prompt, script: "scene-world-proof-remote" });

  if (res.status !== 200 || !Array.isArray(data.tracks) || data.tracks.length === 0) {
    console.error(JSON.stringify({
      error: "PRODUCTION_PLAYLIST_EMPTY",
      prompt,
      status: res.status,
      message: data.message ?? data.error ?? null,
    }, null, 2));
    process.exit(1);
  }

  const proof = data.sceneWorldProof ?? data.v3Diagnostics?.sceneWorldProof ?? null;
  if (!proof) {
    console.error(`FAIL ${prompt}: no sceneWorldProof in response (status ${res.status})`);
    process.exit(1);
  }

  const firstTenTracks = (proof.finalPlaylist ?? data.tracks ?? []).slice(0, 10).map((t, i) => ({
    rank: t.rank ?? i + 1,
    title: t.title ?? t.trackName ?? t.name,
    artist: t.artist ?? t.artistName,
    genreFamily: t.genreFamily ?? t.genrePrimary ?? "unknown",
    worldMembership: t.worldMembership ?? t.worldMembershipScore ?? null,
    sceneClusterMembership: t.sceneClusterMembership ?? null,
  }));

  const pass = proof.sceneWorldActive && res.status === 200 && firstTenTracks.length >= 10;
  results.push({
    prompt,
    pass,
    status: res.status,
    trackCount: data.tracks.length,
    firstTenTracks,
    proof,
    rejected: [
      ...(proof.membershipFiltered ?? []),
      ...(proof.editorialRemoved ?? []),
    ],
  });

  console.log(`\n=== ${prompt} ===`);
  console.log(`Archetype: ${proof.archetype?.label}`);
  console.log(`Replacement: ${proof.candidateReplacementPct}% | first10 cohesion: ${proof.firstTenCohesion} | cluster: ${proof.firstTenClusterConsistency ?? "n/a"}`);
  console.log(`First 10: ${firstTenTracks.map((t) => `${t.title} — ${t.artist}`).join("; ")}`);
  if (proof.membershipFiltered?.slice(0, 3).length) {
    console.log("Sample removals:");
    for (const row of proof.membershipFiltered.slice(0, 3)) console.log(formatRemoval(row));
  }
}

await mkdir(path.join(ROOT, "reports"), { recursive: true });
await writeFile(
  path.join(ROOT, "reports", "scene-world-proof-remote.json"),
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    baseUrl,
    tokenSource: cfg.tokenSource,
    deploymentCommit: results[0]?.proof?.commit ?? null,
    results,
  }, null, 2),
);

const failed = results.filter((row) => !row.pass).length;
console.log(`\n${results.length - failed}/${results.length} prompts returned valid sceneWorldProof with first-10 tracks`);
process.exit(failed > 0 ? 1 : 0);
