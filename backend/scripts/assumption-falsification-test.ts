/**
 * Phase 4 — Empirically test whether stated assumptions are false.
 * Diagnosis only. Writes reports/playlist-evaluation/assumption-falsification-results.md
 */
import { existsSync, readFileSync } from "node:fs";
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
import { resolveLiveBenchmarkCredentials } from "../lib/benchmark-env";
import { PLAYLIST_BENCHMARK_PROMPTS } from "../lib/playlist-evaluation/benchmark-prompts";

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

const TARGET_IDS = [
  "party-latin-summer",
  "drive-late-garage",
  "gym-2000s-pop-punk",
  "chill-acoustic",
  "launch-calibration-001",
  "launch-calibration-003",
  "launch-calibration-023",
] as const;

type AssumptionResult = {
  id: string;
  assumption: string;
  falsified: boolean | "inconclusive";
  evidence: string[];
  interpretation: string;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function txt(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

type LiveMetrics = {
  promptId: string;
  requested: number;
  status: number;
  strictValid: number | null;
  genreMatch: number | null;
  v3Out: number | null;
  verified: number | null;
  required: number | null;
  final: number;
  afterDiversity: number | null;
  afterRepair: number | null;
  publishedFromVerifiedV3: boolean;
  publicationAction: string | null;
  adaptivePartialLimit: number | null;
  supplyCapped: boolean | null;
  availableSupply: number | null;
  recoveryTier: string | null;
};

function extractLiveMetrics(promptId: string, response: Record<string, unknown>): LiveMetrics {
  const gd = asRecord(response.generationDiagnostics) ?? {};
  const ret = asRecord(gd.candidateRetrieval) ?? {};
  const orch = asRecord(ret.orchestrator) ?? {};
  const supply = asRecord(orch.validCandidateSupply) ?? {};
  const blend = asRecord(orch.blendedIntentPool) ?? {};
  const lanes = asRecord(blend.lanes) ?? {};
  const sg = asRecord(response.strictGenreEvidence) ?? {};
  const fin = asRecord(response.finalization) ?? {};
  const rec = asRecord(gd.recoveryDiagnostics) ?? {};
  const prompt = PLAYLIST_BENCHMARK_PROMPTS.find((p) => p.id === promptId);

  return {
    promptId,
    requested: prompt?.length ?? 30,
    status: 200,
    strictValid: num(supply.strictValidCount),
    genreMatch: num(lanes.genre_match),
    v3Out: num(gd.candidatesAfterDiversity),
    verified: num(sg.verifiedCount),
    required: num(sg.requiredCount),
    final: num(response.count) ?? 0,
    afterDiversity: num(gd.candidatesAfterDiversity),
    afterRepair: num(gd.candidatesAfterRepair),
    publishedFromVerifiedV3: fin.publishedFromVerifiedV3Output === true,
    publicationAction: txt(fin.genreEvidencePublicationAction),
    adaptivePartialLimit: num(fin.adaptivePartialPublishLimit),
    supplyCapped: sg.supplyCapped === true,
    availableSupply: num(sg.availableVerifiedSupply),
    recoveryTier: txt(rec.tier),
  };
}

async function callGenerate(
  baseUrl: string,
  token: string,
  spotifyUserId: string,
  promptId: string,
): Promise<{ status: number; response: Record<string, unknown> }> {
  const prompt = PLAYLIST_BENCHMARK_PROMPTS.find((p) => p.id === promptId);
  if (!prompt) throw new Error(`missing ${promptId}`);
  const res = await fetch(`${baseUrl}/api/generate?audit=1`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-kwalify-evaluation-token": token },
    body: JSON.stringify({
      vibe: prompt.prompt,
      mode: prompt.mode,
      length: prompt.length,
      auditMode: true,
      debug: true,
      debugPipeline: true,
      spotifyUserId,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  return { status: res.status, response: asRecord(await res.json().catch(() => ({}))) ?? {} };
}

async function loadBenchmarkFinal(promptId: string): Promise<number | null> {
  try {
    const raw = await readFile(BENCHMARK_JSONL, "utf8");
    for (const line of raw.trim().split("\n")) {
      const row = JSON.parse(line) as Record<string, unknown>;
      const bench = asRecord(row.benchmark);
      if (bench?.id !== promptId) continue;
      const resp = asRecord(row.response) ?? {};
      return num(resp.count) ?? null;
    }
  } catch {
    /* offline */
  }
  return null;
}

async function librarySupplyForPrompt(
  vibe: string,
  classMap: Map<string, ReturnType<typeof classifyTrack>>,
  rows: Array<{ track_id: string; artist_name: string; track_name: string; release_year: number | null }>,
): Promise<{ subgenreMatch: number; eraMatch: number; maxAchievable: number }> {
  const intent = buildLockedIntent(vibe);
  const families = intent.genreFamilies;
  const era = intent.eraRange;
  const subTerms = [intent.primarySubgenre, ...intent.subgenreTerms].filter(Boolean).map((s) => String(s).toLowerCase());

  let strictFamily = 0;
  let subgenreMatch = 0;
  let eraMatch = 0;

  for (const row of rows) {
    const c = classMap.get(row.track_id) ?? classifyTrack({
      trackName: row.track_name,
      artistName: row.artist_name,
      albumName: "",
    });
    const family = c.genreFamily.toLowerCase();
    const terms = [c.genreFamily, c.genrePrimary, c.primarySubgenre, c.secondarySubgenre, ...c.subGenres].join(" ").toLowerCase();
    const familyHit = families.length === 0 || families.some((f) => family === f || terms.includes(f));
    if (!familyHit) continue;
    strictFamily += 1;
    const subHit = subTerms.length === 0 || subTerms.some((t) => terms.includes(t.replace(/_/g, " ")) || terms.includes(t));
    if (subHit) subgenreMatch += 1;
    const year = row.release_year;
    const eraHit = !era || (year != null && year >= era.start && year <= era.end);
    if (eraHit) eraMatch += 1;
  }

  const maxAchievable = subTerms.length > 0
    ? Math.min(strictFamily, Math.max(subgenreMatch, strictFamily))
    : strictFamily;

  return {
    subgenreMatch,
    eraMatch,
    maxAchievable: era ? Math.min(maxAchievable, eraMatch) : maxAchievable,
  };
}

async function ensureApi(baseUrl: string): Promise<void> {
  for (const path of ["/api/healthz", "/healthz", "/api/health"]) {
    try {
      const res = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) return;
    } catch {
      /* try next */
    }
  }
  throw new Error(`API not reachable at ${baseUrl}. Start with: powershell -File scripts/start-api.ps1`);
}

function buildTests(
  live: Map<string, LiveMetrics>,
  supply: Map<string, { subgenreMatch: number; eraMatch: number; maxAchievable: number }>,
  benchmark: Map<string, number | null>,
): AssumptionResult[] {
  const results: AssumptionResult[] = [];

  // A1: All compound prompts share one Bucket C pattern (like disco)
  const garage = live.get("drive-late-garage")!;
  const popPunk = live.get("gym-2000s-pop-punk")!;
  const rave003 = live.get("launch-calibration-003")!;
  const garageSupply = supply.get("drive-late-garage")!;
  const popSupply = supply.get("gym-2000s-pop-punk")!;
  const samePattern = (
    garage.final <= garageSupply.subgenreMatch + 2
    && popPunk.final >= popSupply.subgenreMatch * 0.3
    && popSupply.maxAchievable > 100
  );
  results.push({
    id: "A1",
    assumption: "Garage, pop-punk, and rave share one fixable Bucket C pattern like disco",
    falsified: samePattern,
    evidence: [
      `garage final=${garage.final} vs subgenreSupply=${garageSupply.subgenreMatch}`,
      `pop-punk final=${popPunk.final} vs subgenreSupply=${popSupply.subgenreMatch}, maxAchievable=${popSupply.maxAchievable}`,
      `rave-003 final=${rave003.final} verified=${rave003.verified}`,
    ],
    interpretation: samePattern
      ? "FALSIFIED — garage/rave hit subgenre ceilings while pop-punk has abundant supply; not one failure class."
      : "Not falsified — patterns may still be similar enough to treat as one class.",
  });

  // A2: Adjacency alone unlocks published length (garage final > subgenre ceiling on live)
  results.push({
    id: "A2",
    assumption: "Subgenre adjacency alone is sufficient to raise published length above strict subgenre ceiling",
    falsified: garage.final > garageSupply.subgenreMatch + 1,
    evidence: [
      `garage live final=${garage.final}, library subgenreMatch=${garageSupply.subgenreMatch}`,
      `publishedFromVerifiedV3=${garage.publishedFromVerifiedV3}, action=${garage.publicationAction ?? "n/a"}`,
      `adaptivePartialLimit=${garage.adaptivePartialLimit ?? "n/a"}`,
    ],
    interpretation: garage.final > garageSupply.subgenreMatch + 1
      ? "FALSIFIED — published length exceeds strict subgenre count; repair/publication policy not adjacency alone explains gain."
      : "Not falsified on garage — final still at/below subgenre ceiling.",
  });

  // A3: Benchmark JSONL matches live (repair stack stale assumption)
  const stalePrompts: string[] = [];
  for (const id of TARGET_IDS) {
    const b = benchmark.get(id);
    const l = live.get(id)?.final;
    if (b != null && l != null && Math.abs(b - l) >= 3) stalePrompts.push(`${id}: bench=${b} live=${l}`);
  }
  results.push({
    id: "A3",
    assumption: "Overnight benchmark JSONL reflects current pipeline delivery",
    falsified: stalePrompts.length >= 2,
    evidence: stalePrompts.length ? stalePrompts : ["All prompts within ±2 tracks of benchmark"],
    interpretation: stalePrompts.length >= 2
      ? "FALSIFIED — live delivery diverges from overnight benchmark on multiple prompts."
      : stalePrompts.length === 1
        ? "Partially falsified — one prompt diverges."
        : "Not falsified — benchmark still matches live within tolerance.",
  });

  // A4: drive-late-garage binding constraint is subgenre gate only (not ceiling)
  results.push({
    id: "A4",
    assumption: "drive-late-garage underfill is purely genre-evidence gate rejection (hypothesis C only)",
    falsified: garage.final > (garage.verified ?? 0) || garage.final > garageSupply.subgenreMatch,
    evidence: [
      `V3=${garage.v3Out} verified=${garage.verified} final=${garage.final}`,
      `subgenreSupply=${garageSupply.subgenreMatch}`,
      `afterRepair=${garage.afterRepair}`,
      `publication=${garage.publicationAction ?? "n/a"}`,
    ],
    interpretation: garage.final > garageSupply.subgenreMatch
      ? "FALSIFIED — final exceeds strict subgenre library count; gate-only diagnosis is incomplete."
      : garage.final > (garage.verified ?? 0)
        ? "FALSIFIED — publishes more than verified count via policy path."
        : "Not falsified — verified count still exceeds final; gate may still bind.",
  });

  // A5: chill-acoustic is library starvation (A)
  const acoustic = live.get("chill-acoustic")!;
  const acousticSupply = supply.get("chill-acoustic")!;
  results.push({
    id: "A5",
    assumption: "chill-acoustic failure is genuine library starvation (hypothesis A)",
    falsified: acousticSupply.maxAchievable >= 50 && (acoustic.verified ?? 0) >= 10,
    evidence: [
      `maxAchievable=${acousticSupply.maxAchievable}`,
      `verified=${acoustic.verified} final=${acoustic.final}`,
      `afterDiversity=${acoustic.afterDiversity} afterRepair=${acoustic.afterRepair}`,
    ],
    interpretation: acousticSupply.maxAchievable >= 50 && (acoustic.verified ?? 0) >= 10
      ? "FALSIFIED — library has headroom; funnel/taxonomy/repair binds not starvation."
      : "Not falsified — thin effective supply remains plausible.",
  });

  // A6: launch-calibration-001 is genre evidence gate (C)
  const cal001 = live.get("launch-calibration-001")!;
  const cal001Supply = supply.get("launch-calibration-001")!;
  results.push({
    id: "A6",
    assumption: "launch-calibration-001 underfill is primarily genre evidence gate (hypothesis C)",
    falsified: (cal001.verified ?? 0) >= 10 && cal001.final <= 5,
    evidence: [
      `verified=${cal001.verified} final=${cal001.final}`,
      `eraMatch supply=${cal001Supply.eraMatch} maxAchievable=${cal001Supply.maxAchievable}`,
      `afterRepair=${cal001.afterRepair}`,
    ],
    interpretation: (cal001.verified ?? 0) >= 10 && cal001.final <= 5
      ? "FALSIFIED — many tracks verify but few publish; era supply + publication policy not pure gate."
      : "Not falsified — gate may still be primary binder.",
  });

  // A7: genre_match=null implies lane starvation
  const nullLaneHighStrict = [...live.values()].filter(
    (m) => m.genreMatch == null && (m.strictValid ?? 0) >= 40,
  );
  results.push({
    id: "A7",
    assumption: "genre_match=null means retrieval lane is starved",
    falsified: nullLaneHighStrict.length >= 2,
    evidence: nullLaneHighStrict.map((m) => `${m.promptId}: genre_match=null strictValid=${m.strictValid} final=${m.final}`),
    interpretation: nullLaneHighStrict.length >= 2
      ? "FALSIFIED — multiple prompts have healthy strictValid with null genre_match telemetry."
      : "Not falsified — insufficient counterexamples.",
  });

  // A8: Repair stage always equals final published
  const repairBinds = [...live.values()].filter(
    (m) => m.afterRepair != null && m.final === m.afterRepair,
  );
  const repairNotBinds = [...live.values()].filter(
    (m) => m.afterRepair != null && Math.abs(m.final - m.afterRepair) > 1,
  );
  results.push({
    id: "A8",
    assumption: "Repair stage always equals final published count (hypothesis D always binds)",
    falsified: repairNotBinds.length >= 2,
    evidence: [
      `repair=final on ${repairBinds.length}/${live.size} prompts`,
      ...repairNotBinds.map((m) => `${m.promptId}: afterRepair=${m.afterRepair} final=${m.final}`),
    ],
    interpretation: repairNotBinds.length >= 2
      ? "FALSIFIED — publication policy can publish beyond repair pool on multiple prompts."
      : `Not falsified — repair=final on ${repairBinds.length}/${live.size} prompts; D still plausible binder.`,
  });

  // A9: party-latin-summer has no pipeline path to ≥5 tracks
  const latin = live.get("party-latin-summer")!;
  const latinSupply = supply.get("party-latin-summer")!;
  results.push({
    id: "A9",
    assumption: "party-latin-summer cannot reach ≥5 tracks from current library via any pipeline fix",
    falsified: latin.final >= 5 || latinSupply.maxAchievable >= 5,
    evidence: [
      `live final=${latin.final}`,
      `library maxAchievable=${latinSupply.maxAchievable} subgenre=${latinSupply.subgenreMatch}`,
      `strictValid=${latin.strictValid} verified=${latin.verified}`,
    ],
    interpretation: latin.final >= 5 || latinSupply.maxAchievable >= 5
      ? "FALSIFIED — ≥5 tracks achievable; thin-supply absolute claim was wrong."
      : "Not falsified — supply ceiling below 5 holds; policy/UX is correct fix.",
  });

  // A10: Pop-punk still underfilled post-repair
  results.push({
    id: "A10",
    assumption: "gym-2000s-pop-punk remains materially underfilled after repair stack",
    falsified: popPunk.final >= popPunk.requested * 0.9,
    evidence: [
      `live final=${popPunk.final} requested=${popPunk.requested}`,
      `verified=${popPunk.verified}/${popPunk.required}`,
      `publishedFromVerifiedV3=${popPunk.publishedFromVerifiedV3}`,
    ],
    interpretation: popPunk.final >= popPunk.requested * 0.9
      ? "FALSIFIED — pop-punk reaches target length live; overnight underfill is stale."
      : "Not falsified — still under target on live run.",
  });

  return results;
}

function buildReport(
  results: AssumptionResult[],
  live: Map<string, LiveMetrics>,
  supply: Map<string, { subgenreMatch: number; eraMatch: number; maxAchievable: number }>,
): string {
  const falsified = results.filter((r) => r.falsified === true);
  const upheld = results.filter((r) => r.falsified === false);
  const inconclusive = results.filter((r) => r.falsified === "inconclusive");

  return [
    "# Assumption Falsification Results",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "Each assumption is tested against **live API + library supply scan**. `FALSIFIED` means counter-evidence disproves the assumption as stated.",
    "",
    "## Summary",
    "",
    `| Outcome | Count |`,
    `|---------|------:|`,
    `| Falsified | ${falsified.length} |`,
    `| Not falsified (holds for now) | ${upheld.length} |`,
    `| Inconclusive | ${inconclusive.length} |`,
    "",
    "## Results",
    "",
    "| ID | Falsified? | Assumption |",
    "|----|:----------:|------------|",
    ...results.map((r) => `| ${r.id} | ${r.falsified === true ? "**yes**" : r.falsified === false ? "no" : "?"} | ${r.assumption} |`),
    "",
    ...results.flatMap((r) => [
      `### ${r.id}: ${r.assumption}`,
      "",
      `**Falsified:** ${r.falsified === true ? "yes" : r.falsified === false ? "no" : "inconclusive"}`,
      "",
      ...r.evidence.map((e) => `- ${e}`),
      "",
      r.interpretation,
      "",
    ]),
    "## Live metrics snapshot",
    "",
    "| Prompt | requested | strictValid | verified | final | subgenre supply | publishedFromV3 |",
    "|--------|----------:|------------:|---------:|------:|----------------:|:---------------:|",
    ...[...live.values()].map((m) => {
      const s = supply.get(m.promptId);
      return `| ${m.promptId} | ${m.requested} | ${m.strictValid ?? "—"} | ${m.verified ?? "—"} | ${m.final} | ${s?.subgenreMatch ?? "—"} | ${m.publishedFromVerifiedV3 ? "yes" : "no"} |`;
    }),
  ].join("\n");
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const creds = resolveLiveBenchmarkCredentials({
    strict: true,
    cli: { baseUrl: "http://localhost:5000" },
    defaultBaseUrl: "http://localhost:5000",
  });
  await ensureApi(creds.baseUrl);

  const env = readFileSync(path.join(ROOT, ".env"), "utf8");
  const dbMatch = env.match(/^DATABASE_URL=(.+)$/m);
  if (!dbMatch) throw new Error("DATABASE_URL missing");
  const pool = initPool(dbMatch[1].trim().replace(/^"|"$/g, ""));
  initDb(pool);
  await runDbInit(pool);
  markBootComplete();
  const { db } = await import("../db/index.js");

  const rawRows = await db.select().from(likedSongsTable).where(eq(likedSongsTable.spotifyUserId, creds.spotifyUserId));
  const { valid: rows } = sanitizeLikedSongs(rawRows);
  const profile = buildUserGenreProfile(rows);
  const classMap = profile.trackClassifications;
  const supplyRows = rows.map((r) => ({
    track_id: r.trackId,
    artist_name: r.artistName,
    track_name: r.trackName,
    release_year: r.releaseYear ?? null,
  }));

  const live = new Map<string, LiveMetrics>();
  const supply = new Map<string, { subgenreMatch: number; eraMatch: number; maxAchievable: number }>();
  const benchmark = new Map<string, number | null>();

  for (const id of TARGET_IDS) {
    process.stderr.write(`[assumption-test] live ${id}\n`);
    const { status, response } = await callGenerate(creds.baseUrl, creds.token, creds.spotifyUserId, id);
    if (status !== 200) throw new Error(`${id} HTTP ${status}`);
    live.set(id, extractLiveMetrics(id, response));
    const prompt = PLAYLIST_BENCHMARK_PROMPTS.find((p) => p.id === id)!;
    supply.set(id, await librarySupplyForPrompt(prompt.prompt, classMap, supplyRows));
    benchmark.set(id, await loadBenchmarkFinal(id));
  }

  const results = buildTests(live, supply, benchmark);
  const md = buildReport(results, live, supply);
  await writeFile(path.join(OUT_DIR, "assumption-falsification-results.md"), md, "utf8");
  await writeFile(
    path.join(OUT_DIR, "assumption-falsification-results.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), results, live: [...live.values()], supply: Object.fromEntries(supply) }, null, 2),
    "utf8",
  );

  const falsified = results.filter((r) => r.falsified === true).length;
  process.stdout.write(`[assumption-test] ${falsified}/${results.length} assumptions falsified → ${OUT_DIR}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
