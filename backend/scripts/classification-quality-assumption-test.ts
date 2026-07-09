/**
 * Test: "Classification quality is already sufficient"
 */
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { initPool } from "../lib/pg-pool";
import { initDb } from "../db";
import { runDbInit } from "../lib/db-init";
import { markBootComplete } from "../lib/boot-state";
import { likedSongsTable } from "../db/schema/kwalah";
import { sanitizeLikedSongs } from "../lib/library-sanitize";
import { buildUserGenreProfile } from "../lib/user-genre-profile";
import { classifyTrack } from "../lib/genre-taxonomy";
import { buildLockedIntent } from "../core/v3/intent";
import { resolveLiveBenchmarkCredentials } from "../lib/benchmark-env";
import { PLAYLIST_BENCHMARK_PROMPTS } from "../lib/playlist-evaluation/benchmark-prompts";

const PROMPTS = [
  "party-latin-summer",
  "drive-late-garage",
  "gym-2000s-pop-punk",
  "chill-acoustic",
  "launch-calibration-001",
  "launch-calibration-003",
  "launch-calibration-023",
] as const;

function repoRoot(): string {
  for (const up of [2, 3]) {
    const c = path.resolve(__dirname, ...Array(up).fill(".."));
    if (existsSync(path.join(c, "package.json"))) return c;
  }
  return path.resolve(__dirname, "..", "..", "..");
}

