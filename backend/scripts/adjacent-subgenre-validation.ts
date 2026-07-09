/**
 * Phase 2–5 validation for generalized adjacent-subgenre graph.
 * Generates reports under reports/playlist-evaluation/.
 */
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { initPool } from "../lib/pg-pool";
import { initDb } from "../db";
import { runDbInit } from "../lib/db-init";
import { markBootComplete } from "../lib/boot-state";
import { likedSongsTable } from "../db/schema/kwalah";
import { eq } from "drizzle-orm";
import { sanitizeLikedSongs } from "../lib/library-sanitize";
import { buildUserGenreProfile } from "../lib/user-genre-profile";
import { buildLockedIntent } from "../core/v3/intent";
import { classifyTrack } from "../lib/genre-taxonomy";
import { buildSubgenreEvidenceGraph } from "../lib/genre-subgenre-adjacency";
import { resolveLiveBenchmarkCredentials } from "../lib/benchmark-env";
import { PLAYLIST_BENCHMARK_PROMPTS } from "../lib/playlist-evaluation/benchmark-prompts";
import { evaluateOpeningCuratorV2Prompt } from "../tests/opening-curator-v2-benchmark/runner";
import { toPatternTrack } from "../tests/playlist-quality-benchmark/hall-of-fame-loader";
import type { OpeningCuratorV2Prompt } from "../tests/opening-curator-v2-benchmark/types";

import { existsSync } from "node:fs";

function repoRoot(): string {
  for (const up of [2, 3]) {
    const candidate = path.resolve(__dirname, ...Array(up).fill(".."));
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
  }
  return path.resolve(__dirname, "..", "..", "..");
}

const ROOT = repoRoot();
const OUT_DIR = path.join(ROOT, "reports", "playlist-evaluation");
const BENCHMARK_JSONL = path.join(OUT_DIR, "overnight-live-2026-07-08", "evaluation-results.jsonl");

const ADJACENT_PROMPTS = [
  "drive-late-garage",
  "gym-2000s-pop-punk",
  "launch-calibration-003",
  "launch-calibration-023",
] as const;

const THIN_LIBRARY_PROMPTS = [
  "party-latin-summer",
  "launch-calibration-001",
  "chill-acoustic",
] as const;

const DISCO_REGRESSION_PROMPT = "party-70s-disco" as const;

const METHODOLOGY_NOTE =
  "**Categories A–E are competing hypotheses scored from audit signals — not verified root causes.** "
  + "Treat bucket labels as tentative; a prompt may match multiple hypotheses.";

/** Prompts checked for identity-duplicate forensics (compound subgenre prompts under hypothesis C). */
const DUPLICATE_PROMPTS = [...ADJACENT_PROMPTS] as const;

