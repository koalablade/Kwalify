import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  auditSavedTracksFetch,
  canReplaceAuthoritativeLikedLibrary,
  expectedSavedTrackPages,
  incrementalSyncRemovesUnlikes,
  isCompleteSavedTracksSummary,
  planLikedLibraryReconcile,
  snapshotAuthority,
  unlikedTracksMustBeRemovedIfCacheClaimsCurrentLikes,
  uniqueIdCountIsAuthoritative,
  threeWayMembershipCounts,
} from "../lib/liked-library-integrity";
import {
  normalizeSpotifyTrackId,
  toSpotifyTrackUri,
  uniqueNormalizedTrackIds,
  uriIntegrityStats,
} from "../lib/spotify-track-identity";
import { sanitizeLikedSongs } from "../lib/library-sanitize";
import { loadQaLibrarySnapshotFromFile, saveQaLibrarySnapshot } from "../lib/human-quality-evaluator/library-snapshot";
import {
  getCachedLikedSongs,
  invalidateLikedSongsCache,
  setCachedLikedSongs,
} from "../lib/liked-songs-cache";

test("Spotify URI is the stable primary identity", () => {
  assert.equal(normalizeSpotifyTrackId("spotify:track:4uLU6hMCjMI75M1A2tKUQC"), "4uLU6hMCjMI75M1A2tKUQC");
  assert.equal(
    normalizeSpotifyTrackId("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc"),
    "4uLU6hMCjMI75M1A2tKUQC",
  );
  assert.equal(normalizeSpotifyTrackId("4uLU6hMCjMI75M1A2tKUQC"), "4uLU6hMCjMI75M1A2tKUQC");
  assert.equal(normalizeSpotifyTrackId("spotify:local:file"), null);
  assert.equal(normalizeSpotifyTrackId(""), null);
  assert.equal(toSpotifyTrackUri("4uLU6hMCjMI75M1A2tKUQC"), "spotify:track:4uLU6hMCjMI75M1A2tKUQC");
  const stats = uriIntegrityStats([
    "spotify:track:4uLU6hMCjMI75M1A2tKUQC",
    "4uLU6hMCjMI75M1A2tKUQC",
    null,
    "not-a-uri",
    "spotify:episode:abc",
  ]);
  assert.equal(stats.uniqueIds, 1);
  assert.equal(stats.duplicateIds, 1);
  assert.equal(stats.missingOrEmpty, 1);
  assert.equal(stats.invalid, 1);
  assert.equal(stats.nonSpotify, 1);
  const ids = uniqueNormalizedTrackIds(["spotify:track:4uLU6hMCjMI75M1A2tKUQC", "4uLU6hMCjMI75M1A2tKUQC"]);
  assert.equal(ids.size, 1);
});

test("sanitizeLikedSongs deduplicates by trackId not title", () => {
  const { valid, dropped } = sanitizeLikedSongs([
    { trackId: "4uLU6hMCjMI75M1A2tKUQC", trackName: "A", artistName: "X" },
    { trackId: "4uLU6hMCjMI75M1A2tKUQC", trackName: "Different title", artistName: "Y" },
    { trackId: "short", trackName: "Bad", artistName: "Z" },
  ]);
  assert.equal(valid.length, 1);
  assert.equal(dropped, 2);
  assert.equal(valid[0]?.trackName, "A");
});

test("pagination must consume every Spotify saved-track page", () => {
  assert.equal(expectedSavedTrackPages(9665, 50), 194);
  const incomplete = auditSavedTracksFetch({
    spotifyTotal: 100,
    pages: [{ offset: 0, limit: 50, total: 100, rawItemCount: 50, next: "x" }],
    localOrNullCount: 0,
    usableTrackCount: 50,
  });
  assert.equal(incomplete.complete, false);
  assert.equal(canReplaceAuthoritativeLikedLibrary(incomplete), false);
  assert.match(incomplete.reason, /stopped early/);

  const complete = auditSavedTracksFetch({
    spotifyTotal: 100,
    pages: [
      { offset: 0, limit: 50, total: 100, rawItemCount: 50, next: "x" },
      { offset: 50, limit: 50, total: 100, rawItemCount: 50, next: null },
    ],
    localOrNullCount: 3,
    usableTrackCount: 97,
  });
  assert.equal(complete.complete, true);
  assert.equal(canReplaceAuthoritativeLikedLibrary(complete), true);
});

test("stopped-early fetches are never complete", () => {
  const stopped = isCompleteSavedTracksSummary({
    spotifyTotal: 9742,
    rawItemCount: 50,
    localOrNullCount: 0,
    usableCount: 50,
    stoppedEarly: true,
  });
  assert.equal(stopped.complete, false);
});

test("a partial Spotify response cannot become an authoritative complete cache", () => {
  const partial = auditSavedTracksFetch({
    spotifyTotal: 9665,
    pages: [{ offset: 0, limit: 50, total: 9665, rawItemCount: 50, next: "x" }],
    localOrNullCount: 0,
    usableTrackCount: 50,
  });
  assert.equal(canReplaceAuthoritativeLikedLibrary(partial), false);
  const summary = isCompleteSavedTracksSummary({
    spotifyTotal: 9665,
    rawItemCount: 50,
    localOrNullCount: 0,
    usableCount: 50,
  });
  assert.equal(summary.complete, false);
});

