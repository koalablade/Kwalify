#!/usr/bin/env node
/**
 * Controlled lineage probe — gold prompts only. Does not change V55.
 * Writes reports/human-quality/lineage-probe/<runId>/
 *
 * Distinct from:
 *   hq100-a671fa94 — INVALID production run
 *   hq100-56fd2c72 — VALID local 100-gen run
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveLiveBenchmarkCredentials } = require("../dist/lib/benchmark-env.js");
const { resolveQaLibrarySnapshot } = require("../dist/lib/human-quality-evaluator/library-snapshot.js");
const { strongRelevantTrackIds } = require("../dist/lib/human-quality-evaluator/library-opportunity.js");
const { intersectCount } = require("../dist/lib/candidate-lineage-trace.js");

const PROMPTS = ["indie rock", "2000s indie", "90s alternative rock", "melancholic"];

function stageReport(stage, A) {
  const status = stage?.status ?? "missing";
  if (status !== "actual") {
    return { count: status, overlap: "unknown", ids: [] };
  }
  const ids = Array.isArray(stage.ids) ? stage.ids : [];
  return { count: ids.length, overlap: intersectCount(A, ids), ids };
}

function artistCounts(library, idList) {
  if (!library || !idList.length) return [];
  const byId = new Map(library.tracks.map((t) => [t.trackId, t.artistName]));
  const counts = new Map();
  for (const id of idList) {
    const artist = byId.get(id) || "unknown";
    counts.set(artist, (counts.get(artist) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([artist, n]) => ({ artist, n }));
}

function sameIds(a, b) {
  if (!a.length || !b.length) return "unknown";
  if (a.length !== b.length) return false;
  return a.every((id, i) => id === b[i]);
}

async function generate(creds, prompt, requestId) {
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
      spotifyUserId: creds.spotifyUserId,
      requestId,
      seed: 1,
    }),
  });
  const data = await res.json();
  return { httpStatus: res.status, data };
}

function rowFromResponse(prompt, httpStatus, data, library) {
  const lineage = data.candidateLineage ?? null;
  const A = library ? strongRelevantTrackIds(library, prompt) : [];
  const B = stageReport(lineage?.stages?.scoringPool, A);
  const C = stageReport(lineage?.stages?.v3Prefilter, A);
  const D = stageReport(lineage?.stages?.composed, A);
  const E = stageReport(lineage?.stages?.postPurity, A);
  const F = stageReport(lineage?.stages?.postTerminal, A);
  const before = stageReport(lineage?.stages?.beforeHygiene, A);
  const hygiene = stageReport(lineage?.stages?.afterOpenerHygiene, A);
  const late = stageReport(lineage?.stages?.afterLateHqg, A);
  const G = stageReport(lineage?.stages?.final, A);
  return {
    prompt,
    httpStatus,
    delivered: Array.isArray(data.tracks) ? data.tracks.length : 0,
    error: data.code ?? data.error ?? data.message ?? null,
    path: data.playlistExecutionTrace?.executionPath ?? lineage?.gate?.executionPath ?? null,
    humanSaveable: data.playlistExecutionTrace?.humanSaveable ?? lineage?.gate?.humanSaveable ?? null,
    A: A.length,
    B: B.count,
    "A∩B": B.overlap,
    C: C.count,
    "A∩C": C.overlap,
    D: D.count,
    "A∩D": D.overlap,
    E: E.count,
    "A∩E": E.overlap,
    F: F.count,
    "A∩F": F.overlap,
    beforeHygiene: before.count,
    hygiene: hygiene.count,
    late: late.count,
    G: G.count,
    "A∩G": G.overlap,
    artistsAinB: artistCounts(library, B.ids.filter((id) => A.includes(id))),
    artistsC: artistCounts(library, C.ids),
    artistsFinal: (data.tracks ?? []).map((t) => `${t.artist} — ${t.name}`),
    worldFilter: lineage?.worldFilter ?? null,
    committedWorld: lineage?.committedWorld ?? null,
    lockedIntent: lineage?.lockedIntent ?? null,
    v3: lineage?.v3 ?? null,
    hqg: lineage?.hqg ?? null,
    openerHygiene: lineage?.openerHygiene ?? null,
    gate: lineage?.gate ?? null,
    _ids: { A, B: B.ids, C: C.ids, D: D.ids, F: F.ids, before: before.ids, hygiene: hygiene.ids, late: late.ids, G: G.ids },
  };
}

async function main() {
  const creds = resolveLiveBenchmarkCredentials({
    strict: true,
    defaultBaseUrl: "http://127.0.0.1:5000",
    cli: {
      baseUrl: process.env.KWALIFY_BENCHMARK_BASE_URL || process.env.SMOKE_BASE_URL || "http://127.0.0.1:5000",
    },
  });
  console.log(`[lineage-probe] ${creds.baseUrl}`);
  const library = await resolveQaLibrarySnapshot(
    join(process.cwd(), "reports", "human-quality", "100-gen", "library-snapshot.json"),
  );
  const runId = `lineage-${Date.now().toString(16).slice(-8)}`;
  const outDir = join(process.cwd(), "reports", "human-quality", "lineage-probe", runId);
  await mkdir(outDir, { recursive: true });
  const rows = [];
  for (const prompt of PROMPTS) {
    const requestId = `${runId}-${prompt.replace(/\s+/g, "-")}`;
    console.log(`[lineage-probe] ${prompt}`);
    const { httpStatus, data } = await generate(creds, prompt, requestId);
    const row = rowFromResponse(prompt, httpStatus, data, library);
    const ids = row._ids;
    delete row._ids;
    rows.push(row);
    await writeFile(
      join(outDir, `${prompt.replace(/\s+/g, "-")}.json`),
      `${JSON.stringify({ lineage: data.candidateLineage ?? null, row, ids }, null, 2)}\n`,
    );
    console.log(JSON.stringify({
      prompt,
      httpStatus,
      delivered: row.delivered,
      path: row.path,
      A: row.A,
      "A∩B": row["A∩B"],
      C: row.C,
      "A∩C": row["A∩C"],
      D: row.D,
      F: row.F,
      beforeHygiene: row.beforeHygiene,
      hygiene: row.hygiene,
      G: row.G,
      world: row.committedWorld,
      dropReasons: row.v3?.prefilterDropReasons,
      largestDrop: row.v3?.largestDrop,
      inputRouting: row.v3?.inputRouting,
      hqg: row.hqg,
      hygieneDiag: row.openerHygiene,
    }));
  }

  console.log("[lineage-probe] replay indie rock");
  const replay = await generate(creds, "indie rock", `${runId}-indie-rock-replay`);
  const replayRow = rowFromResponse("indie rock", replay.httpStatus, replay.data, library);
  const firstIndie = rows.find((r) => r.prompt === "indie rock");
  const firstIds = JSON.parse(await (await import("node:fs/promises")).readFile(join(outDir, "indie-rock.json"), "utf8"));
  const replayIds = replayRow._ids;
  delete replayRow._ids;
  const replayCompare = {
    scoringPoolIdentical: sameIds(firstIds.ids?.B ?? [], replayIds.B),
    v3Identical: sameIds(firstIds.ids?.C ?? [], replayIds.C),
    composedIdentical: sameIds(firstIds.ids?.D ?? [], replayIds.D),
    terminalIdentical: sameIds(firstIds.ids?.F ?? [], replayIds.F),
    finalIdentical: sameIds(firstIds.ids?.G ?? [], replayIds.G),
    firstDelivered: firstIndie?.delivered ?? null,
    replayDelivered: replayRow.delivered,
  };
  await writeFile(join(outDir, "indie-rock-replay.json"), `${JSON.stringify({ replayRow, replayCompare }, null, 2)}\n`);
  console.log(JSON.stringify({ replayCompare }));

  await writeFile(join(outDir, "summary.json"), `${JSON.stringify({
    runId,
    note: "Observational lineage probe. Not hq100-56fd2c72 and not the invalid hq100-a671fa94.",
    rows,
    replayCompare,
  }, null, 2)}\n`);
  console.log(`[lineage-probe] ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