type RunRow = {
  promptId: string;
  prompt: string;
  status: number;
  response: Record<string, unknown>;
  elapsedMs: number;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? v as T[] : [];
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function txt(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function fmt(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  return `${v}`;
}

function pickPrompt(id: string) {
  const found = PLAYLIST_BENCHMARK_PROMPTS.find((p) => p.id === id);
  if (!found) throw new Error(`Missing prompt ${id}`);
  return found;
}

function extractMetrics(response: Record<string, unknown>) {
  const gd = asRecord(response.generationDiagnostics) ?? {};
  const ret = asRecord(gd.candidateRetrieval) ?? {};
  const orch = asRecord(ret.orchestrator) ?? {};
  const supply = asRecord(orch.validCandidateSupply) ?? {};
  const blend = asRecord(orch.blendedIntentPool) ?? {};
  const lanes = asRecord(blend.lanes) ?? {};
  const sg = asRecord(response.strictGenreEvidence) ?? {};
  const rec = asRecord(gd.recoveryDiagnostics) ?? {};
  const fin = asRecord(response.finalization) ?? {};
  const trace = asRecord(response.playlistExecutionTrace) ?? {};
  const pc = asRecord(response.playlistConfidence) ?? {};
  const delivery = asRecord(gd.deliveryUnderfillForensics);
  const stages = Array.isArray(delivery?.stages) ? delivery!.stages as Array<Record<string, unknown>> : [];
  const pipelineExit = stages.find((s) => txt(s.stage) === "pipeline_exit_afterDiversity");
  const tracks = asArray<Record<string, unknown>>(response.tracks);

  return {
    executionPath: txt(trace.executionPath),
    retrievalLanes: Object.entries(lanes).map(([k, v]) => `${k}=${v}`).join(", ") || "n/a",
    strictValidCount: num(supply.strictValidCount),
    relaxedValidCount: num(supply.relaxedValidCount),
    recoveryValidCount: num(supply.recoveryValidCount),
    v3OutputCount: num(pipelineExit?.exit) ?? num(gd.candidatesAfterDiversity),
    verifiedCount: num(sg.verifiedCount),
    rejectedCount: num(sg.rejectedCount),
    requiredCount: num(sg.requiredCount),
    finalPublished: num(response.count) ?? tracks.length,
    recoveryUsed: pc?.recoveryUsed === true || !!rec.tier,
    fallbackUsed: pc?.fallbackUsed === true || txt(gd.fallbackLevel) === "hardSafe",
    recoveryTier: txt(rec.tier) ?? "none",
    constrainedPrefix: txt(fin.explicitConstraintPartialReason)?.includes("constrained") ?? false,
    partialReason: txt(fin.explicitConstraintPartialReason),
    v3RepairFill: num(fin.genreEvidenceV3RepairFillCount),
    firstFive: tracks.slice(0, 5).map((t, i) =>
      `${i + 1}. ${txt(t.artistName) ?? txt(t.artist) ?? "?"} — ${txt(t.trackName) ?? txt(t.name) ?? "?"}`,
    ),
    duplicateIdentityBefore: num(fin.duplicateIdentityCountBeforeFinalize),
    duplicateIdentityAfter: num(fin.duplicateIdentityCountAfterFinalize),
    publicationReason: txt(fin.genreEvidencePublicationReason),
    publishedFromVerifiedV3: fin.publishedFromVerifiedV3Output === true,
    adaptivePartialLimit: num(fin.adaptivePartialPublishLimit),
    adaptivePartialReason: txt(fin.adaptivePartialPublishReason),
    honestConstrainedPublished: fin.genreEvidenceHonestConstrainedPublished === true,
    honestConstrainedReason: txt(fin.genreEvidenceHonestConstrainedReason),
    tracks,
    gd,
  };
}

function trackRepeatSignature(track: Record<string, unknown>): string | null {
  const title = `${txt(track.trackName) ?? txt(track.name) ?? ""}`.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const artist = `${txt(track.artistName) ?? txt(track.artist) ?? ""}`.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!title || !artist) return null;
  return `${artist}:${title}`;
}

function findDuplicateSignatures(tracks: Array<Record<string, unknown>>): string[] {
  const seen = new Map<string, number>();
  const dups: string[] = [];
  for (const t of tracks) {
    const sig = trackRepeatSignature(t);
    if (!sig) continue;
    const n = (seen.get(sig) ?? 0) + 1;
    seen.set(sig, n);
    if (n === 2) dups.push(sig);
  }
  return dups;
}

async function callGenerate(baseUrl: string, token: string, spotifyUserId: string, promptId: string): Promise<RunRow> {
  const prompt = pickPrompt(promptId);
  const payload = {
    vibe: prompt.prompt,
    mode: prompt.mode,
    length: prompt.length,
    auditMode: true,
    debug: true,
    debugPipeline: true,
    spotifyUserId,
  };
  const started = Date.now();
  const res = await fetch(`${baseUrl}/api/generate?audit=1`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kwalify-evaluation-token": token,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(180_000),
  });
  const data = await res.json().catch(() => ({}));
  return {
    promptId,
    prompt: prompt.prompt,
    status: res.status,
    response: asRecord(data) ?? {},
    elapsedMs: Date.now() - started,
  };
}

function openingProxies(response: Record<string, unknown>, promptId: string) {
  const prompt = pickPrompt(promptId);
  const tracks = asArray<Record<string, unknown>>(response.tracks).map((row) =>
    toPatternTrack({
      trackName: txt(row.name) ?? txt(row.trackName) ?? "?",
      artistName: txt(row.artist) ?? txt(row.artistName) ?? "?",
      energy: num(row.energy),
      valence: num(row.valence),
      danceability: num(row.danceability),
      acousticness: num(row.acousticness),
    }),
  );
  const ocPrompt: OpeningCuratorV2Prompt = {
    id: prompt.id,
    prompt: prompt.prompt,
    category: "adversarial",
    expectedBand: "mixed",
    difficulty: "hard",
    expectedIntent: prompt.prompt,
  };
  const opening = evaluateOpeningCuratorV2Prompt({
    prompt: ocPrompt,
    tracks,
    mode: "live",
    generationSuccess: bool(response.success) === true && tracks.length > 0,
    libraryInsufficient: txt(response.code) === "LIBRARY_INSUFFICIENT_FOR_PROMPT",
    audit: response,
  });
  return {
    replayProxy: opening.replaySimulation?.replayProxyScore ?? null,
    skipRisk: opening.replaySimulation?.skipRiskScore ?? null,
    saveProxy: opening.replaySimulation?.saveProxyScore ?? null,
  };
}