test("incremental sync reconciles unlikes against a complete Spotify inventory", () => {
  assert.equal(incrementalSyncRemovesUnlikes(), true);
  assert.equal(unlikedTracksMustBeRemovedIfCacheClaimsCurrentLikes(), true);
  const plan = planLikedLibraryReconcile(["old-unlike", "still-liked"], ["still-liked", "new-like"]);
  assert.deepEqual(plan.toDelete, ["old-unlike"]);
  assert.deepEqual(plan.toInsert, ["new-like"]);
});

test("file snapshot cannot claim current library when PostgreSQL is available", () => {
  const blocked = snapshotAuthority({
    dbAvailable: true,
    dbTrackCount: 9658,
    fileTrackCount: 9665,
    fileLoadedAt: "2026-08-17T13:22:28.291Z",
    preferFileIfPresent: true,
  });
  assert.equal(blocked.canClaimCurrentLibrary, false);
  assert.equal(blocked.source, "file_snapshot");

  const dbWins = snapshotAuthority({
    dbAvailable: true,
    dbTrackCount: 9658,
    fileTrackCount: 9665,
    preferFileIfPresent: false,
  });
  assert.equal(dbWins.canClaimCurrentLibrary, true);
  assert.equal(dbWins.source, "postgresql_liked_songs");
});

test("benchmark cannot claim a current library count without identifying its snapshot source", async () => {
  const dir = await mkdtemp(join(tmpdir(), "liked-lib-"));
  const path = join(dir, "library-snapshot.json");
  await saveQaLibrarySnapshot(path, {
    userId: "koalablade",
    loadedAt: "2026-08-17T13:22:28.291Z",
    librarySize: 1,
    tracks: [
      {
        trackId: "4uLU6hMCjMI75M1A2tKUQC",
        trackName: "Never Gonna Give You Up",
        artistName: "Rick Astley",
        albumName: "Whenever You Need Somebody",
        releaseYear: 1987,
        genreFamily: "pop",
        primarySubgenre: "pop",
        subGenres: ["pop"],
      },
    ],
  });
  const raw = JSON.parse(await readFile(path, "utf8"));
  assert.equal(typeof raw.loadedAt, "string");
  assert.equal(typeof raw.librarySize, "number");
  assert.equal(typeof raw.userId, "string");
  const authority = snapshotAuthority({
    dbAvailable: true,
    dbTrackCount: 2,
    fileTrackCount: raw.librarySize,
    fileLoadedAt: raw.loadedAt,
    preferFileIfPresent: true,
  });
  assert.equal(authority.canClaimCurrentLibrary, false);
  assert.equal(authority.source, "file_snapshot");
  const loaded = await loadQaLibrarySnapshotFromFile(path);
  assert.equal(loaded?.librarySize, 1);
  assert.equal(loaded?.loadedAt, "2026-08-17T13:22:28.291Z");
  assert.equal(loaded?.userId, "koalablade");
});

test("three-way membership reports exact set differences", () => {
  const csv = new Set(["a", "b", "c"]);
  const db = new Set(["b", "c", "d"]);
  const spotify = new Set(["c", "d", "e"]);
  const counts = threeWayMembershipCounts(csv, db, spotify);
  assert.equal(counts["111"], 1);
  assert.equal(counts["110"], 1);
  assert.equal(counts["101"], 0);
  assert.equal(counts["011"], 1);
  assert.equal(counts["100"], 1);
  assert.equal(counts["010"], 0);
  assert.equal(counts["001"], 1);
  assert.equal(counts.universe, 5);
});

test("library count is unique Spotify IDs not raw rows", () => {
  assert.equal(uniqueIdCountIsAuthoritative(5, 4, 1), true);
  assert.equal(uniqueIdCountIsAuthoritative(5, 5, 0), true);
  assert.equal(uniqueIdCountIsAuthoritative(5, 5, 1), false);
});

test("blank-name tracks are not treated as missing Spotify IDs", () => {
  const { valid, dropped } = sanitizeLikedSongs([
    { trackId: "4uLU6hMCjMI75M1A2tKUQC", trackName: "", artistName: "X" },
    { trackId: "4uLU6hMCjMI75M1A2tKUQC", trackName: "Named", artistName: "X" },
  ]);
  assert.equal(dropped, 1);
  assert.equal(valid[0]?.trackId, "4uLU6hMCjMI75M1A2tKUQC");
});

test("missing metadata does not silently delete valid Spotify IDs from reconcile", () => {
  const plan = planLikedLibraryReconcile(
    ["blankxxxxxxxx", "unlikedxxxxxxx"],
    ["blankxxxxxxxx", "newlikexxxxxxx"],
  );
  assert.equal(plan.toDelete.includes("blankxxxxxxxx"), false);
  assert.deepEqual(plan.toDelete, ["unlikedxxxxxxx"]);
  assert.deepEqual(plan.toInsert, ["newlikexxxxxxx"]);
});

test("generate cache misses after a newer sync timestamp", () => {
  const userId = "cache-epoch-test-user";
  invalidateLikedSongsCache(userId);
  setCachedLikedSongs(
    userId,
    [{ trackId: "old", trackName: "Old", artistName: "A" } as never],
    1_000,
  );
  assert.equal(getCachedLikedSongs(userId, { minSyncedAtMs: 2_000 }), null);
  setCachedLikedSongs(
    userId,
    [{ trackId: "new", trackName: "New", artistName: "A" } as never],
    3_000,
  );
  const hit = getCachedLikedSongs(userId, { minSyncedAtMs: 2_000 });
  assert.equal(hit?.[0]?.trackId, "new");
  invalidateLikedSongsCache(userId);
});

