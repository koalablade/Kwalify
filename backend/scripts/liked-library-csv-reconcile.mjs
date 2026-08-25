#!/usr/bin/env node
/**
 * Three-way liked-library reconcile: Skiley CSV, PostgreSQL, live Spotify.
 * Does not generate playlists. Does not rewrite the CSV.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { readLocalDotEnv } = require("../dist/lib/benchmark-env-dotenv.js");
const { refreshAccessToken } = require("../dist/lib/spotify.js");
const { qaLibraryUserId } = require("../dist/lib/human-quality-evaluator/library-snapshot.js");
const { sanitizeLikedSongs } = require("../dist/lib/library-sanitize.js");
const { classifyTrack } = require("../dist/lib/genre-taxonomy.js");
const { strongRelevantTrackIds } = require("../dist/lib/human-quality-evaluator/library-opportunity.js");
const { normalizeSpotifyTrackId } = require("../dist/lib/spotify-track-identity.js");
const { threeWayMembershipCounts, setDiffIds } = require("../dist/lib/liked-library-integrity.js");

const CSV_PATH = process.env.KWALIFY_LIKED_CSV
  ?? "C:\\Users\\Kwalah\\Downloads\\Liked Songs - Skiley Export.csv";

function hydrateEnv() {
  const env = readLocalDotEnv();
  for (const [k, v] of Object.entries(env)) {
    if (!process.env[k] && v) process.env[k] = v;
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      if (field.endsWith("\r")) field = field.slice(0, -1);
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function yearFrom(value) {
  const m = String(value ?? "").match(/^(\d{4})/);
  return m ? Number(m[1]) : null;
}

function parseGenres(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  return raw.split(/[|,]/).map((s) => s.trim()).filter(Boolean);
}

async function tokensFromSession(pg, userId) {
  const result = await pg.query(
    `SELECT sess FROM session WHERE expire > NOW() AND sess->>'spotifyUserId' = $1 AND sess->'spotifyTokens' IS NOT NULL ORDER BY expire DESC LIMIT 1`,
    [userId],
  );
  const raw = result.rows[0]?.sess;
  const sess = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!sess?.spotifyTokens?.refreshToken) return null;
  return sess.spotifyTokens;
}

function sampleMeta(ids, lookup, limit = 8) {
  return ids.slice(0, limit).map((id) => {
    const row = lookup.get(id);
    return {
      trackId: id,
      trackName: row?.trackName ?? null,
      artistName: row?.artistName ?? null,
      albumName: row?.albumName ?? null,
      addedAt: row?.addedAt ?? null,
    };
  });
}

async function main() {
  hydrateEnv();
  const st = statSync(CSV_PATH);
  const buf = readFileSync(CSV_PATH);
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const parsed = parseCsv(buf.toString("utf8"));
  const header = parsed[0] ?? [];
  const dataRows = parsed.slice(1).filter((row) => row.some((cell) => String(cell).trim() !== ""));
  const col = Object.fromEntries(header.map((name, i) => [name, i]));
  const uriIdx = col.trackUri ?? col.track_uri ?? col.uri;
  if (uriIdx == null) {
    throw new Error(`No trackUri column in ${header.join(",")}`);
  }

  const csvRawIds = [];
  const csvLookup = new Map();
  let blankIds = 0;
  let malformedIds = 0;
  let blankNames = 0;
  let localRows = 0;
  const isLikedCounts = {};
  const isLocalCounts = {};
  const addedAtValues = [];
  const csvTracksForEval = [];

  for (const row of dataRows) {
    const uri = row[uriIdx];
    const name = String(row[col.trackName] ?? "").trim();
    const artist = String(row[col.artistName] ?? "").trim();
    const album = String(row[col.albumName] ?? "").trim();
    const addedAt = String(row[col.addedAt] ?? "").trim() || null;
    const isLocal = String(row[col.isLocal] ?? "");
    const isLiked = String(row[col.isLikedByUser] ?? "");
    isLikedCounts[isLiked] = (isLikedCounts[isLiked] ?? 0) + 1;
    isLocalCounts[isLocal] = (isLocalCounts[isLocal] ?? 0) + 1;
    if (isLocal && isLocal !== "stream" && isLocal !== "false") localRows += 1;
    if (!name) blankNames += 1;
    if (addedAt) addedAtValues.push(addedAt);
    const id = normalizeSpotifyTrackId(uri);
    if (!String(uri ?? "").trim()) {
      blankIds += 1;
      csvRawIds.push(null);
      continue;
    }
    if (!id) {
      malformedIds += 1;
      csvRawIds.push(String(uri));
      continue;
    }
    csvRawIds.push(id);
    if (!csvLookup.has(id)) {
      csvLookup.set(id, { trackId: id, trackName: name, artistName: artist, albumName: album, addedAt });
      const classification = classifyTrack({
        trackName: name,
        artistName: artist,
        albumName: album,
        spotifyArtistGenres: parseGenres(row[col.artistGenres]),
        albumGenres: [],
        energy: Number.parseFloat(row[col.trackFeatureEnergy]) || null,
        valence: Number.parseFloat(row[col.trackFeatureValence]) || null,
        acousticness: Number.parseFloat(row[col.trackFeatureAcousticness]) || null,
        danceability: Number.parseFloat(row[col.trackFeatureDanceability]) || null,
        instrumentalness: Number.parseFloat(row[col.trackFeatureInstrumentalness]) || null,
        speechiness: Number.parseFloat(row[col.trackFeatureSpeechiness]) || null,
        tempo: Number.parseFloat(row[col.trackFeatureTempo]) || null,
      });
      csvTracksForEval.push({
        trackId: id,
        trackName: name,
        artistName: artist,
        albumName: album,
        releaseYear: yearFrom(row[col.albumReleaseDate]),
        genreFamily: classification.genreFamily,
        primarySubgenre: classification.primarySubgenre,
        subGenres: classification.subGenres,
        energy: Number.parseFloat(row[col.trackFeatureEnergy]) || null,
        valence: Number.parseFloat(row[col.trackFeatureValence]) || null,
        acousticness: Number.parseFloat(row[col.trackFeatureAcousticness]) || null,
        danceability: Number.parseFloat(row[col.trackFeatureDanceability]) || null,
      });
    }
  }

  const csvIds = [...csvLookup.keys()];
  const csvSet = new Set(csvIds);
  const duplicateRows = csvRawIds.filter(Boolean).length - csvSet.size;
  addedAtValues.sort();

  const csvTruth = {
    label: "CSV_TRUTH_SET",
    path: CSV_PATH,
    bytes: st.size,
    mtimeUtc: st.mtime.toISOString(),
    sha256,
    columns: header,
    raw_rows: dataRows.length,
    unique_track_ids: csvSet.size,
    duplicate_rows: duplicateRows,
    blank_ids: blankIds,
    malformed_ids: malformedIds,
    blank_names: blankNames,
    local_or_nonstream_rows: localRows,
    isLikedByUser: isLikedCounts,
    isLocal: isLocalCounts,
    date_range: addedAtValues.length
      ? { earliest: addedAtValues[0], latest: addedAtValues[addedAtValues.length - 1] }
      : null,
    addedBySample: dataRows[0]?.[col.addedBy] ?? null,
  };

  const userId = qaLibraryUserId();
  const pg = await import("pg");
  const client = new pg.default.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let dbSet = new Set();
  const dbLookup = new Map();
  let dbSanitize = null;
  let syncStatus = null;
  const spotifyLookup = new Map();
  let spotifySet = new Set();
  const spotifyAudit = {
    queried: false,
    total: null,
    rawItems: null,
    pages: null,
    localOrNull: null,
    usableUniqueIds: null,
    complete: null,
    meId: null,
    reason: null,
  };

  try {
    const dbRows = await client.query(
      `SELECT track_id, track_name, artist_name, album_name, added_at
       FROM liked_songs WHERE spotify_user_id = $1`,
      [userId],
    );
    for (const row of dbRows.rows) {
      const id = normalizeSpotifyTrackId(row.track_id);
      if (!id) continue;
      dbSet.add(id);
      dbLookup.set(id, {
        trackId: id,
        trackName: row.track_name,
        artistName: row.artist_name,
        albumName: row.album_name,
        addedAt: row.added_at,
      });
    }
    dbSanitize = sanitizeLikedSongs(
      dbRows.rows.map((r) => ({
        trackId: String(r.track_id ?? ""),
        trackName: String(r.track_name ?? ""),
        artistName: String(r.artist_name ?? ""),
      })),
    );
    const sync = await client.query(
      `SELECT total_tracks, last_synced_at, sync_error, updated_at FROM sync_status WHERE spotify_user_id = $1`,
      [userId],
    );
    syncStatus = sync.rows[0] ?? null;

    let tokens = null;
    const refresh = process.env.SPOTIFY_REFRESH_TOKEN;
    if (refresh) {
      try { tokens = await refreshAccessToken(refresh); } catch { tokens = null; }
    }
    if (!tokens) {
      const session = await tokensFromSession(client, userId);
      if (session?.refreshToken) tokens = await refreshAccessToken(session.refreshToken);
    }
    if (!tokens) {
      spotifyAudit.reason = "No Spotify refresh token";
    } else {
      const axios = require("axios");
      const me = await axios.get("https://api.spotify.com/v1/me", {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
        timeout: 20000,
      });
      spotifyAudit.meId = me.data?.id ?? null;
      let offset = 0;
      const limit = 50;
      let total = 0;
      let rawItems = 0;
      let pages = 0;
      let localOrNull = 0;
      do {
        const response = await axios.get("https://api.spotify.com/v1/me/tracks", {
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
          params: { limit, offset, market: "from_token" },
          timeout: 30000,
        });
        const data = response.data;
        total = data.total;
        const items = Array.isArray(data.items) ? data.items : [];
        rawItems += items.length;
        pages += 1;
        for (const item of items) {
          const track = item?.track;
          if (!track || track.is_local || !track.id) {
            localOrNull += 1;
            continue;
          }
          const id = normalizeSpotifyTrackId(track.id);
          if (!id) continue;
          spotifySet.add(id);
          if (!spotifyLookup.has(id)) {
            spotifyLookup.set(id, {
              trackId: id,
              trackName: track.name ?? null,
              artistName: track.artists?.[0]?.name ?? null,
              albumName: track.album?.name ?? null,
              addedAt: item.added_at ?? null,
            });
          }
        }
        offset += limit;
        if (offset < total) await new Promise((r) => setTimeout(r, 100));
      } while (offset < total);
      spotifyAudit.queried = true;
      spotifyAudit.total = total;
      spotifyAudit.rawItems = rawItems;
      spotifyAudit.pages = pages;
      spotifyAudit.localOrNull = localOrNull;
      spotifyAudit.usableUniqueIds = spotifySet.size;
      spotifyAudit.complete = rawItems === total;
    }
  } finally {
    await client.end();
  }

  const csvOnlyVsDb = setDiffIds(csvSet, dbSet);
  const dbOnlyVsCsv = setDiffIds(dbSet, csvSet);
  const csvOnlyVsSpotify = setDiffIds(csvSet, spotifySet);
  const spotifyOnlyVsCsv = setDiffIds(spotifySet, csvSet);
  const dbOnlyVsSpotify = setDiffIds(dbSet, spotifySet);
  const spotifyOnlyVsDb = setDiffIds(spotifySet, dbSet);

  const membership = threeWayMembershipCounts(csvSet, dbSet, spotifySet);

  const csvSnap = {
    userId,
    loadedAt: new Date().toISOString(),
    librarySize: csvTracksForEval.length,
    tracks: csvTracksForEval,
    source: "file_snapshot",
    sourcePath: CSV_PATH,
  };
  const prompts = ["indie rock", "2000s indie", "90s alternative rock", "melancholic"];
  const gold = {};
  for (const prompt of prompts) {
    const ids = strongRelevantTrackIds(csvSnap, prompt);
    gold[prompt] = {
      evaluatorFromCsv: ids.length,
      inSpotify: ids.filter((id) => spotifySet.has(id)).length,
      inDb: ids.filter((id) => dbSet.has(id)).length,
      csvOnly: ids.filter((id) => !dbSet.has(id) || !spotifySet.has(id)).slice(0, 8),
    };
  }

  const outDir = join(process.cwd(), "reports", "investigations");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "csv-truth-set.json"), `${JSON.stringify({
    ...csvTruth,
    uniqueTrackIds: csvIds,
  })}\n`);

  const evidence = {
    probedAt: new Date().toISOString(),
    userId,
    csv: csvTruth,
    db: {
      rowCount: dbSet.size,
      uniqueTrackIds: dbSet.size,
      sanitized: dbSanitize?.valid.length ?? null,
      sanitizedDropped: dbSanitize?.dropped ?? null,
      syncStatus,
    },
    spotify: spotifyAudit,
    diffs: {
      csvVsDb: {
        csvOnly: csvOnlyVsDb.length,
        dbOnly: dbOnlyVsCsv.length,
        intersection: csvSet.size - csvOnlyVsDb.length,
        csvOnlySample: sampleMeta(csvOnlyVsDb, csvLookup),
        dbOnlySample: sampleMeta(dbOnlyVsCsv, dbLookup),
      },
      csvVsSpotify: {
        csvOnly: csvOnlyVsSpotify.length,
        spotifyOnly: spotifyOnlyVsCsv.length,
        intersection: csvSet.size - csvOnlyVsSpotify.length,
        csvOnlySample: sampleMeta(csvOnlyVsSpotify, csvLookup),
        spotifyOnlySample: sampleMeta(spotifyOnlyVsCsv, spotifyLookup),
      },
      dbVsSpotify: {
        dbOnly: dbOnlyVsSpotify.length,
        spotifyOnly: spotifyOnlyVsDb.length,
        intersection: dbSet.size - dbOnlyVsSpotify.length,
        dbOnlySample: sampleMeta(dbOnlyVsSpotify, dbLookup),
        spotifyOnlySample: sampleMeta(spotifyOnlyVsDb, spotifyLookup),
      },
    },
    membership,
    goldTrioFromCsv: gold,
  };
  writeFileSync(join(outDir, "liked-library-provenance.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({
    csv: {
      raw_rows: csvTruth.raw_rows,
      unique_track_ids: csvTruth.unique_track_ids,
      duplicate_rows: csvTruth.duplicate_rows,
      blank_ids: csvTruth.blank_ids,
      malformed_ids: csvTruth.malformed_ids,
      blank_names: csvTruth.blank_names,
      sha256,
      date_range: csvTruth.date_range,
      isLikedByUser: csvTruth.isLikedByUser,
      isLocal: csvTruth.isLocal,
    },
    db: evidence.db,
    spotify: spotifyAudit,
    diffs: {
      csvVsDb: { csvOnly: csvOnlyVsDb.length, dbOnly: dbOnlyVsCsv.length, intersection: evidence.diffs.csvVsDb.intersection },
      csvVsSpotify: { csvOnly: csvOnlyVsSpotify.length, spotifyOnly: spotifyOnlyVsCsv.length, intersection: evidence.diffs.csvVsSpotify.intersection },
      dbVsSpotify: { dbOnly: dbOnlyVsSpotify.length, spotifyOnly: spotifyOnlyVsDb.length, intersection: evidence.diffs.dbVsSpotify.intersection },
    },
    membership,
    goldTrioFromCsv: gold,
    samples: {
      csvOnlyVsDb: evidence.diffs.csvVsDb.csvOnlySample,
      dbOnlyVsCsv: evidence.diffs.csvVsDb.dbOnlySample,
      csvOnlyVsSpotify: evidence.diffs.csvVsSpotify.csvOnlySample,
      spotifyOnlyVsCsv: evidence.diffs.csvVsSpotify.spotifyOnlySample,
      dbOnlyVsSpotify: evidence.diffs.dbVsSpotify.dbOnlySample,
      spotifyOnlyVsDb: evidence.diffs.dbVsSpotify.spotifyOnlySample,
    },
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
