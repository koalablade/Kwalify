/**
 * Human Expectation Layer — Shadow Validation Harness (Phase 2, Priority 1).
 *
 * Runs the real benchmark prompt suite through a live server in AUDIT mode
 * (real liked-songs library, no Spotify/DB writes). The server must be booted
 * with HUMAN_EXPECTATION_LAYER=shadow so the layer computes its interpretation,
 * contract, retrieval re-rank and critic WITHOUT changing production output.
 * Each response therefore carries both the unchanged production playlist AND the
 * shadow diagnostics — a true side-by-side with zero production impact.
 *
 * Usage:
 *   node backend/dist/scripts/expectation-shadow-validation.js \
 *     --base-url http://localhost:5000 \
 *     --spotify-user-id <synced-user-id> \
 *     --token <PLAYLIST_EVAL_TOKEN> \
 *     --out reports/expectation-shadow \
 *     [--limit 50] [--category gym,focus] [--mode balanced] [--length 25] \
 *     [--delay-ms 800] [--timeout-ms 120000]
 *
 * The token also falls back to process.env.PLAYLIST_EVAL_TOKEN.
 */

import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

import { PLAYLIST_BENCHMARK_PROMPTS } from "../lib/playlist-evaluation/benchmark-prompts";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function obj(v: unknown): Record<string, any> {
  return v && typeof v === "object" ? (v as Record<string, any>) : {};
}
function arr(v: unknown): any[] {
  return Array.isArray(v) ? v : [];
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const round = (n: number | null, d = 3): number | null => (n === null ? null : Math.round(n * 10 ** d) / 10 ** d);
function avg(vals: (number | null)[]): number | null {
  const ns = vals.filter((v): v is number => v !== null);
  return ns.length ? round(ns.reduce((a, b) => a + b, 0) / ns.length) : null;
}

interface Row {
  id: string;
  category: string;
  prompt: string;
  ok: boolean;
  status: number;
  error: string | null;
  latencyMs: number;
  generationMs: number | null;
  trackCount: number | null;
  degraded: boolean;
  // interpretation
  world: string | null;
  groundedConfidence: number | null;
  novelPrompt: boolean | null;
  // contract
  atmosphere: string[];
  avoid: string[];
  // retrieval / rerank
  poolSize: number | null;
  poolAdmissibleRate: number | null;
  distinctArtists: number | null;
  distinctGenreFamilies: number | null;
  energySpread: number | null;
  eraSpreadYears: number | null;
  avgFitBefore: number | null;
  avgFitAfter: number | null;
  rerankApplied: boolean;
  promoted: string[];
  demoted: Array<{ title: string | null; reason: string }>;
  droppedInadmissible: number | null;
  // critic
  criticScore: number | null;
  criticVerdict: string | null;
  openingFit: number | null;
  middleFit: number | null;
  endingFit: number | null;
  failureModes: Array<{ mode: string; severity: string }>;
  repairApplied: boolean;
  repairRemoved: number | null;
  repairAdded: number | null;
  repairExplanation: string[];
  publishDecision: string | null;
}

function extract(bp: { id: string; category: string; prompt: string }, status: number, ok: boolean, latencyMs: number, data: Record<string, any>, error: string | null): Row {
  const hx = obj(data.humanExpectation);
  const interp = obj(hx.interpretedMoment);
  const topCand = obj(arr(interp.candidates)[0]);
  const contract = obj(hx.expectedAtmosphere);
  const rerank = obj(hx.retrievalRerank);
  const pool = obj(rerank.pool);
  const critique = obj(hx.critique);
  const sections = obj(critique.sections);
  const repair = obj(hx.repair);
  const tracks = arr(data.tracks);
  return {
    id: bp.id,
    category: bp.category,
    prompt: bp.prompt,
    ok,
    status,
    error,
    latencyMs,
    generationMs: num(data.generationMs),
    trackCount: num(data.count) ?? num(data.totalTracks) ?? tracks.length,
    degraded: data.degraded === true,
    world: typeof (rerank.world ?? topCand.label) === "string" ? (rerank.world ?? topCand.label) : null,
    groundedConfidence: num(topCand.confidence),
    novelPrompt: typeof interp.novelPrompt === "boolean" ? interp.novelPrompt : null,
    atmosphere: arr(contract.atmosphere).filter((x) => typeof x === "string"),
    avoid: arr(contract.avoid).filter((x) => typeof x === "string"),
    poolSize: num(pool.size),
    poolAdmissibleRate: num(pool.admissibleRate),
    distinctArtists: num(pool.distinctArtists),
    distinctGenreFamilies: num(pool.distinctGenreFamilies),
    energySpread: num(pool.energySpread),
    eraSpreadYears: num(pool.eraSpreadYears),
    avgFitBefore: num(rerank.avgAdmissibilityBefore),
    avgFitAfter: num(rerank.avgAdmissibilityAfter),
    rerankApplied: rerank.applied === true,
    promoted: arr(rerank.promoted).map((p) => obj(p).title).filter((t): t is string => typeof t === "string"),
    demoted: arr(rerank.demoted).map((d) => ({ title: obj(d).title ?? null, reason: String(obj(d).reason ?? "") })),
    droppedInadmissible: num(rerank.droppedInadmissible),
    criticScore: num(critique.overallFit),
    criticVerdict: typeof critique.verdict === "string" ? critique.verdict : null,
    openingFit: num(obj(sections.opening).fit),
    middleFit: num(obj(sections.middle).fit),
    endingFit: num(obj(sections.ending).fit),
    failureModes: arr(critique.failureModes).map((f) => ({ mode: String(obj(f).mode ?? "?"), severity: String(obj(f).severity ?? "?") })),
    repairApplied: repair.applied === true,
    repairRemoved: num(repair.removed),
    repairAdded: num(repair.added),
    repairExplanation: arr(repair.explanation).filter((x) => typeof x === "string"),
    publishDecision: typeof critique.verdict === "string" ? critique.verdict : null,
  };
}

function tally(items: string[]): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const it of items) m.set(it, (m.get(it) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

async function main(): Promise<void> {
  const baseUrl = (arg("--base-url", "http://localhost:5000") as string).replace(/\/$/, "");
  const spotifyUserId = arg("--spotify-user-id") ?? process.env["SMOKE_SPOTIFY_USER_ID"];
  const token = arg("--token") ?? process.env["PLAYLIST_EVAL_TOKEN"];
  const outDir = arg("--out", "reports/expectation-shadow") as string;
  const modeOverride = arg("--mode");
  const lengthOverride = arg("--length");
  const delayMs = Number.parseInt(arg("--delay-ms", "800") as string, 10);
  const timeoutMs = Number.parseInt(arg("--timeout-ms", "120000") as string, 10);
  const limit = arg("--limit") ? Number.parseInt(arg("--limit") as string, 10) : null;
  const categoryFilter = arg("--category") ? (arg("--category") as string).split(",").map((s) => s.trim()) : null;

  if (!token) {
    console.error("[shadow] Missing eval token (--token or PLAYLIST_EVAL_TOKEN).");
    process.exit(2);
  }
  if (!spotifyUserId) {
    console.error("[shadow] Missing --spotify-user-id (a synced Spotify account).");
    console.error("  Find one via: GET /api/eval/admin/smoke-spotify-user-id (EVAL_ADMIN_ENABLED=true).");
    process.exit(2);
  }

  let suite = PLAYLIST_BENCHMARK_PROMPTS as Array<{ id: string; category: string; prompt: string; mode: string; length: number }>;
  if (categoryFilter) suite = suite.filter((p) => categoryFilter.includes(p.category));
  if (limit && limit > 0) suite = suite.slice(0, limit);

  mkdirSync(outDir, { recursive: true });
  const jsonlPath = join(outDir, "results.jsonl");
  writeFileSync(jsonlPath, "");

  console.error(`[shadow] ${suite.length} prompts → ${baseUrl} (user=${spotifyUserId.slice(0, 4)}…). Server must run HUMAN_EXPECTATION_LAYER=shadow.`);

  const rows: Row[] = [];
  let sawDiagnostics = false;
  for (let i = 0; i < suite.length; i++) {
    const bp = suite[i]!;
    const mode = modeOverride ?? bp.mode ?? "balanced";
    const length = lengthOverride ? Number.parseInt(lengthOverride, 10) : bp.length ?? 25;
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let row: Row;
    try {
      const res = await fetch(`${baseUrl}/api/generate?audit=1`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-kwalify-evaluation-token": token },
        body: JSON.stringify({ vibe: bp.prompt, mode, length, auditMode: true, spotifyUserId, varietyBoost: true }),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, any>;
      const ok = res.ok && data["success"] === true;
      row = extract(bp, res.status, ok, Date.now() - started, data, ok ? null : String(data["message"] ?? data["error"] ?? res.statusText));
      if (data["humanExpectation"]) sawDiagnostics = true;
    } catch (err) {
      row = extract(bp, 0, false, Date.now() - started, {}, err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }
    rows.push(row);
    appendFileSync(jsonlPath, `${JSON.stringify(row)}\n`);
    const gain = row.avgFitBefore !== null && row.avgFitAfter !== null ? (row.avgFitAfter - row.avgFitBefore).toFixed(2) : "?";
    console.error(
      `[${i + 1}/${suite.length}] ${row.category.padEnd(10)} "${row.prompt.slice(0, 42)}" → ${row.ok ? "ok" : `FAIL(${row.status})`} ` +
        `fit ${row.avgFitBefore ?? "?"}→${row.avgFitAfter ?? "?"} (Δ${gain}) critic=${row.criticScore ?? "?"}/${row.criticVerdict ?? "?"} (${row.latencyMs}ms)`,
    );
    if (i < suite.length - 1) await sleep(delayMs);
  }

  if (!sawDiagnostics) {
    console.error("[shadow] WARNING: no `humanExpectation` field seen in any response.");
    console.error("  Boot the server with HUMAN_EXPECTATION_LAYER=shadow (or enforce) and rebuild first.");
  }

  writeFileSync(join(outDir, "report.md"), buildReport(baseUrl, rows, sawDiagnostics));
  console.error(`[shadow] wrote ${jsonlPath} and ${join(outDir, "report.md")}`);
  if (rows.filter((r) => r.ok).length === 0) process.exit(1);
}

function buildReport(baseUrl: string, rows: Row[], sawDiagnostics: boolean): string {
  const ok = rows.filter((r) => r.ok);
  const withFit = ok.filter((r) => r.avgFitBefore !== null && r.avgFitAfter !== null);
  const helped = withFit.filter((r) => (r.avgFitAfter! - r.avgFitBefore!) > 0.005);
  const harmed = withFit.filter((r) => (r.avgFitAfter! - r.avgFitBefore!) < -0.005);
  const unchanged = withFit.filter((r) => Math.abs(r.avgFitAfter! - r.avgFitBefore!) <= 0.005);
  const gains = withFit.map((r) => r.avgFitAfter! - r.avgFitBefore!);
  const avgGain = gains.length ? round(gains.reduce((a, b) => a + b, 0) / gains.length) : null;

  const L: string[] = [];
  L.push("# Human Expectation Layer — Shadow Validation Report");
  L.push("");
  L.push(`- Server: ${baseUrl}`);
  L.push(`- Prompts: ${rows.length} | Succeeded: ${ok.length} | Failed: ${rows.length - ok.length}`);
  L.push(`- Diagnostics present: ${sawDiagnostics ? "yes" : "NO — server not in shadow/enforce mode"}`);
  L.push("");
  L.push("## Overall averages");
  L.push("");
  L.push(`- Avg admissibility BEFORE rerank: ${avg(ok.map((r) => r.avgFitBefore)) ?? "—"}`);
  L.push(`- Avg admissibility AFTER rerank:  ${avg(ok.map((r) => r.avgFitAfter)) ?? "—"}`);
  L.push(`- **Avg admissibility gain: ${avgGain ?? "—"}**`);
  L.push(`- Avg critic score: ${avg(ok.map((r) => r.criticScore)) ?? "—"} / 100`);
  L.push(`- Avg opening/middle/ending fit: ${avg(ok.map((r) => r.openingFit)) ?? "—"} / ${avg(ok.map((r) => r.middleFit)) ?? "—"} / ${avg(ok.map((r) => r.endingFit)) ?? "—"}`);
  L.push(`- Avg candidate pool admissible rate: ${avg(ok.map((r) => r.poolAdmissibleRate)) ?? "—"}`);
  L.push(`- Avg generation time: ${avg(ok.map((r) => r.generationMs)) ?? "—"} ms`);
  L.push("");
  L.push("## Prompts helped / unchanged / harmed (by rerank admissibility)");
  L.push("");
  L.push(`- Helped:    ${helped.length}`);
  L.push(`- Unchanged: ${unchanged.length}`);
  L.push(`- Harmed:    ${harmed.length}  ${harmed.length ? "⚠️ (guard should prevent this — investigate)" : ""}`);
  L.push("");

  L.push("## Critic verdict distribution");
  L.push("");
  for (const [v, n] of tally(ok.map((r) => r.criticVerdict ?? "unknown"))) L.push(`- ${v}: ${n}`);
  L.push("");

  L.push("## Failure categories (critic failure modes)");
  L.push("");
  const fm = tally(ok.flatMap((r) => r.failureModes.map((f) => `${f.mode} (${f.severity})`)));
  if (fm.length === 0) L.push("- none");
  for (const [m, n] of fm) L.push(`- ${m}: ${n}`);
  L.push("");

  L.push("## Most common expectation violations (demotion reasons)");
  L.push("");
  const viol = tally(ok.flatMap((r) => r.demoted.map((d) => d.reason.replace(/\(.*?\)/g, "").trim()).filter(Boolean)));
  if (viol.length === 0) L.push("- none");
  for (const [v, n] of viol.slice(0, 15)) L.push(`- ${v}: ${n}`);
  L.push("");

  L.push("## Most common repair operations");
  L.push("");
  const rep = tally(ok.flatMap((r) => r.repairExplanation.map((e) => e.replace(/\d+/g, "N").replace(/\(.*?\)/g, "").trim())));
  if (rep.length === 0) L.push("- none");
  for (const [e, n] of rep.slice(0, 15)) L.push(`- ${e}: ${n}`);
  L.push("");

  L.push("## Top reranked tracks (most frequently demoted)");
  L.push("");
  const demTracks = tally(ok.flatMap((r) => r.demoted.map((d) => d.title ?? "").filter(Boolean)));
  if (demTracks.length === 0) L.push("- none");
  for (const [t, n] of demTracks.slice(0, 15)) L.push(`- ${t}: ${n}`);
  L.push("");

  L.push("## Retrieval-recall signal (low pool supply)");
  L.push("");
  const lowSupply = ok.filter((r) => r.poolAdmissibleRate !== null && r.poolAdmissibleRate < 0.5).sort((a, b) => (a.poolAdmissibleRate! - b.poolAdmissibleRate!));
  L.push(`- Prompts where <50% of the candidate pool was admissible: ${lowSupply.length}`);
  for (const r of lowSupply.slice(0, 15)) L.push(`  - "${r.prompt}" — admissibleRate ${r.poolAdmissibleRate}, poolSize ${r.poolSize}, novel=${r.novelPrompt}`);
  L.push("");

  L.push("## Novel / unknown interpretations (grounding gaps for Priority 4)");
  L.push("");
  const novel = ok.filter((r) => r.novelPrompt === true);
  L.push(`- Novel prompts: ${novel.length}`);
  for (const r of novel.slice(0, 25)) L.push(`  - "${r.prompt}" (grounded conf ${r.groundedConfidence ?? "—"}, world ${r.world ?? "—"})`);
  L.push("");

  L.push("## Regression candidates (enforce would have changed a healthy playlist)");
  L.push("");
  const regress = ok.filter((r) => r.rerankApplied && r.avgFitBefore !== null && r.avgFitBefore >= 0.8 && (r.avgFitAfter! - r.avgFitBefore) < 0.02);
  L.push(`- ${regress.length} (rerank applied where selection was already strong)`);
  for (const r of regress.slice(0, 15)) L.push(`  - "${r.prompt}" fit ${r.avgFitBefore}→${r.avgFitAfter}`);
  L.push("");

  L.push("## Per-prompt comparison");
  L.push("");
  L.push("| id | category | prompt | world | novel | fitBefore | fitAfter | Δ | critic | verdict | promoted | demoted | poolAdm |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const d = r.avgFitBefore !== null && r.avgFitAfter !== null ? round(r.avgFitAfter - r.avgFitBefore) : null;
    L.push(
      `| ${r.id} | ${r.category} | ${r.prompt.replace(/\|/g, "/").slice(0, 40)} | ${(r.world ?? "—").toString().slice(0, 24)} | ` +
        `${r.novelPrompt ? "Y" : "n"} | ${r.avgFitBefore ?? "—"} | ${r.avgFitAfter ?? "—"} | ${d ?? "—"} | ${r.criticScore ?? "—"} | ` +
        `${r.criticVerdict ?? "—"} | ${r.promoted.length} | ${r.demoted.length} | ${r.poolAdmissibleRate ?? "—"} |`,
    );
  }
  L.push("");
  L.push("> Shadow only: production output is unchanged. `Δ` is the admissibility gain the rerank WOULD deliver in enforce mode.");
  return `${L.join("\n")}\n`;
}

main().catch((err) => {
  console.error("[shadow] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