const ROOT = repoRoot();
const OUT_JSON = path.join(ROOT, "reports", "playlist-evaluation", "classification-quality-assumption-test.json");
const OUT_MD = path.join(ROOT, "reports", "playlist-evaluation", "classification-quality-assumption-test.md");

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function txt(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

type SupplyAudit = {
  strictFamily: number;
  subgenreMatch: number;
  eraMatch: number;
  maxAchievable: number;
  nicheFamilyCount: number;
  classificationWouldHelp: boolean;
};

type Verdict = "sufficient" | "insufficient" | "not_binding";

type Row = {
  promptId: string;
  requested: number;
  library: SupplyAudit;
  strictValid: number | null;
  classified: number | null;
  verified: number;
  rejected: number;
  final: number;
  subgenreSurvival: number | null;
  overallSurvival: number | null;
  finalIntentMatch: number;
  deliveryVsLibraryPct: number | null;
  verdict: Verdict;
  notes: string[];
};

function libraryAudit(
  vibe: string,
  classMap: Map<string, ReturnType<typeof classifyTrack>>,
  rows: Array<{ track_id: string; artist_name: string; track_name: string; release_year: number | null }>,
): SupplyAudit {
  const intent = buildLockedIntent(vibe);
  const families = intent.genreFamilies.map((f) => f.toLowerCase());
  const subTerms = [intent.primarySubgenre, ...intent.subgenreTerms].filter(Boolean).map((s) => String(s).toLowerCase());
  const era = intent.eraRange;
  const nicheFamily = families[0] ?? intent.primaryGenre ?? "unknown";

  let strictFamily = 0;
  let subgenreMatch = 0;
  let eraMatch = 0;
  let nicheFamilyCount = 0;

  for (const row of rows) {
    const c = classMap.get(row.track_id) ?? classifyTrack({
      trackName: row.track_name,
      artistName: row.artist_name,
      albumName: "",
    });
    const family = c.genreFamily.toLowerCase();
    const terms = [c.genreFamily, c.genrePrimary, c.primarySubgenre, c.secondarySubgenre, ...c.subGenres]
      .join(" ").toLowerCase();
    if (family === nicheFamily || terms.includes(nicheFamily.replace(/_/g, " "))) nicheFamilyCount++;
    const familyHit = families.length === 0 || families.some((f) => family === f || terms.includes(f.replace(/_/g, " ")));
    if (!familyHit) continue;
    strictFamily++;
    const subHit = subTerms.length === 0 || subTerms.some((t) => terms.includes(t.replace(/_/g, " ")) || terms.includes(t));
    if (subHit) subgenreMatch++;
    const year = row.release_year;
    if (!era || (year != null && year >= era.start && year <= era.end)) eraMatch++;
  }

  const maxAchievable = era
    ? Math.min(subTerms.length > 0 ? Math.max(subgenreMatch, strictFamily) : strictFamily, eraMatch)
    : (subTerms.length > 0 ? Math.max(subgenreMatch, strictFamily) : strictFamily);

  return {
    strictFamily,
    subgenreMatch,
    eraMatch,
    maxAchievable,
    nicheFamilyCount,
    classificationWouldHelp: subgenreMatch < 5 && strictFamily >= 20,
  };
}

function acousticTaxonomyGap(
  classMap: Map<string, ReturnType<typeof classifyTrack>>,
  rows: Array<{ track_id: string; artist_name: string; track_name: string }>,
): { keywordHits: number; folkFamily: number; folkCountry: number; bridgeGap: number } {
  let keywordHits = 0;
  let folkFamily = 0;
  let folkCountry = 0;
  for (const row of rows) {
    const text = `${row.track_name} ${row.artist_name}`.toLowerCase();
    const c = classMap.get(row.track_id) ?? classifyTrack({
      trackName: row.track_name,
      artistName: row.artist_name,
      albumName: "",
    });
    if (text.includes("acoustic") || text.includes("folk") || text.includes("unplugged")) keywordHits++;
    if (c.genreFamily === "folk") folkFamily++;
    if (c.primarySubgenre === "folk_country" || c.genreFamily === "country") folkCountry++;
  }
  return { keywordHits, folkFamily, folkCountry, bridgeGap: Math.max(0, folkCountry + keywordHits - folkFamily * 2) };
}

function finalIntentMatch(
  tracks: Array<Record<string, unknown>>,
  families: string[],
): number {
  if (tracks.length === 0) return 0;
  let hit = 0;
  for (const t of tracks) {
    const blob = [t.genreFamily, t.genrePrimary, t.primarySubgenre, t.trackName, t.artistName]
      .map((x) => `${x ?? ""}`.toLowerCase()).join(" ");
    if (families.some((f) => blob.includes(f.replace(/_/g, " ")) || blob.includes(f))) hit++;
  }
  return hit / tracks.length;
}

function scoreRow(row: Omit<Row, "verdict" | "notes">): { verdict: Verdict; notes: string[] } {
  const notes: string[] = [];

  if (row.final >= row.requested * 0.85 && row.finalIntentMatch >= 0.7) {
    notes.push(`delivered ${row.final}/${row.requested} with ${(row.finalIntentMatch * 100).toFixed(0)}% intent family match`);
    return { verdict: "sufficient", notes };
  }

  if (row.library.classificationWouldHelp) {
    notes.push(
      `library strictFamily=${row.library.strictFamily} but subgenreMatch=${row.library.subgenreMatch}<5 — taxonomy gap likely`,
    );
    return { verdict: "insufficient", notes };
  }

  if (row.library.nicheFamilyCount < 5 && row.library.maxAchievable < row.requested * 0.2) {
    notes.push(`thin library niche count=${row.library.nicheFamilyCount}; classification cannot invent supply`);
    return { verdict: "not_binding", notes };
  }

  if (row.subgenreSurvival != null && row.subgenreSurvival < 0.5 && row.final >= 8) {
    notes.push(`subgenreSurvival=${row.subgenreSurvival.toFixed(2)} on ${row.final}-track playlist`);
    return { verdict: "insufficient", notes };
  }

  if (row.library.subgenreMatch >= 15 && row.final < row.library.subgenreMatch * 0.4 && row.verified >= 10) {
    notes.push(`library subgenre=${row.library.subgenreMatch} but final=${row.final} — binder is funnel/publication not classification`);
    return { verdict: "not_binding", notes };
  }

  if (row.library.strictFamily >= 20 && row.library.subgenreMatch < row.library.strictFamily * 0.15) {
    notes.push(
      `family pool=${row.library.strictFamily} but subgenre=${row.library.subgenreMatch} (${((row.library.subgenreMatch / row.library.strictFamily) * 100).toFixed(0)}%) — subgenre taxonomy under-tags`,
    );
    return { verdict: "insufficient", notes };
  }

  if (row.finalIntentMatch >= 0.6 && row.final >= row.requested * 0.5) {
    notes.push(`acceptable intent match at partial length`);
    return { verdict: "sufficient", notes };
  }

  notes.push(
    `final=${row.final}, library maxAchievable=${row.library.maxAchievable}, verified=${row.verified}, intentMatch=${(row.finalIntentMatch * 100).toFixed(0)}%`,
  );
  return { verdict: row.library.maxAchievable < row.requested * 0.3 ? "not_binding" : "sufficient", notes };
}

async function main(): Promise<void> {
  const creds = resolveLiveBenchmarkCredentials({
    strict: true,
    cli: { baseUrl: "http://localhost:5000" },
    defaultBaseUrl: "http://localhost:5000",
  });

  for (const hp of ["/api/healthz", "/healthz"]) {
    try {
      if ((await fetch(`${creds.baseUrl}${hp}`, { signal: AbortSignal.timeout(5000) })).ok) break;
    } catch {
      if (hp === "/healthz") throw new Error("API not running");
    }
  }

  const env = readFileSync(path.join(ROOT, ".env"), "utf8");
  const dbMatch = env.match(/^DATABASE_URL=(.+)$/m);
  if (!dbMatch) throw new Error("DATABASE_URL missing");
  const pool = initPool(dbMatch[1].trim().replace(/^"|"$/g, ""));
  initDb(pool);
  await runDbInit(pool);
  markBootComplete();
  const { db } = await import("../db/index.js");

  const rawRows = await db.select().from(likedSongsTable).where(eq(likedSongsTable.spotifyUserId, creds.spotifyUserId));
  const { valid: libRows } = sanitizeLikedSongs(rawRows);
  const profile = buildUserGenreProfile(libRows);
  const classMap = profile.trackClassifications;
  const supplyRows = libRows.map((r) => ({
    track_id: r.trackId,
    artist_name: r.artistName,
    track_name: r.trackName,
    release_year: r.releaseYear ?? null,
  }));

  const acousticGap = acousticTaxonomyGap(classMap, supplyRows);
  const rows: Row[] = [];

  for (const id of PROMPTS) {
    const p = PLAYLIST_BENCHMARK_PROMPTS.find((x) => x.id === id)!;
    process.stderr.write(`[classification-test] ${id}\n`);
    const res = await fetch(`${creds.baseUrl}/api/generate?audit=1`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-kwalify-evaluation-token": creds.token },
      body: JSON.stringify({
        vibe: p.prompt,
        mode: p.mode,
        length: p.length,
        auditMode: true,
        debug: true,
        debugPipeline: true,
        spotifyUserId: creds.spotifyUserId,
      }),
      signal: AbortSignal.timeout(180_000),
    });
    const d = asRecord(await res.json()) ?? {};
    const gd = asRecord(d.generationDiagnostics) ?? {};
    const sg = asRecord(d.strictGenreEvidence) ?? {};
    const ret = asRecord(gd.candidateRetrieval) ?? {};
    const orch = asRecord(ret.orchestrator) ?? {};
    const supplyDiag = asRecord(orch.validCandidateSupply) ?? {};
    const v3 = asRecord(d.v3Diagnostics) ?? {};
    const intentSurvival = asRecord(d.intentSurvival) ?? asRecord(v3.intentSurvival);
    const scores = asRecord(intentSurvival?.scores);
    const tracks = Array.isArray(d.tracks) ? d.tracks as Array<Record<string, unknown>> : [];

    const intent = buildLockedIntent(p.prompt);
    const families = [...new Set([
      ...intent.genreFamilies,
      intent.primaryGenre,
      intent.primarySubgenre,
      ...intent.subgenreTerms,
    ].filter(Boolean).map((x) => String(x).toLowerCase()))];

    const library = libraryAudit(p.prompt, classMap, supplyRows);
    const final = num(d.count) ?? tracks.length;
    const verified = num(sg.verifiedCount) ?? 0;
    const partial: Omit<Row, "verdict" | "notes"> = {
      promptId: id,
      requested: p.length,
      library,
      strictValid: num(supplyDiag.strictValidCount),
      classified: num(gd.candidatesClassified),
      verified,
      rejected: num(sg.rejectedCount) ?? 0,
      final,
      subgenreSurvival: num(scores?.subgenreSurvival),
      overallSurvival: num(scores?.overallIntentSurvival),
      finalIntentMatch: finalIntentMatch(tracks, families),
      deliveryVsLibraryPct: library.subgenreMatch > 0 ? final / library.subgenreMatch : null,
    };
    const scored = scoreRow(partial);
    rows.push({ ...partial, ...scored });
  }

  const insufficient = rows.filter((r) => r.verdict === "insufficient");
  const sufficient = rows.filter((r) => r.verdict === "sufficient");
  const notBinding = rows.filter((r) => r.verdict === "not_binding");

  const falsified = insufficient.length >= 2
    || (insufficient.length >= 1 && acousticGap.bridgeGap >= 30);

  const interpretation = falsified
    ? "FALSIFIED — taxonomy under-tags niche subgenres (folk/latin/pop_punk bridge) while family pools exist; classification upgrades would raise subgenreMatch without retrieval changes."
    : insufficient.length === 1
      ? "PARTIALLY FALSE — one prompt shows taxonomy gap; most compound prompts classify well enough at family level."
      : notBinding.length >= 2
        ? "PARTIALLY TRUE — classification is not the binder on thin-supply prompts; funnel/publication dominates."
        : "HOLDS — library classification supports current delivery on tested compound prompts.";

  const report = {
    generatedAt: new Date().toISOString(),
    assumption: "Classification quality is already sufficient",
    falsified,
    sufficient: sufficient.length,
    insufficient: insufficient.length,
    notBinding: notBinding.length,
    acousticTaxonomy: acousticGap,
    rows,
    interpretation,
  };

  await mkdir(path.dirname(OUT_JSON), { recursive: true });
  await writeFile(OUT_JSON, JSON.stringify(report, null, 2), "utf8");
  await writeFile(OUT_MD, [
    "# Classification Quality Assumption Test",
    "",
    "**Assumption:** Classification quality is already sufficient",
    "",
    `**Falsified:** ${falsified ? "yes" : "no"} (${sufficient.length} sufficient, ${insufficient.length} insufficient, ${notBinding.length} not binding)`,
    "",
    `**Acoustic taxonomy:** keywordHits=${acousticGap.keywordHits}, folk=${acousticGap.folkFamily}, folk_country/country=${acousticGap.folkCountry}, bridgeGap=${acousticGap.bridgeGap}`,
    "",
    "| Prompt | lib subgenre | maxAchiev | strictValid | final | intent match | subgenre surv | verdict |",
    "|--------|-------------:|----------:|------------:|------:|-------------:|--------------:|:-------:|",
    ...rows.map((r) =>
      `| ${r.promptId} | ${r.library.subgenreMatch} | ${r.library.maxAchievable} | ${r.strictValid ?? "—"} | ${r.final} | ${(r.finalIntentMatch * 100).toFixed(0)}% | ${r.subgenreSurvival == null ? "—" : r.subgenreSurvival.toFixed(2)} | ${r.verdict} |`,
    ),
    "",
    ...rows.flatMap((r) => [`### ${r.promptId}`, ...r.notes.map((n) => `- ${n}`), ""]),
    "",
    "## Interpretation",
    "",
    interpretation,
  ].join("\n"), "utf8");

  console.log(JSON.stringify({
    falsified: report.falsified,
    sufficient: report.sufficient,
    insufficient: report.insufficient,
    notBinding: report.notBinding,
    acousticBridgeGap: acousticGap.bridgeGap,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