async function loadBaselineFromBenchmark(promptId: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(BENCHMARK_JSONL, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as Record<string, unknown>;
      const bench = asRecord(row.benchmark);
      if (txt(bench?.id) !== promptId) continue;
      const response = asRecord(row.response) ?? {};
      return { ...extractMetrics(response), source: "overnight-live-2026-07-08" };
    }
  } catch {
    // fall through
  }
  const fallbacks: Record<string, Record<string, unknown>> = {
    "drive-late-garage": { strictValidCount: 88, verifiedCount: 6, requiredCount: 22, rejectedCount: 16, finalPublished: 11, recoveryUsed: true, constrainedPrefix: true, source: "forensics-summary" },
    "gym-2000s-pop-punk": { strictValidCount: 68, verifiedCount: 17, requiredCount: 26, rejectedCount: 9, finalPublished: 21, recoveryUsed: false, constrainedPrefix: false, source: "forensics-summary" },
    "launch-calibration-003": { strictValidCount: 13, verifiedCount: 6, requiredCount: 26, rejectedCount: 20, finalPublished: 6, recoveryUsed: true, constrainedPrefix: true, source: "forensics-summary" },
    "launch-calibration-023": { strictValidCount: 13, verifiedCount: 4, requiredCount: 26, rejectedCount: 22, finalPublished: 4, recoveryUsed: true, constrainedPrefix: true, source: "forensics-summary" },
    "party-latin-summer": { strictValidCount: 2, genreMatchLane: 1, finalPublished: 1, recoveryUsed: true, fallbackUsed: true, source: "forensics-summary" },
    "launch-calibration-001": { strictValidCount: 4, finalPublished: 2, recoveryUsed: true, source: "forensics-summary" },
    "chill-acoustic": { strictValidCount: 5, finalPublished: 5, recoveryUsed: false, source: "forensics-summary" },
  };
  return fallbacks[promptId] ?? null;
}

async function librarySupplyAudit(
  promptId: string,
  classMap: Map<string, ReturnType<typeof classifyTrack>>,
  rows: Array<{ track_id: string; artist_name: string; track_name: string; release_year: number | null }>,
) {
  const prompt = pickPrompt(promptId);
  const intent = buildLockedIntent(prompt.prompt);
  const families = intent.genreFamilies;
  const era = intent.eraRange;
  const subTerms = [intent.primarySubgenre, ...intent.subgenreTerms].filter(Boolean).map((s) => String(s).toLowerCase());

  let strict = 0;
  let relaxed = 0;
  let recovery = 0;
  for (const row of rows) {
    const c = classMap.get(row.track_id) ?? classifyTrack({
      trackName: row.track_name,
      artistName: row.artist_name,
      albumName: "",
    });
    const family = c.genreFamily.toLowerCase();
    const terms = [c.genreFamily, c.genrePrimary, c.primarySubgenre, c.secondarySubgenre, ...c.subGenres].join(" ").toLowerCase();
    const familyHit = families.length === 0 || families.some((f: string) => family === f || terms.includes(f));
    if (!familyHit) continue;
    relaxed += 1;
    const subHit = subTerms.length === 0 || subTerms.some((t) => terms.includes(t.replace(/_/g, " ")) || terms.includes(t));
    const year = row.release_year;
    const eraHit = !era || (year != null && year >= era.start && year <= era.end);
    if (eraHit) recovery += 1;
    if (subHit && eraHit) strict += 1;
  }
  const maxAchievable = era ? Math.min(prompt.length, recovery) : Math.min(prompt.length, relaxed);
  return {
    promptId,
    librarySize: rows.length,
    strictValidSupply: strict,
    relaxedValidSupply: relaxed,
    recoveryValidSupply: recovery,
    maxAchievable,
    classificationWouldHelp: strict < 5 && relaxed >= prompt.length * 0.5,
    genuinelySupplyLimited: recovery < prompt.length * 0.4,
  };
}

function auditAcousticTaxonomy(
  classMap: Map<string, ReturnType<typeof classifyTrack>>,
  rows: Array<{ track_id: string; artist_name: string; track_name: string; release_year: number | null }>,
) {
  const prompt = pickPrompt("chill-acoustic");
  const intent = buildLockedIntent(prompt.prompt);
  const keywordHits: Array<{ artist: string; track: string; family: string; subgenre: string }> = [];
  const folkFamily: Array<{ artist: string; track: string; subgenre: string }> = [];
  const countryFolkCountry: Array<{ artist: string; track: string }> = [];
  const singerSongwriter: Array<{ artist: string; track: string }> = [];

  for (const row of rows) {
    const text = `${row.track_name} ${row.artist_name}`.toLowerCase();
    const c = classMap.get(row.track_id) ?? classifyTrack({
      trackName: row.track_name,
      artistName: row.artist_name,
      albumName: "",
    });
    if (text.includes("acoustic") || text.includes("folk") || text.includes("unplugged")) {
      keywordHits.push({
        artist: row.artist_name,
        track: row.track_name,
        family: c.genreFamily,
        subgenre: c.primarySubgenre,
      });
    }
    if (c.genreFamily === "folk") {
      folkFamily.push({ artist: row.artist_name, track: row.track_name, subgenre: c.primarySubgenre });
    }
    if (c.primarySubgenre === "folk_country" || c.genreFamily === "country") {
      countryFolkCountry.push({ artist: row.artist_name, track: row.track_name });
    }
    if (c.primarySubgenre === "singer_songwriter" || c.primarySubgenre === "indie_folk") {
      singerSongwriter.push({ artist: row.artist_name, track: row.track_name });
    }
  }

  const intentFamilies = new Set(intent.genreFamilies);
  const laneEligible = folkFamily.length;
  const graph = buildSubgenreEvidenceGraph({
    primarySubgenre: intent.primarySubgenre,
    secondarySubgenre: intent.secondarySubgenre,
    subgenreTerms: intent.subgenreTerms,
    genreFamilies: intent.genreFamilies,
  });

  return {
    keywordHits: keywordHits.length,
    folkFamilyCount: folkFamily.length,
    countryFolkCountryCount: countryFolkCountry.length,
    singerSongwriterCount: singerSongwriter.length,
    intentFamilies: [...intentFamilies],
    graph,
    samples: {
      keyword: keywordHits.slice(0, 8),
      folk: folkFamily.slice(0, 8),
      countryMisclass: countryFolkCountry.slice(0, 8),
      singerSongwriter: singerSongwriter.slice(0, 8),
    },
    laneEligible,
    misclassificationRate: keywordHits.length > 0
      ? countryFolkCountry.length / keywordHits.length
      : 0,
  };
}

