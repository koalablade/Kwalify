/**
 * Diagnosis-only: explain requiredCount math, rejected tracks, and 25→15 publish path.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveLiveBenchmarkCredentials } from "../lib/benchmark-env";
import { classifyTrack } from "../lib/genre-taxonomy";
import { assessGenreEvidenceTier } from "../lib/genre-evidence-tier";
import { getGenreFamily } from "../core/v3/global-diversity-controller";
import { buildUserGenreProfile } from "../lib/user-genre-profile";
import { STRICT_EXPLICIT_GENRE_EVIDENCE_RATIO } from "../controllers/generation/generation-types";
import { initDb } from "../db";
import { initPool } from "../lib/pg-pool";
import { runDbInit } from "../lib/db-init";
import { markBootComplete } from "../lib/boot-state";
import { readFileSync } from "node:fs";
import { likedSongsTable } from "../db/schema/kwalah";
import { eq } from "drizzle-orm";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const OUT = path.join(ROOT, "reports", "playlist-evaluation", "genre-evidence-guard-forensics.json");

const REJECTED_IDS = [
  "0dMd4rilfd6gPbXaLpNYhu",
  "5lc9L9FeLBwlJPgEbq9uEw",
  "2w7R3CQgvl8PIKJlwtT9Mv",
  "63xdwScd1Ai1GigAwQxE8y",
  "6SMHgPgNkhe9lneNTbgtel",
];

function hasFinalGenreEvidenceLike(
  track: {
    trackId: string;
    trackName: string;
    artistName: string;
    albumName: string;
    spotifyArtistGenres?: unknown;
    albumGenres?: unknown;
  },
  classMap: Map<string, ReturnType<typeof classifyTrack>>,
  expectedFamilies: string[],
): { pass: boolean; tier: string; confidence: number; genreFamily: string; reason: string } {
  const classification = classMap.get(track.trackId) ?? classifyTrack({
    trackName: track.trackName,
    artistName: track.artistName,
    albumName: track.albumName,
    spotifyArtistGenres: track.spotifyArtistGenres,
    albumGenres: track.albumGenres,
  });
  const diagnostics = classification.diagnostics;
  const tier = assessGenreEvidenceTier({
    subgenreMatch: expectedFamilies.includes(classification.genreFamily),
    spotifyArtistGenres: track.spotifyArtistGenres,
    albumGenres: track.albumGenres,
    taxonomyHit: diagnostics?.taxonomyHit === true,
    audioFallbackUsed: diagnostics?.audioFallbackUsed === true,
  });
  const cachedHasExpectedFamily =
    expectedFamilies.includes(classification.genreFamily) &&
    diagnostics?.audioFallbackUsed !== true &&
    diagnostics?.patternMatched !== "spotify_genre_metadata";
  let pass = false;
  let reason = "";
  if (cachedHasExpectedFamily) {
    pass = true;
    reason = "cached expected family with local evidence";
  } else if (tier.tier === "exact_tag" || tier.tier === "artist_genre" || tier.tier === "taxonomy") {
    pass = expectedFamilies.includes(classification.genreFamily);
    reason = pass ? `evidence tier ${tier.tier}` : `tier ${tier.tier} but family ${classification.genreFamily} not in expected`;
  } else if (
    diagnostics?.taxonomyHit === true &&
    diagnostics.audioFallbackUsed !== true &&
    diagnostics.patternMatched !== "spotify_genre_metadata" &&
    (diagnostics.artistHintMatched || diagnostics.patternMatched)
  ) {
    pass = expectedFamilies.includes(classification.genreFamily);
    reason = pass ? "taxonomy hit with artist/pattern" : `taxonomy hit but family ${classification.genreFamily}`;
  } else {
    pass = false;
    reason = `insufficient evidence tier=${tier.tier} family=${classification.genreFamily} audioFallback=${diagnostics?.audioFallbackUsed}`;
  }
  return {
    pass,
    tier: tier.tier,
    confidence: tier.confidence,
    genreFamily: classification.genreFamily,
    reason,
  };
}

function eraInRange(year: number | null | undefined, start: number, end: number): boolean {
  return typeof year === "number" && year >= start && year <= end;
}

async function main(): Promise<void> {
  const env = readFileSync(path.join(ROOT, ".env"), "utf8");
  const dbMatch = env.match(/^DATABASE_URL=(.+)$/m);
  if (!dbMatch) throw new Error("DATABASE_URL missing in .env");
  const connectionString = dbMatch[1].trim().replace(/^"|"$/g, "");
  const pool = initPool(connectionString);
  initDb(pool);
  await runDbInit(pool);
  markBootComplete();
  const { db } = await import("../db/index.js");

  const creds = resolveLiveBenchmarkCredentials({
    strict: true,
    cli: { baseUrl: "http://localhost:5000" },
    defaultBaseUrl: "http://localhost:5000",
  });

  const res = await fetch(`${creds.baseUrl}/api/generate?audit=1`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kwalify-evaluation-token": creds.token,
    },
    body: JSON.stringify({
      vibe: "70s disco party dancefloor",
      mode: "strict",
      length: 30,
      auditMode: true,
      debug: true,
      spotifyUserId: creds.spotifyUserId,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = await res.json() as Record<string, unknown>;
  const strict = body.strictGenreEvidence as Record<string, unknown>;
  const fin = body.finalization as Record<string, unknown>;
  const du = (body.generationDiagnostics as Record<string, unknown>)?.deliveryUnderfillForensics as Record<string, unknown>;

  const rows = await db
    .select()
    .from(likedSongsTable)
    .where(eq(likedSongsTable.spotifyUserId, creds.spotifyUserId));
  const profile = buildUserGenreProfile(rows);
  const classMap = profile.trackClassifications;
  const expectedFamilies = ["soul"];
  const length = 30;
  const evidenceBasisCount = Number(strict?.finalCount ?? 30);
  const partialPlaylistExpected = evidenceBasisCount < Math.ceil(length * 0.9);
  const effectiveRatio = partialPlaylistExpected
    ? Math.min(STRICT_EXPLICIT_GENRE_EVIDENCE_RATIO, 0.65)
    : STRICT_EXPLICIT_GENRE_EVIDENCE_RATIO;
  const requiredCount = Math.min(
    evidenceBasisCount,
    Math.max(
      partialPlaylistExpected ? Math.min(5, evidenceBasisCount) : 1,
      Math.ceil(evidenceBasisCount * effectiveRatio),
    ),
  );

  const rejectedRows: Array<Record<string, unknown>> = [];
  for (const id of REJECTED_IDS) {
    const row = rows.find((r: { trackId: string }) => r.trackId === id);
    if (!row) continue;
    const ev = hasFinalGenreEvidenceLike(row, classMap, expectedFamilies);
    const cls = classMap.get(id) ?? classifyTrack(row);
    rejectedRows.push({
      artist: row.artistName,
      title: row.trackName,
      trackId: id,
      releaseYear: row.releaseYear,
      expectedGenre: "soul",
      actualGenreFamily: ev.genreFamily,
      actualPrimarySubgenre: cls.primarySubgenre,
      normalizedFamily: getGenreFamily(ev.genreFamily),
      genreEvidenceTier: ev.tier,
      genreEvidenceConfidence: ev.confidence,
      passesGenreGuard: ev.pass,
      rejectionReason: ev.reason,
      wouldOneMoreVerifiedSatisfyGuard: ev.pass ? "N/A (already passes)" : "YES if this track counted verified (25→26)",
      era1970s: eraInRange(row.releaseYear, 1970, 1979),
      inExactRecoveryPool: ev.pass && eraInRange(row.releaseYear, 1970, 1979),
      diagnostics: cls.diagnostics,
    });
  }

  // Count library-wide constrained pool sizes (mirror controller filters loosely)
  let genreVerified = 0;
  let genrePlusEraExact = 0;
  for (const row of rows) {
    const ev = hasFinalGenreEvidenceLike(row, classMap, expectedFamilies);
    if (ev.pass) genreVerified += 1;
    if (ev.pass && eraInRange(row.releaseYear, 1970, 1979)) genrePlusEraExact += 1;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    diagnosisOnly: true,
    requiredCountMath: {
      constant: "STRICT_EXPLICIT_GENRE_EVIDENCE_RATIO",
      value: STRICT_EXPLICIT_GENRE_EVIDENCE_RATIO,
      configurable: "backend/controllers/generation/generation-types.ts",
      formula: "requiredCount = min(evidenceBasisCount, max(floor, ceil(evidenceBasisCount * effectiveRatio)))",
      evidenceBasisCount,
      requestedLength: length,
      partialPlaylistExpected,
      effectiveRatio,
      requiredCount,
      verifiedCount: strict?.verifiedCount,
      rejectedCount: strict?.rejectedCount,
      note: "NOT a fixed 26 — it is ceil(currentPlaylistSize * 0.85). At 30 tracks → ceil(25.5)=26.",
    },
    publishPath: {
      trigger: "verifiedCount < requiredCount → publishConstrainedPrefix() runs BEFORE verified-only branch",
      verifiedCount: strict?.verifiedCount,
      requiredCount,
      shortfall: Number(strict?.requiredCount ?? requiredCount) - Number(strict?.verifiedCount ?? 0),
      mergedConstrainedRecoveryPoolSize: fin?.mergedConstrainedRecoveryCount,
      exactConstrainedRecoveryCount: fin?.exactConstrainedRecoveryCount,
      publishedCount: body.count,
      sliceCap: `replacement.slice(0, length) where length=${length} — no hard cap at 15`,
      actualLimit: "mergedConstrainedRecoveryPool only contains 15 tracks passing genre+era+hard constraints",
      whyNot25Published: [
        "Branch at generation.controller.ts:7879 calls publishConstrainedPrefix when verified=25 < required=26",
        "That REPLACES entire 30-track V3 playlist with mergedConstrainedRecoveryPool (15 tracks), not verified.slice(25)",
        "The verified-only branch at :7897 never runs because publishConstrainedPrefix succeeds first",
        "Recovery pool requires genre AND era 1970-1979 AND hard constraints — only 15 library tracks qualify",
        "Many of the 25 genre-verified V3 tracks are likely outside strict 1970-1979 era window",
      ],
      finalizationPartialReason: fin?.explicitConstraintPartialReason,
    },
    librarySupply: {
      totalLiked: rows.length,
      genreVerifiedInLibrary: genreVerified,
      genrePlusEra1970sInLibrary: genrePlusEraExact,
    },
    rejectedTracks: rejectedRows,
    deliveryUnderfillStages: du?.stages ?? null,
  };

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify({
    requiredCount: report.requiredCountMath,
    publishPath: report.publishPath,
    rejected: report.rejectedTracks.map((r) => ({
      artist: r.artist,
      title: r.title,
      tier: r.genreEvidenceTier,
      family: r.actualGenreFamily,
      pass: r.passesGenreGuard,
      reason: r.rejectionReason,
      era70s: r.era1970s,
    })),
    library: report.librarySupply,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
