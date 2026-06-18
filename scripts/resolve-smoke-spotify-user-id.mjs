#!/usr/bin/env node
/**
 * Resolve SMOKE_SPOTIFY_USER_ID for GitHub Actions.
 *
 * Option A — from production (needs PLAYLIST_EVAL_TOKEN on Render + locally):
 *   PLAYLIST_EVAL_TOKEN=... node scripts/resolve-smoke-spotify-user-id.mjs
 *
 * Option B — from DB (local Render DATABASE_URL):
 *   DATABASE_URL=... node scripts/resolve-smoke-spotify-user-id.mjs
 */

const baseUrl = (process.env.SMOKE_BASE_URL ?? process.env.APP_URL ?? "https://kwalify.net").replace(/\/+$/, "");

async function fromProductionApi(token) {
  const response = await fetch(`${baseUrl}/api/eval/admin/smoke-spotify-user-id`, {
    headers: { "x-eval-token": token },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? data.reason ?? `HTTP ${response.status}`);
  }
  return data.recommended ?? data.candidates?.[0]?.spotifyUserId ?? null;
}

async function fromDatabase(url) {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT spotify_user_id FROM sync_status ORDER BY total_tracks DESC NULLS LAST LIMIT 1`,
    );
    return result.rows[0]?.spotify_user_id ?? null;
  } finally {
    await client.end();
  }
}

async function main() {
  const token = process.env.PLAYLIST_EVAL_TOKEN?.trim();
  const databaseUrl = process.env.DATABASE_URL?.trim();

  let spotifyUserId = null;
  let source = null;

  if (token) {
    spotifyUserId = await fromProductionApi(token);
    source = "production-api";
  } else if (databaseUrl) {
    spotifyUserId = await fromDatabase(databaseUrl);
    source = "database";
  } else {
    console.error(`
Could not resolve SMOKE_SPOTIFY_USER_ID automatically.

Quick browser method (while logged into kwalify.net):
  1. Open https://kwalify.net
  2. Press F12 → Console
  3. Run:
     fetch('/api/auth/me').then(r=>r.json()).then(u=>{copy(u.id);console.log('Copied:',u.id)})

Then set GitHub secret:
  gh secret set SMOKE_SPOTIFY_USER_ID

Or re-run with PLAYLIST_EVAL_TOKEN or DATABASE_URL set.
`);
    process.exit(1);
  }

  if (!spotifyUserId) {
    console.error("No synced Spotify users found. Log into kwalify.net with Spotify and sync your library first.");
    process.exit(1);
  }

  process.stdout.write(`${JSON.stringify({ spotifyUserId, source }, null, 2)}\n`);
  process.stdout.write(`\nRun: gh secret set SMOKE_SPOTIFY_USER_ID\n(paste: ${spotifyUserId})\n`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