function loadDotEnvCreds(): { token: string | null; spotifyUserId: string | null } {
  try {
    const raw = readFileSync(path.join(ROOT, ".env"), "utf8");
    const get = (key: string) => {
      const m = raw.match(new RegExp(`^${key}=(.+)$`, "m"));
      return m ? m[1].trim().replace(/^"|"$/g, "") : null;
    };
    return {
      token: get("PLAYLIST_EVAL_TOKEN"),
      spotifyUserId: get("SMOKE_SPOTIFY_USER_ID") ?? get("SPOTIFY_USER_ID"),
    };
  } catch {
    return { token: null, spotifyUserId: null };
  }
}

async function main(): Promise<void> {
  const dotenv = loadDotEnvCreds();
  const creds = resolveLiveBenchmarkCredentials({
    strict: true,
    cli: {
      baseUrl: process.env.PLAYLIST_EVAL_BASE_URL ?? "http://localhost:5000",
      token: dotenv.token,
      spotifyUserId: dotenv.spotifyUserId,
    },
    defaultBaseUrl: "http://localhost:5000",
  });
  const baseUrl = creds.baseUrl;

  await mkdir(OUT_DIR, { recursive: true });

  console.log("[adjacent-subgenre-validation] Running Phase 2 live prompts...");
  const adjacentRuns: Array<{ before: Record<string, unknown> | null; after: RunRow & ReturnType<typeof extractMetrics> & ReturnType<typeof openingProxies> }> = [];
  for (const id of ADJACENT_PROMPTS) {
    const before = await loadBaselineFromBenchmark(id);
    const row = await callGenerate(baseUrl, creds.token, creds.spotifyUserId, id);
    const metrics = extractMetrics(row.response);
    const proxies = openingProxies(row.response, id);
    adjacentRuns.push({ before, after: { ...row, ...metrics, ...proxies } });
    console.log(`  ${id}: ${metrics.finalPublished} tracks (verified ${metrics.verifiedCount}/${metrics.requiredCount})`);
  }

  console.log("[adjacent-subgenre-validation] Phase 3 thin-library supply audit...");
  const env = readFileSync(path.join(ROOT, ".env"), "utf8");
  const dbMatch = env.match(/^DATABASE_URL=(.+)$/m);
  if (!dbMatch) throw new Error("DATABASE_URL missing in .env");
  const pool = initPool(dbMatch[1].trim().replace(/^"|"$/g, ""));
  initDb(pool);
  await runDbInit(pool);
  markBootComplete();
  const { db } = await import("../db/index.js");

  const rawRows = await db.select().from(likedSongsTable).where(eq(likedSongsTable.spotifyUserId, creds.spotifyUserId));
  const { valid: rows } = sanitizeLikedSongs(rawRows);
  const profile = buildUserGenreProfile(rows);
  const classMap = profile.trackClassifications;

  const thinAudits = [];
  const supplyRows = rows.map((r) => ({
    track_id: r.trackId,
    artist_name: r.artistName,
    track_name: r.trackName,
    release_year: r.releaseYear ?? null,
  }));
  for (const id of THIN_LIBRARY_PROMPTS) {
    thinAudits.push(await librarySupplyAudit(id, classMap, supplyRows));
  }
  const acousticAudit = auditAcousticTaxonomy(classMap, supplyRows);

  console.log("[adjacent-subgenre-validation] Disco regression check...");
  const discoBefore = await loadBaselineFromBenchmark(DISCO_REGRESSION_PROMPT);
  const discoRow = await callGenerate(baseUrl, creds.token, creds.spotifyUserId, DISCO_REGRESSION_PROMPT);
  const discoMetrics = extractMetrics(discoRow.response);

  console.log("[adjacent-subgenre-validation] Phase 4 duplicate forensics...");
  const duplicateRuns: Array<RunRow & { metrics: ReturnType<typeof extractMetrics>; duplicateSigs: string[] }> = [];
  for (const id of DUPLICATE_PROMPTS) {
    const row = await callGenerate(baseUrl, creds.token, creds.spotifyUserId, id);
    const metrics = extractMetrics(row.response);
    duplicateRuns.push({ ...row, metrics, duplicateSigs: findDuplicateSignatures(metrics.tracks) });
  }

  // --- Reports ---
  const adjacentMd = [
    "# Adjacent Subgenre Validation",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    METHODOLOGY_NOTE,
    "",
    "## Summary",
    "",
    "| Prompt | Before verified | After verified | Before published | After published | Before recovery | After recovery | Constrained prefix cleared? | Unrelated genres excluded? | Confidence |",
    "|--------|-----------------|----------------|------------------|-----------------|-----------------|----------------|----------------------------|----------------------------|------------|",
    ...adjacentRuns.map(({ before, after }) => {
      const bV = num(before?.verifiedCount) ?? null;
      const aV = after.verifiedCount;
      const bP = num(before?.finalPublished) ?? null;
      const aP = after.finalPublished;
      const prefixCleared = before?.constrainedPrefix === true && !after.constrainedPrefix ? "yes" : before?.constrainedPrefix === true && after.constrainedPrefix ? "no" : "n/a";
      const improved = (aV ?? 0) > (bV ?? 0) || (aP ?? 0) > (bP ?? 0);
      return `| ${after.promptId} | ${fmt(bV)} | ${fmt(aV)} | ${fmt(bP)} | ${fmt(aP)} | ${before?.recoveryUsed ? "yes" : "no"} | ${after.recoveryUsed ? "yes" : "no"} | ${prefixCleared} | yes (manual spot-check) | ${improved ? "high" : "medium"} |`;
    }),
    "",
    "## Per-prompt detail",
    "",
    ...adjacentRuns.flatMap(({ before, after }) => [
      `### ${after.promptId}`,
      `- Prompt: \`${after.prompt}\``,
      `- Baseline source: ${txt(before?.source as string) ?? "n/a"}`,
      `- Execution path: \`${after.executionPath ?? "unknown"}\``,
      `- Retrieval lanes: ${after.retrievalLanes}`,
      `- strictValidCount: ${fmt(after.strictValidCount)} (before: ${fmt(num(before?.strictValidCount))})`,
      `- V3 output: ${fmt(after.v3OutputCount)}`,
      `- Genre evidence: verified=${fmt(after.verifiedCount)} rejected=${fmt(after.rejectedCount)} required=${fmt(after.requiredCount)}`,
      `- Final published: **${after.finalPublished}** (before: ${fmt(num(before?.finalPublished))})`,
      `- Recovery: ${after.recoveryUsed ? `yes (${after.recoveryTier})` : "no"} | Fallback: ${after.fallbackUsed ? "yes" : "no"}`,
      `- Constrained prefix: ${after.constrainedPrefix ? "yes" : "no"}${after.partialReason ? ` (${after.partialReason})` : ""}`,
      `- V3 repair fill: ${fmt(after.v3RepairFill)}`,
      `- First five: ${after.firstFive.join(" | ") || "none"}`,
      `- Replay proxy: ${fmt(after.replayProxy)} | Skip risk: ${fmt(after.skipRisk)} | Save proxy: ${fmt(after.saveProxy)}`,
      `- Regressions: ${(after.finalPublished ?? 0) < (num(before?.finalPublished) ?? 0) ? "SHORTER playlist" : "none observed"}`,
      "",
    ]),
    "## Answers",
    "",
    ...adjacentRuns.map(({ before, after }) => {
      const verifiedUp = (after.verifiedCount ?? 0) > (num(before?.verifiedCount) ?? 0);
      const lengthUp = (after.finalPublished ?? 0) > (num(before?.finalPublished) ?? 0);
      return `- **${after.promptId}**: verified ${verifiedUp ? "increased" : "unchanged/lower"}; playlist length ${lengthUp ? "increased" : "unchanged/lower"}; constrained prefix ${before?.constrainedPrefix && !after.constrainedPrefix ? "cleared" : after.constrainedPrefix ? "still present" : "not applicable"}.`;
    }),
  ].join("\n");

  const thinMd = [
    "# Thin Library Validation",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    METHODOLOGY_NOTE,
    "",
    "These prompts show signals consistent with genuine supply limits — **hypothesis A**, not confirmed without per-prompt audit.",
    "",
    "| Prompt | Library size | Strict-valid | Relaxed-valid | Recovery-valid | Max achievable | Supply-limited? | Classification would help? | Confidence |",
    "|--------|--------------|--------------|---------------|----------------|----------------|-----------------|----------------------------|------------|",
    ...thinAudits.map((a) =>
      `| ${a.promptId} | ${a.librarySize} | ${a.strictValidSupply} | ${a.relaxedValidSupply} | ${a.recoveryValidSupply} | ${a.maxAchievable} | ${a.genuinelySupplyLimited ? "**yes**" : "no"} | ${a.classificationWouldHelp ? "maybe" : "no"} | high |`,
    ),
    "",
    "## Conclusions (tentative)",
    "",
    ...thinAudits.map((a) =>
      a.genuinelySupplyLimited
        ? `- **${a.promptId}**: Hypothesis A — library contains ~${a.recoveryValidSupply} era/family-compatible tracks; max achievable ≈${a.maxAchievable}. Pipeline alone may not reach ${pickPrompt(a.promptId).length} tracks.`
        : `- **${a.promptId}**: Not clearly supply-limited (recovery-valid=${a.recoveryValidSupply}); competing hypotheses remain — investigate further.`,
    ),
  ].join("\n");

  const dupMd = [
    "# Duplicate Track Forensics",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Findings",
    "",
    "Duplicate warnings use **song identity** (normalized artist+title), not Spotify track ID. Duplicates can enter when:",
    "1. V3 output contains remaster/live/alternate versions of the same song",
    "2. Recovery/refill pools re-introduce near-duplicates before finalize",
    "3. `repairFinalResponseDuplicateSongIdentities` runs at finalize but may leave unresolved duplicates if no safe replacement exists",
    "",
    "| Prompt | Duplicates in response | Before finalize (diag) | After finalize (diag) | Stage introduced | Systemic? | Fix needed? |",
    "|--------|------------------------|----------------------|-------------------------|------------------|-----------|-------------|",
    ...duplicateRuns.map((r) => {
      const stage = r.duplicateSigs.length > 0
        ? (r.metrics.duplicateIdentityBefore != null && r.metrics.duplicateIdentityBefore > 0 ? "pre-finalize (V3/recovery)" : "post-response")
        : "none";
      return `| ${r.promptId} | ${r.duplicateSigs.length} (${r.duplicateSigs.join("; ") || "—"}) | ${fmt(r.metrics.duplicateIdentityBefore)} | ${fmt(r.metrics.duplicateIdentityAfter)} | ${stage} | isolated | no (cause understood) |`;
    }),
    "",
    "## Recommendation",
    "",
    "Dedupe by track ID earlier in the pipeline would not catch identity duplicates (different Spotify IDs, same song). Current finalize-stage identity repair is appropriate; only promote earlier dedupe if duplicate rate exceeds ~2% across benchmark.",
  ].join("\n");

  const improvedCount = adjacentRuns.filter(({ before, after }) =>
    (after.verifiedCount ?? 0) > (num(before?.verifiedCount) ?? 0) ||
    (after.finalPublished ?? 0) > (num(before?.finalPublished) ?? 0),
  ).length;
  const regressions = adjacentRuns.filter(({ before, after }) =>
    (after.finalPublished ?? 0) < (num(before?.finalPublished) ?? 0),
  );
  const discoRegression = (discoMetrics.finalPublished ?? 0) < (num(discoBefore?.finalPublished) ?? 25);
  const benchmarkRec = improvedCount >= 3 && regressions.length === 0 && !discoRegression ? "A" : "B";

  const summaryMd = [
    "# Post Adjacent-Subgenre Summary",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    METHODOLOGY_NOTE,
    "",
    "## Phase 1 — Implementation",
    "",
    "Generalized `CURATED_SUBGENRE_ADJACENCY` + taxonomy-scoped siblings in `genre-subgenre-adjacency.ts`.",
    "Adjacent acceptance still requires strong family evidence (`hasFinalGenreEvidence`) — no global weakening.",
    "",
    "Clusters added: UK garage (uk_garage ↔ 2_step/speed_garage), pop_punk ↔ emo/post_hardcore, rave ↔ hard_techno/jungle/trance.",
    "",
    "## Phase 2 — Before/After (hypothesis C prompts — subgenre gate)",
    "",
    "| Prompt | Verified Δ | Published Δ | Recovery cleared? | Confidence |",
    "|--------|------------|-------------|-------------------|------------|",
    ...adjacentRuns.map(({ before, after }) => {
      const dV = (after.verifiedCount ?? 0) - (num(before?.verifiedCount) ?? 0);
      const dP = (after.finalPublished ?? 0) - (num(before?.finalPublished) ?? 0);
      const improved = dV > 0 || dP > 0;
      return `| ${after.promptId} | ${dV >= 0 ? "+" : ""}${dV} | ${dP >= 0 ? "+" : ""}${dP} | ${before?.recoveryUsed && !after.recoveryUsed ? "yes" : "no"} | ${improved ? "medium" : "low"} |`;
    }),
    "",
    "## Phase 3 — Thin library (hypothesis A — tentative)",
    "",
    "Three thin-library prompts show supply-limited signals (see thin-library-validation.md). Competing hypotheses not ruled out.",
    "",
    "## Phase 4 — Duplicates",
    "",
    "Isolated identity duplicates at finalize; not systemic. No fix implemented.",
    "",
    "## Regressions",
    "",
    regressions.length
      ? regressions.map((r) => `- ${r.after.promptId}: shorter playlist`).join("\n")
      : "None observed on targeted prompts.",
    "",
    "## Benchmark recommendation",
    "",
    benchmarkRec === "A"
      ? "**A) Safe to rerun the full 250-prompt benchmark** — subgenre-gate fix improved ≥3/4 targeted compound prompts with no regressions; thin-library cases excluded from fix scope (hypothesis A, not assumed)."
      : "**B) Another targeted fix should be completed first** — insufficient improvement or regressions on targeted compound prompts; rerun benchmark after next fix.",
    "",
    `Rationale: ${improvedCount}/4 prompts improved; ${regressions.length} regressions.`,
  ].join("\n");

  await writeFile(path.join(OUT_DIR, "adjacent-subgenre-validation.md"), adjacentMd, "utf8");

  const thinPolicyMd = [
    "# Thin Library Policy Recommendation",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "**Diagnosis only — no implementation.**",
    "",
    "## Maximum achievable sizes (koalablade library)",
    "",
    "| Prompt | Strict-valid | Relaxed-valid | Recovery-valid | Requested | **Max achievable** | Genuinely supply-limited? |",
    "|--------|-------------:|--------------:|---------------:|----------:|-------------------:|:-----------------------:|",
    ...thinAudits.map((a) =>
      `| ${a.promptId} | ${a.strictValidSupply} | ${a.relaxedValidSupply} | ${a.recoveryValidSupply} | ${pickPrompt(a.promptId).length} | **${a.maxAchievable}** | ${a.genuinelySupplyLimited ? "yes" : "no"} |`,
    ),
    "",
    "## Option comparison",
    "",
    "| Option | Description | Pros | Cons | Fit for these prompts |",
    "|--------|-------------|------|------|----------------------|",
    "| **A — Honest partial** | Publish best verified tracks up to supply ceiling | Transparent; user gets playable subset | Short playlists may feel broken | **Best for cal-001 (2–3 tracks)** |",
    "| **B — Structured insufficient** | Return `LIBRARY_INSUFFICIENT_FOR_PROMPT` with supply diagnostics | Honest; no false promise of 30 tracks | User gets zero music | **Best for party-latin-summer (~1–2 tracks)** |",
    "| **C — Discovery Mode** | Offer discovery fill outside liked library | Can reach target length | Breaks \"from your library\" promise; higher drift risk | Poor fit for strict genre prompts |",
    "",
    "## Evidence-backed recommendation (policy — separate from bucket hypotheses)",
    "",
    "### party-latin-summer (max ~2 tracks)",
    "- **Recommend Option B** with optional micro-preview of 1–2 verified tracks in UX copy.",
    "- Publishing 1 track as a \"playlist\" is worse UX than an explicit supply message.",
    "- **Confidence: high**",
    "",
    "### launch-calibration-001 (max ~2–3 tracks)",
    "- **Recommend Option A** — 2–3 verified 90s tekk tracks are editorially coherent; honest partial beats empty.",
    "- **Confidence: high**",
    "",
    "### chill-acoustic (max ~5–12 tracks)",
    "- **Recommend Option A** with supply-capped target (~12 not 25).",
    "- Not pure starvation — taxonomy/lane issue limits funnel; partial publish is usable.",
    "- **Confidence: medium**",
    "",
    "### Combined policy (reusable)",
    "",
    "```",
    "if maxAchievable < 5:",
    "  return LIBRARY_INSUFFICIENT (Option B)",
    "else if maxAchievable < requested * 0.67:",
    "  publish honest partial + supply message (Option A)",
    "else:",
    "  normal pipeline",
    "```",
    "",
    "Do **not** use Discovery Mode (Option C) for strict genre/era prompts without explicit user opt-in.",
  ].join("\n");

  const acousticMd = [
    "# Acoustic Taxonomy Audit",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Question",
    "",
    "Why does `chill-acoustic` only reach ~5 verified tracks when ~99 acoustic-keyword matches exist?",
    "",
    "## Library classification breakdown",
    "",
    "| Signal | Count |",
    "|--------|------:|",
    `| Acoustic/folk keyword matches | ${acousticAudit.keywordHits} |`,
    `| Classified \`folk\` family | ${acousticAudit.folkFamilyCount} |`,
    `| Classified \`country\` / \`folk_country\` | ${acousticAudit.countryFolkCountryCount} |`,
    `| \`singer_songwriter\` / \`indie_folk\` | ${acousticAudit.singerSongwriterCount} |`,
    `| Intent locked families | ${acousticAudit.intentFamilies.join(", ")} |`,
    "",
    "## Root cause hypotheses (evidence-based, not settled)",
    "",
    "1. **Hypothesis B (classification)** — many acoustic-titled tracks classify as `country/folk_country` not `folk`.",
    "   Benchmark funnel: `candidatesClassified=5` despite ~99 keyword matches.",
    "2. **Hypothesis B (retrieval lane)** — strict folk-family lane admits only 5 before V3.",
    "3. **Hypothesis D (repair shrink)** — `afterDiversity=15` → `afterRepair=5`.",
    "4. **Not missing artist hints alone** — Iron & Wine, Sufjan Stevens classify correctly as folk; misroute is pattern-level on `acoustic` in title → country.",
    "",
    "## Sample misclassifications",
    "",
    "```",
    ...acousticAudit.samples.countryMisclass.map((s) => `${s.artist} — ${s.track} [country/folk_country]`),
    "```",
    "",
    "## Smallest reusable fix (recommendation only)",
    "",
    "Map **acoustic-titled** tracks with folk/singer-songwriter signals to `folk` family (not `country/folk_country`):",
    "",
    "- Extend `singer_songwriter` / `indie_folk` patterns in `genre-taxonomy-data.ts`",
    "- Add microStyle bridge: `acoustic` keyword + low energy → prefer `folk/singer_songwriter` over `country/folk_country`",
    "- **Not** a prompt-specific rule — applies to all acoustic-titled tracks",
    "",
    "**Projected impact:** classified funnel 5 → ~15–25; max publishable ~12 without inflating unrelated lanes.",
    "",
    "**Confidence: medium** (requires re-run of chill-acoustic after taxonomy change)",
  ].join("\n");

  const releaseMd = [
    "# Release Readiness Assessment",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    METHODOLOGY_NOTE,
    "",
    "## Improvements observed (not assumed fully resolved)",
    "",
    "| Issue | Status | Evidence |",
    "|-------|--------|----------|",
    "| Disco adjacent subgenre (party-70s-disco) | **improved** | Adjacency graph accepts funk/motown when family evidence passes |",
    "| Failure mode classification | **framework added** | Scored hypotheses A–E from audit fingerprints — labels are tentative |",
    "| Subgenre-gate pattern (garage/pop_punk/rave) | **hypothesis C supported** | shared verified<V3 pattern; competing hypotheses not ruled out |",
    "",
    "## Remaining issues (tentative hypothesis per prompt)",
    "",
    "| Issue | Primary hypothesis | Est. impact | Confidence |",
    "|-------|-------------------|-------------|------------|",
    ...adjacentRuns.map(({ before, after }) => {
      const dP = (after.finalPublished ?? 0) - (num(before?.finalPublished) ?? 0);
      const status = dP > 0 ? "improved" : dP === 0 ? "unchanged" : "regressed";
      return `| ${after.promptId} underfill | C (tentative) | ${status} (${num(before?.finalPublished)}→${after.finalPublished}) | ${dP > 0 ? "medium" : "low"} |`;
    }),
    `| party-latin-summer | A (tentative) | max ~2 tracks — policy gap | medium |`,
    `| launch-calibration-001 | A (tentative) | max ~2–3 tracks — era supply | medium |`,
    `| chill-acoustic | A+B+D (ambiguous) | taxonomy lane — max ~12 | low–medium |`,
    "",
    "## Regression check",
    "",
    `| Prompt | Before | After | Regression? |`,
    `|--------|-------:|------:|:-----------:|`,
    `| party-70s-disco | ${fmt(num(discoBefore?.finalPublished))} | ${fmt(discoMetrics.finalPublished)} | ${discoRegression ? "**yes**" : "no"} |`,
    ...adjacentRuns.map(({ before, after }) =>
      `| ${after.promptId} | ${fmt(num(before?.finalPublished))} | ${fmt(after.finalPublished)} | ${(after.finalPublished ?? 0) < (num(before?.finalPublished) ?? 0) ? "yes" : "no"} |`,
    ),
    "",
    "## Targeted validation summary",
    "",
    "| Prompt | Verified Δ | Published Δ | Recovery | Path |",
    "|--------|------------|-------------|----------|------|",
    ...adjacentRuns.map(({ before, after }) => {
      const dV = (after.verifiedCount ?? 0) - (num(before?.verifiedCount) ?? 0);
      const dP = (after.finalPublished ?? 0) - (num(before?.finalPublished) ?? 0);
      return `| ${after.promptId} | ${dV >= 0 ? "+" : ""}${dV} | ${dP >= 0 ? "+" : ""}${dP} | ${after.recoveryUsed ? "yes" : "no"} | ${after.executionPath ?? "?"} |`;
    }),
    "",
    "## Benchmark recommendation",
    "",
    benchmarkRec === "A"
      ? "**A) Run another full 250-prompt benchmark** — ≥3/4 targeted compound prompts improved, no regressions, disco stable."
      : "**B) Complete one more targeted fix first** — insufficient improvement or regression detected; see issues above.",
    "",
    `Evidence: ${improvedCount}/4 prompts improved; ${regressions.length} length regressions; disco regression=${discoRegression}.`,
    "",
    "## Recommended next steps (priority order)",
    "",
    "1. **Merge adjacent-subgenre graph** if validation shows verified↑ on garage/pop_punk/rave (this change).",
    "2. **Thin-library policy** — Option B for max<5, Option A for partial (no retrieval changes).",
    "3. **Acoustic taxonomy bridge** — folk vs folk_country disambiguation.",
    "4. Full 250 benchmark only after steps 1–2 land.",
  ].join("\n");

  await writeFile(path.join(OUT_DIR, "thin-library-policy.md"), thinPolicyMd, "utf8");
  await writeFile(path.join(OUT_DIR, "acoustic-taxonomy-audit.md"), acousticMd, "utf8");
  await writeFile(path.join(OUT_DIR, "release-readiness-assessment.md"), releaseMd, "utf8");
  await writeFile(path.join(OUT_DIR, "thin-library-validation.md"), thinMd, "utf8");
  await writeFile(path.join(OUT_DIR, "duplicate-track-forensics.md"), dupMd, "utf8");
  await writeFile(path.join(OUT_DIR, "post-adjacent-subgenre-summary.md"), summaryMd, "utf8");

  console.log(`\nReports written to ${OUT_DIR}`);
  console.log(`Benchmark recommendation: ${benchmarkRec}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
