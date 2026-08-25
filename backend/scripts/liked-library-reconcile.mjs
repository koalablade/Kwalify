#!/usr/bin/env node
/**
 * One-shot liked-library membership reconcile (LIKED_LIBRARY_INTEGRITY_FIX).
 * Calls existing runSync incremental path — does not change scoring.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { readLocalDotEnv } = require("../dist/lib/benchmark-env-dotenv.js");
const { refreshAccessToken } = require("../dist/lib/spotify.js");
const { runSync } = require("../dist/routes/spotify.js");
const { qaLibraryUserId } = require("../dist/lib/human-quality-evaluator/library-snapshot.js");
const { sanitizeLikedSongs } = require("../dist/lib/library-sanitize.js");
const { initPool } = require("../dist/lib/pg-pool.js");
const { initDb } = require("../dist/db/index.js");
const { runDbInit } = require("../dist/lib/db-init.js");
const { markBootComplete } = require("../dist/lib/boot-state.js");

function hydrateEnv() {
  const env = readLocalDotEnv();
  for (const [k, v] of Object.entries(env)) {
    if (!process.env[k] && v) process.env[k] = v;
  }
}

async function countDb(client, userId) {
  const rows = await client.query(
    "SELECT track_id, track_name, artist_name FROM liked_songs WHERE spotify_user_id = $1",
    [userId],
  );
  const sanitized = sanitizeLikedSongs(
    rows.rows.map((r) => ({
      trackId: String(r.track_id ?? ""),
      trackName: String(r.track_name ?? ""),
      artistName: String(r.artist_name ?? ""),
    })),
  );
  const sync = await client.query(
    "SELECT total_tracks, last_synced_at, sync_error FROM sync_status WHERE spotify_user_id = $1",
    [userId],
  );
  return {
    rows: rows.rows.length,
    unique: new Set(rows.rows.map((r) => r.track_id)).size,
    sanitized: sanitized.valid.length,
    dropped: sanitized.dropped,
    sync: sync.rows[0] ?? null,
  };
}

async function main() {
  hydrateEnv();
  const userId = qaLibraryUserId();
  const pool = initPool(process.env.DATABASE_URL);
  initDb(pool);
  await runDbInit(pool);
  markBootComplete();
  const pg = await import("pg");
  const client = new pg.default.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const before = await countDb(client, userId);
    const sess = await client.query(
      `SELECT sess FROM session WHERE expire > NOW() AND sess->>'spotifyUserId' = $1 AND sess->'spotifyTokens' IS NOT NULL ORDER BY expire DESC LIMIT 1`,
      [userId],
    );
    const raw = sess.rows[0]?.sess;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed?.spotifyTokens?.refreshToken) {
      throw new Error("No session Spotify refresh token");
    }
    const tokens = await refreshAccessToken(parsed.spotifyTokens.refreshToken);
    console.log(JSON.stringify({ phase: "before", userId, before }, null, 2));
    await runSync(userId, tokens, { forceFull: false });
    const after = await countDb(client, userId);
    console.log(JSON.stringify({ phase: "after", after, delta: {
      rows: after.rows - before.rows,
      sanitized: after.sanitized - before.sanitized,
    } }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
