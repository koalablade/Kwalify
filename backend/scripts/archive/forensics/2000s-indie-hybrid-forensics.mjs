#!/usr/bin/env node
/**
 * Offline 2000s-indie hybrid-cap forensics (archived one-shot).
 * Observational only — calls real retrieval + capTracksForHybridScoring.
 * Does not change V55 selection semantics.
 *
 *   node backend/scripts/archive/forensics/2000s-indie-hybrid-forensics.mjs
 *
 * Writes:
 *   reports/investigations/2000s-indie-hybrid-forensics.json
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loadQaLibrarySnapshotFromDb } = require("../../dist/lib/human-quality-evaluator/library-snapshot.js");
const { strongRelevantTrackIds } = require("../../dist/lib/human-quality-evaluator/library-opportunity.js");
const { sanitizeLikedSongs } = require("../../dist/lib/library-sanitize.js");
const { buildUserGenreProfile } = require("../../dist/lib/user-genre-profile.js");
const { analyzeVibe, detectVibeKind } = require("../../dist/lib/emotion.js");
const { buildLockedIntent } = require("../../dist/core/v3/intent.js");
const { decodeIntent } = require("../../dist/lib/intent-decoder.js");
const { buildGenreIntelligenceStack } = require("../../dist/lib/genre-intelligence-stack.js");
const { orchestratePlaylistRetrieval } = require("../../dist/lib/playlist-retrieval-orchestrator.js");
const { capTracksForHybridScoring } = require("../../dist/core/scoring-engine/scoring-pool-cap.js");
const { runScoringPipeline } = require("../../dist/core/scoring-engine/index.js");
const {
  numericDistribution,
  intersectIds,
  setDiff,
  countByDropReason,
} = require("../../dist/lib/hybrid-cap-forensics.js");
const { readLocalDotEnv } = require("../../dist/lib/benchmark-env-dotenv.js");

const USER = process.env.SMOKE_SPOTIFY_USER_ID
  ?? process.env.PLAYLIST_EVAL_SPOTIFY_USER_ID
  ?? process.env.SPOTIFY_USER_ID
  ?? "koalablade";

const PROMPTS = ["2000s indie", "indie rock", "90s alternative rock", "melancholic"];

function hydrateEnv() {
  const env = readLocalDotEnv();
  for (const key of Object.keys(env)) {
    if (!process.env[key] && env[key]) process.env[key] = env[key];
  }
}

function boolRate(rows, pred) {
  if (!rows.length) return null;
  return rows.filter(pred).length / rows.length;
}

function summarizeWatch(forensicsTracks, idSet) {
  const rows = forensicsTracks.filter((t) => idSet.has(t.trackId));
  const fits = rows.map((t) => t.fit).filter((v) => typeof v === "number");
  const ranks = rows.map((t) => t.preCapRank).filter((v) => typeof v === "number");
  const emotion = rows.map((t) => t.components?.emotionFit).filter((v) => typeof v === "number");
  const anti = rows.map((t) => t.components?.antiGenrePenalty).filter((v) => typeof v === "number");
  const eraBoost = rows.map((t) => t.components?.eraBoost).filter((v) => typeof v === "number");
  const explicitBoost = rows.map((t) => t.components?.explicitBoost).filter((v) => typeof v === "number");
  return {
    n: rows.length,
    fit: numericDistribution(fits),
    preCapRank: numericDistribution(ranks),
    emotionFit: numericDistribution(emotion),
    antiGenrePenalty: numericDistribution(anti),
    eraBoost: numericDistribution(eraBoost),
    explicitBoost: numericDistribution(explicitBoost),
    matchesExplicitFamilyRate: boolRate(rows, (t) => t.components?.matchesExplicitFamily === true),
    matchesExplicitEraRate: boolRate(rows, (t) => t.components?.matchesExplicitEra === true),
    genreFamilyCounts: countField(rows, (t) => t.components?.genreFamily ?? "null"),
    reserveLaneCounts: countField(rows, (t) => t.reserveLane),
    dropReasonCounts: countByDropReason(rows),
  };
}

function countField(rows, getter) {
  const counts = {};
  for (const row of rows) {
    const key = String(getter(row));
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function topArtists(libraryById, ids, limit = 15) {
  const counts = new Map();
  for (const id of ids) {
    const artist = libraryById.get(id)?.artistName ?? "unknown";
    counts.set(artist, (counts.get(artist) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([artist, n]) => ({ artist, n }));
}

function defaultClusterArtists() {
  return new Set([
    "the 1975",
    "wallows",
    "the jungle giants",
    "phoebe bridgers",
    "bon iver",
    "mitski",
    "clairo",
    "mac demarco",
  ]);
}

async function loadLikedRows() {
  const pg = await import("pg");
  const client = new pg.default.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT track_id AS "trackId", track_name AS "trackName", artist_name AS "artistName",
              album_name AS "albumName", energy, valence, tempo, danceability, acousticness,
              instrumentalness, speechiness, release_year AS "releaseYear",
              spotify_artist_genres AS "spotifyArtistGenres", album_genres AS "albumGenres",
              popularity, added_at AS "addedAt", primary_artist_id AS "primaryArtistId"
       FROM liked_songs WHERE spotify_user_id = $1`,
      [USER],
    );
    return result.rows.map((row) => ({
      ...row,
      addedAt: row.addedAt ? new Date(row.addedAt) : null,
    }));
  } finally {
    await client.end();
  }
}

function retrievalSceneActiveFor(lockedIntent) {
  return (
    !!lockedIntent.activity ||
    (Array.isArray(lockedIntent.mood) && lockedIntent.mood.length > 0) ||
    !!lockedIntent.energy ||
    !!lockedIntent.energyLevel
  );
}

async function probePrompt(prompt, likedValid, classMap, libraryById, A) {
  const emotionProfile = analyzeVibe(prompt);
  const vibeKind = detectVibeKind(prompt, emotionProfile);
  const lockedIntent = buildLockedIntent(prompt);
  const decodedIntent = decodeIntent(prompt);
  const watchIds = new Set(A);
  const sceneActive = retrievalSceneActiveFor(lockedIntent);

  const userGenreProfile = buildUserGenreProfile(likedValid);
  const genreStack = buildGenreIntelligenceStack({
    tracks: likedValid,
    userProfile: userGenreProfile,
    vibe: prompt,
    librarySize: likedValid.length,
  });

  const orchestration = orchestratePlaylistRetrieval({
    tracks: likedValid,
    vibe: prompt,
    intent: lockedIntent,
    emotionProfile,
    classMap,
    requestedLength: 25,
    sceneActive,
    debugRetrieval: true,
    noLibraryMode: false,
  });

  const retrievalIds = orchestration.tracks.map((t) => t.trackId);
  const retrievalSet = new Set(retrievalIds);
  const A_in_retrieval = intersectIds(A, retrievalSet);
  const A_missing_retrieval = setDiff(A, retrievalSet);

  // Cap uses scoring-input size as librarySize in live path.
  const poolCap = capTracksForHybridScoring(orchestration.tracks, {
    emotionProfile,
    vibeKind,
    classifications: classMap,
    librarySize: orchestration.tracks.length,
    vibe: prompt,
    promptWordCount: prompt.trim().split(/\s+/).length,
    seedMs: 1,
    forensicsWatchIds: watchIds,
  });

  const hybridOutIds = poolCap.pool.map((t) => t.trackId);
  const hybridOutSet = new Set(hybridOutIds);
  const A_in_hybrid = intersectIds(A, hybridOutSet);
  const A_missing_hybrid = setDiff(A, hybridOutSet);

  let sortedIds = [];
  let scoringDiagnostics = null;
  let scoringError = null;
  try {
    const scoring = runScoringPipeline({
      tracks: orchestration.tracks,
      vibe: prompt,
      mode: "balanced",
      emotionProfile,
      vibeKind,
      intent: decodedIntent,
      canonical: null,
      prototype: null,
      sonicProfile: null,
      userGenreProfile,
      genreStack,
      playlistLength: 25,
      memoryByTrack: () => 0,
      noveltyByTrack: () => 0,
      postScore: { startMs: 1 },
      forensicsWatchIds: watchIds,
    });
    sortedIds = scoring.sorted.map((t) => t.trackId);
    scoringDiagnostics = scoring.scoringDiagnostics ?? null;
  } catch (err) {
    scoringError = err instanceof Error ? err.message : String(err);
  }

  const sortedSet = new Set(sortedIds);
  const A_in_sorted = intersectIds(A, sortedSet);
  const A_missing_sorted = setDiff(A, sortedSet);

  const forensics = poolCap.forensics;
  const forensicById = new Map((forensics?.tracks ?? []).map((t) => [t.trackId, t]));

  // Stage classification for each of A using earliest removal.
  const stageRows = A.map((trackId) => {
    const meta = libraryById.get(trackId);
    const f = forensicById.get(trackId);
    let dropStage = scoringError ? "scoring_error_unknown_sorted" : "pipeline.sorted";
    let dropReason = scoringError ? "UNKNOWN" : "SURVIVED_TO_SORTED";
    if (!retrievalSet.has(trackId)) {
      dropStage = "retrieveScoringCandidates / orchestratePlaylistRetrieval";
      dropReason = "NOT_IN_RETRIEVAL_OUTPUT";
    } else if (!hybridOutSet.has(trackId)) {
      dropStage = "capTracksForHybridScoring";
      dropReason = f?.dropReason ?? "DROPPED_BY_HYBRID_CAP";
    } else if (!scoringError && !sortedSet.has(trackId)) {
      dropStage = "runScoringPipeline post-cap (hybrid score / post-score)";
      dropReason = "DROPPED_AFTER_HYBRID_CAP_BEFORE_SORTED";
    }
    return {
      trackId,
      trackName: meta?.trackName ?? f?.components?.trackName ?? null,
      artistName: meta?.artistName ?? f?.components?.artistName ?? null,
      releaseYear: meta?.releaseYear ?? f?.components?.releaseYear ?? null,
      genreFamily: f?.components?.genreFamily ?? classMap.get(trackId)?.genreFamily ?? null,
      inLikedSanitized: true,
      inRetrieval: retrievalSet.has(trackId),
      inHybridCapOutput: hybridOutSet.has(trackId),
      inPipelineSorted: scoringError ? null : sortedSet.has(trackId),
      fit: f?.fit ?? null,
      preCapRank: f?.preCapRank ?? null,
      reserveLane: f?.reserveLane ?? null,
      matchesExplicitFamily: f?.components?.matchesExplicitFamily ?? null,
      matchesExplicitEra: f?.components?.matchesExplicitEra ?? null,
      emotionFit: f?.components?.emotionFit ?? null,
      antiGenrePenalty: f?.components?.antiGenrePenalty ?? null,
      eraBoost: f?.components?.eraBoost ?? null,
      explicitBoost: f?.components?.explicitBoost ?? null,
      dropStage,
      dropReason,
    };
  });

  const stageCounts = countField(stageRows, (r) => r.dropReason);
  const survivedSorted = new Set(A_in_sorted);
  const excludedSorted = new Set(A_missing_sorted);
  const defaultArtists = defaultClusterArtists();

  const hybridExcludedButInRetrieval = A_in_retrieval.filter((id) => !hybridOutSet.has(id));

  // Default-cluster competitors in hybrid output (not necessarily in A).
  const defaultClusterInHybrid = poolCap.pool
    .filter((t) => defaultArtists.has(String(t.artistName ?? "").toLowerCase()))
    .map((t) => {
      const f = forensicById.get(t.trackId);
      return {
        trackId: t.trackId,
        trackName: t.trackName,
        artistName: t.artistName,
        releaseYear: t.releaseYear ?? null,
        fit: f?.fit ?? null,
        preCapRank: f?.preCapRank ?? null,
        inA: watchIds.has(t.trackId),
        reserveLane: f?.reserveLane ?? null,
        matchesExplicitFamily: f?.components?.matchesExplicitFamily ?? null,
        matchesExplicitEra: f?.components?.matchesExplicitEra ?? null,
      };
    })
    .sort((a, b) => (b.fit ?? -Infinity) - (a.fit ?? -Infinity))
    .slice(0, 40);

  return {
    prompt,
    lockedIntent: {
      genreFamilies: lockedIntent.genreFamilies ?? [],
      eraRange: lockedIntent.eraRange ?? null,
      activity: lockedIntent.activity ?? null,
      mood: lockedIntent.mood ?? [],
    },
    vibeKind,
    sceneActive,
    A: A.length,
    likedSanitized: likedValid.length,
    retrieval: {
      outputCount: retrievalIds.length,
      strategy: orchestration.diagnostics?.strategy ?? null,
      A_in_retrieval: A_in_retrieval.length,
      A_missing_retrieval: A_missing_retrieval.length,
      applied: orchestration.diagnostics?.retrievalDiagnostics?.applied ?? null,
      pipeline: orchestration.diagnostics?.retrievalDiagnostics?.pipeline ?? null,
      inputCount: orchestration.diagnostics?.retrievalDiagnostics?.inputCount ?? null,
      outputCountDiag: orchestration.diagnostics?.retrievalDiagnostics?.outputCount ?? null,
      cap: orchestration.diagnostics?.retrievalDiagnostics?.cap ?? null,
    },
    hybridCap: {
      originalCount: poolCap.originalCount,
      candidateCount: poolCap.candidateCount,
      outputCount: poolCap.pool.length,
      poolCapped: poolCap.poolCapped,
      intentPreservedCount: poolCap.intentPreservedCount,
      path: forensics?.path ?? null,
      max: forensics?.max ?? null,
      compoundPrompt: forensics?.compoundPrompt ?? null,
      explicitFamilies: forensics?.explicitFamilies ?? [],
      explicitEra: forensics?.explicitEra ?? null,
      A_in_hybrid: A_in_hybrid.length,
      A_missing_hybrid_from_A: A_missing_hybrid.length,
      A_in_retrieval_but_dropped_by_cap: hybridExcludedButInRetrieval.length,
      dropReasonCounts: forensics?.dropReasonCounts ?? {},
    },
    scoringSorted: {
      sortedCount: sortedIds.length,
      hybridPoolSize: scoringDiagnostics?.scoringPool?.hybridPoolSize ?? null,
      A_in_sorted: scoringError ? null : A_in_sorted.length,
      A_missing_sorted: scoringError ? null : A_missing_sorted.length,
      hybridCapForensicsAttached: !!scoringDiagnostics?.scoringPool?.hybridCapForensics,
      scoringError,
    },
    stageDropCounts: stageCounts,
    distributions: {
      A_in_retrieval_then_dropped_by_cap: summarizeWatch(
        forensics?.tracks ?? [],
        new Set(hybridExcludedButInRetrieval),
      ),
      A_survived_hybrid_cap: summarizeWatch(forensics?.tracks ?? [], new Set(A_in_hybrid)),
      A_survived_sorted: summarizeWatch(forensics?.tracks ?? [], survivedSorted),
      A_excluded_from_sorted: summarizeWatch(forensics?.tracks ?? [], excludedSorted),
    },
    artists: {
      A_missing_retrieval_top: topArtists(libraryById, A_missing_retrieval),
      A_dropped_by_cap_top: topArtists(libraryById, hybridExcludedButInRetrieval),
      A_in_sorted_top: topArtists(libraryById, A_in_sorted),
    },
    defaultClusterInHybrid,
    // Keep per-track rows for 2000s only in the outer writer to limit size for controls.
    stageRows: prompt === "2000s indie" ? stageRows : stageRows.filter((r) => r.inPipelineSorted || r.inHybridCapOutput).slice(0, 80),
    samples: {
      missingRetrieval: A_missing_retrieval.slice(0, 25).map((id) => ({
        trackId: id,
        trackName: libraryById.get(id)?.trackName ?? null,
        artistName: libraryById.get(id)?.artistName ?? null,
        releaseYear: libraryById.get(id)?.releaseYear ?? null,
        genreFamily: classMap.get(id)?.genreFamily ?? null,
      })),
      droppedByCap: hybridExcludedButInRetrieval.slice(0, 25).map((id) => {
        const f = forensicById.get(id);
        return {
          trackId: id,
          trackName: libraryById.get(id)?.trackName ?? null,
          artistName: libraryById.get(id)?.artistName ?? null,
          releaseYear: libraryById.get(id)?.releaseYear ?? null,
          fit: f?.fit ?? null,
          preCapRank: f?.preCapRank ?? null,
          matchesExplicitFamily: f?.components?.matchesExplicitFamily ?? null,
          matchesExplicitEra: f?.components?.matchesExplicitEra ?? null,
          genreFamily: f?.components?.genreFamily ?? classMap.get(id)?.genreFamily ?? null,
          antiGenrePenalty: f?.components?.antiGenrePenalty ?? null,
          emotionFit: f?.components?.emotionFit ?? null,
        };
      }),
      survivedSorted: A_in_sorted.slice(0, 40).map((id) => {
        const f = forensicById.get(id);
        return {
          trackId: id,
          trackName: libraryById.get(id)?.trackName ?? null,
          artistName: libraryById.get(id)?.artistName ?? null,
          releaseYear: libraryById.get(id)?.releaseYear ?? null,
          fit: f?.fit ?? null,
          preCapRank: f?.preCapRank ?? null,
          reserveLane: f?.reserveLane ?? null,
          matchesExplicitFamily: f?.components?.matchesExplicitFamily ?? null,
          matchesExplicitEra: f?.components?.matchesExplicitEra ?? null,
        };
      }),
    },
  };
}

async function main() {
  hydrateEnv();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");

  const snapshot = await loadQaLibrarySnapshotFromDb();
  if (!snapshot?.tracks?.length) throw new Error("QA library snapshot empty");

  const likedRows = await loadLikedRows();
  const { valid: likedValid, dropped } = sanitizeLikedSongs(likedRows);
  const genreProfile = buildUserGenreProfile(likedValid);
  const classMap = genreProfile.trackClassifications;
  const libraryById = new Map(likedValid.map((t) => [t.trackId, t]));

  const results = {};
  for (const prompt of PROMPTS) {
    const A = strongRelevantTrackIds(snapshot, prompt);
    console.log(`[forensics] ${prompt}: A=${A.length}, library=${likedValid.length}`);
    results[prompt] = await probePrompt(prompt, likedValid, classMap, libraryById, A);
    const r = results[prompt];
    console.log(
      `  retrieval ${r.retrieval.outputCount} (A∩ret=${r.retrieval.A_in_retrieval})` +
      ` → hybrid ${r.hybridCap.outputCount} (A∩hyb=${r.hybridCap.A_in_hybrid})` +
      ` → sorted ${r.scoringSorted.sortedCount} (A∩sorted=${r.scoringSorted.A_in_sorted})`,
    );
    console.log(`  stage drops: ${JSON.stringify(r.stageDropCounts)}`);
  }

  const out = {
    probedAt: new Date().toISOString(),
    observational: true,
    userId: USER,
    library: {
      dbRows: likedRows.length,
      sanitized: likedValid.length,
      sanitizeDropped: dropped,
      snapshotSize: snapshot.librarySize,
      snapshotSource: snapshot.source ?? null,
    },
    callChain: [
      "liked_songs (DB)",
      "sanitizeLikedSongs",
      "orchestratePlaylistRetrieval → retrieveScoringCandidates",
      "capTracksForHybridScoring",
      "runScoringPipeline → scoreLibraryHybrid → pipeline.sorted",
    ],
    prompts: results,
  };

  const dir = join(process.cwd(), "reports", "investigations");
  await mkdir(dir, { recursive: true });
  const jsonPath = join(dir, "2000s-indie-hybrid-forensics.json");
  await writeFile(jsonPath, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${jsonPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
