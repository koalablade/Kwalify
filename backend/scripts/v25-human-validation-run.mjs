#!/usr/bin/env node
/**
 * V25 Human Validation — generate playlists on the user's Spotify account.
 *
 * Usage:
 *   node backend/scripts/v25-human-validation-run.mjs [--resume] [--fresh]
 *
 * Requires session cookie (COOKIE_VALUE / PLAYLIST_BENCHMARK_AUTH_COOKIE in .env,
 * .tmp-live-auth-cookie.txt, or auto-mint from DATABASE_URL + SESSION_SECRET).
 *
 * Audit-only (no Spotify create): add --audit
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import pg from "pg";
import signature from "cookie-signature";
import { readLocalDotEnvValue } from "../dist/lib/benchmark-env-dotenv.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const OUT_DIR = resolve(ROOT, "reports/playlist-evaluation/v25-human-validation");
const OUT_JSON = resolve(OUT_DIR, "playlists.json");
const OUT_LOG = resolve(OUT_DIR, "run.log");
const COOKIE_CACHE = resolve(ROOT, ".tmp-live-auth-cookie.txt");

const PROMPT_TIMEOUT_MS = 10 * 60 * 1000;
const DELAY_MS = 3000;

const PLAYLISTS = [
  { id: "V25-01", name: "Hard techno gym", prompt: "Hard techno gym" },
  { id: "V25-02", name: "Late night UK garage drive", prompt: "Late night UK garage drive" },
  { id: "V25-03", name: "2000s pop punk gym workout", prompt: "2000s pop punk gym workout" },
  { id: "V25-04", name: "Pop punk road trip, no Blink-182", prompt: "Pop punk road trip, no Blink-182" },
  { id: "V25-05", name: "Rainy motorway night drive", prompt: "Rainy motorway night drive" },
  { id: "V25-06", name: "Dad rock BBQ", prompt: "Dad rock BBQ" },
  { id: "V25-07", name: "Sunset beach reggae", prompt: "Sunset beach reggae" },
  { id: "V25-08", name: "Sad party bangers", prompt: "Sad party bangers" },
  { id: "V25-09", name: "Sunday afternoon gardening", prompt: "Sunday afternoon gardening, sunny and laid-back" },
  { id: "V25-10", name: "Brain fog morning reset", prompt: "Brain fog morning reset — gentle but not boring" },
];

function log(line) {
  const msg = `[${new Date().toISOString()}] ${line}`;
  console.log(msg);
  mkdirSync(OUT_DIR, { recursive: true });
  appendFileSync(OUT_LOG, msg + "\n", "utf8");
}

function getHeadCommit() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8", cwd: ROOT }).trim();
  } catch {
    return "unknown";
  }
}

function loadEnvValue(key) {
  return process.env[key]?.trim()?.replace(/^["']|["']$/g, "") || readLocalDotEnvValue(key) || null;
}

async function mintCookieFromDb() {
  const secret = loadEnvValue("SESSION_SECRET");
  const databaseUrl = loadEnvValue("DATABASE_URL");
  if (!secret || !databaseUrl) {
    throw new Error("SESSION_SECRET and DATABASE_URL required to mint session cookie");
  }
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const rows = await client.query(
    `select sid, sess from session
     where sess::text like '%spotifyTokens%'
     order by expire desc nulls last
     limit 1`,
  );
  await client.end();
  if (!rows.rows.length) throw new Error("No session with Spotify tokens in DB");
  const sid = rows.rows[0].sid;
  const sess = typeof rows.rows[0].sess === "string" ? JSON.parse(rows.rows[0].sess) : rows.rows[0].sess;
  const cookie = `connect.sid=${encodeURIComponent(`s:${signature.sign(sid, secret)}`)}`;
  writeFileSync(COOKIE_CACHE, cookie, "utf8");
  return { cookie, spotifyUserId: sess.spotifyUserId ?? null };
}

async function resolveAuthCookie({ forceRemint = false } = {}) {
  if (!forceRemint) {
    let raw =
      process.env.PLAYLIST_BENCHMARK_AUTH_COOKIE?.trim() ||
      process.env.PLAYLIST_EVAL_AUTH_COOKIE?.trim() ||
      process.env.SMOKE_AUTH_COOKIE?.trim() ||
      loadEnvValue("PLAYLIST_BENCHMARK_AUTH_COOKIE") ||
      loadEnvValue("PLAYLIST_EVAL_AUTH_COOKIE") ||
      loadEnvValue("COOKIE_VALUE");
    if (!raw && existsSync(COOKIE_CACHE)) {
      raw = readFileSync(COOKIE_CACHE, "utf8").trim();
    }
    if (raw) {
      const cookie = raw.includes("=") ? raw : `connect.sid=${raw}`;
      return { cookie, spotifyUserId: null, source: "env_or_cache" };
    }
  }
  const minted = await mintCookieFromDb();
  return { ...minted, source: "db_mint" };
}

async function verifyAuth(baseUrl, authCookie) {
  const meRes = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: authCookie } });
  const me = await meRes.json().catch(() => ({}));
  return { ok: meRes.ok, status: meRes.status, me };
}

function normalizeTracks(data) {
  const raw = data.tracks ?? data.playlist ?? data.tracklist ?? [];
  return raw.map((t) => ({
    artistName: t.artistName ?? t.artist ?? "?",
    trackName: t.trackName ?? t.name ?? "?",
    spotifyTrackId: t.spotifyTrackId ?? t.id ?? null,
  }));
}

async function generateSpotify(authCookie, baseUrl, pl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROMPT_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: authCookie,
      },
      body: JSON.stringify({
        vibe: pl.prompt,
        mode: "balanced",
        length: 25,
        varietyBoost: true,
      }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { httpStatus: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function generateAudit(creds, pl, requestId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROMPT_TIMEOUT_MS);
  try {
    const res = await fetch(`${creds.baseUrl}/api/generate?audit=1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-kwalify-evaluation-token": creds.token,
      },
      body: JSON.stringify({
        vibe: pl.prompt,
        mode: "balanced",
        length: 25,
        varietyBoost: true,
        auditMode: true,
        spotifyUserId: creds.spotifyUserId,
        requestId,
      }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { httpStatus: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const resume = process.argv.includes("--resume");
  const fresh = process.argv.includes("--fresh");
  const auditOnly = process.argv.includes("--audit");
  const baseUrl = loadEnvValue("KWALIFY_BENCHMARK_BASE_URL") || "http://127.0.0.1:5000";
  mkdirSync(OUT_DIR, { recursive: true });

  let existing = { playlists: [] };
  if (resume && !fresh && existsSync(OUT_JSON)) {
    existing = JSON.parse(readFileSync(OUT_JSON, "utf8"));
    log(`Resuming — ${existing.playlists?.length ?? 0} playlists done`);
  }

  const doneIds = new Set(
    fresh ? [] : (existing.playlists ?? []).filter((p) => p.spotifyPlaylistUrl).map((p) => p.id),
  );
  const playlists = fresh ? [] : [...(existing.playlists ?? [])];
  const blockers = fresh ? [] : [...(existing.blockers ?? [])];

  let authCookie = null;
  let creds = null;
  if (auditOnly) {
    const { resolveLiveBenchmarkCredentials } = await import("../dist/lib/benchmark-env.js");
    creds = await resolveLiveBenchmarkCredentials({ strict: true, defaultBaseUrl: baseUrl });
  } else {
    let auth = await resolveAuthCookie();
    let verified = await verifyAuth(baseUrl, auth.cookie);
    if (!verified.ok) {
      log(`Auth failed (${verified.status}) via ${auth.source} — reminting fresh session`);
      auth = await resolveAuthCookie({ forceRemint: true });
      verified = await verifyAuth(baseUrl, auth.cookie);
    }
    if (!verified.ok) {
      throw new Error(
        `Auth failed (${verified.status}): ${verified.me.error ?? verified.me.message ?? "Not authenticated"}. ` +
          "Log in to Kwalify via Spotify in your browser, or set COOKIE_VALUE / PLAYLIST_BENCHMARK_AUTH_COOKIE in .env.",
      );
    }
    authCookie = auth.cookie;
    log(`Spotify create mode — authed as ${verified.me.id ?? verified.me.spotifyUserId ?? "user"} (${auth.source})`);
  }

  log(`V25 starting commit=${getHeadCommit()} baseUrl=${baseUrl} mode=${auditOnly ? "audit" : "spotify-create"}`);

  for (const pl of PLAYLISTS) {
    if (doneIds.has(pl.id)) {
      log(`Skip ${pl.id} (already on Spotify)`);
      continue;
    }
    log(`Generating ${pl.id}: ${pl.prompt}`);
    const requestId = `v25-${pl.id}-${Date.now()}`;
    try {
      const { httpStatus, data } = auditOnly
        ? await generateAudit(creds, pl, requestId)
        : await generateSpotify(authCookie, baseUrl, pl);

      const spotifyUrl = data.spotifyPlaylistUrl ?? data.playlistUrl ?? null;
      if (httpStatus !== 200 || !data?.success) {
        blockers.push(`${pl.id}: HTTP ${httpStatus} ${data?.error ?? data?.message ?? "unknown"}`);
        log(`FAILED ${pl.id}: ${httpStatus}`);
        continue;
      }
      if (!auditOnly && !spotifyUrl) {
        blockers.push(`${pl.id}: success but no spotifyPlaylistUrl`);
        log(`FAILED ${pl.id}: no Spotify URL`);
        continue;
      }

      const tracks = normalizeTracks(data);
      const row = {
        id: pl.id,
        name: pl.name,
        prompt: pl.prompt,
        trackCount: tracks.length,
        tracks,
        playlistName: data.playlistName ?? null,
        spotifyPlaylistUrl: spotifyUrl,
        requestId,
        generatedAt: new Date().toISOString(),
        mode: auditOnly ? "audit" : "spotify-create",
      };
      const idx = playlists.findIndex((p) => p.id === pl.id);
      if (idx >= 0) playlists[idx] = row;
      else playlists.push(row);
      doneIds.add(pl.id);

      writeFileSync(
        OUT_JSON,
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            commit: getHeadCommit(),
            baseUrl,
            mode: auditOnly ? "audit" : "spotify-create",
            blockers,
            playlists,
          },
          null,
          2,
        ),
        "utf8",
      );
      log(`Done ${pl.id}: ${tracks.length} tracks ${spotifyUrl ?? ""}`);
    } catch (e) {
      blockers.push(`${pl.id}: ${e.message}`);
      log(`ERROR ${pl.id}: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  writeFileSync(
    OUT_JSON,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        commit: getHeadCommit(),
        baseUrl,
        mode: auditOnly ? "audit" : "spotify-create",
        blockers,
        playlists,
      },
      null,
      2,
    ),
    "utf8",
  );
  log(`Complete: ${playlists.filter((p) => p.spotifyPlaylistUrl).length}/${PLAYLISTS.length} on Spotify`);
  if (blockers.length) log(`Blockers: ${blockers.join("; ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
