/**
 * Retry only cancelled/superseded failures from bench-100 raw-results.
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import signature from "cookie-signature";

const outDir = process.argv[2] ?? "reports/live-spotify-verify/bench-100-test-2";
const baseUrl = (process.argv[3] ?? "http://127.0.0.1:5000").replace(/\/+$/, "");

function loadEnv() {
  const out = {};
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

async function mintCookie() {
  if (existsSync(".tmp-live-auth-cookie.txt")) {
    return readFileSync(".tmp-live-auth-cookie.txt", "utf8").trim();
  }
  const env = loadEnv();
  const c = new pg.Client({ connectionString: env.DATABASE_URL });
  await c.connect();
  const rows = await c.query(
    `select sid, sess from session where sess::text like '%spotifyTokens%' order by expire desc limit 1`
  );
  await c.end();
  const sid = rows.rows[0].sid;
  const cookie = `connect.sid=${encodeURIComponent("s:" + signature.sign(sid, env.SESSION_SECRET))}`;
  writeFileSync(".tmp-live-auth-cookie.txt", cookie);
  return cookie;
}

function normalizeTrack(t, index) {
  const score = typeof t.score === "number" ? t.score : null;
  return {
    index: index + 1,
    trackId: t.trackId ?? t.id ?? null,
    trackName: String(t.trackName ?? t.name ?? "").trim(),
    artistName: String(t.artistName ?? t.artist ?? "").trim(),
    albumName: t.albumName ?? t.album ?? null,
    releaseYear: typeof t.releaseYear === "number" ? t.releaseYear : null,
    genrePrimary: t.genrePrimary ?? null,
    genreFamily: t.genreFamily ?? null,
    genres: Array.isArray(t.genres) ? t.genres : [],
    score,
    confidence: score,
    rediscoveryScore: typeof t.rediscoveryScore === "number" ? t.rediscoveryScore : null,
    energy: typeof t.energy === "number" ? t.energy : null,
    valence: typeof t.valence === "number" ? t.valence : null,
    danceability: typeof t.danceability === "number" ? t.danceability : null,
    tempo: typeof t.tempo === "number" ? t.tempo : null,
    popularity: typeof t.popularity === "number" ? t.popularity : null,
    scoreChannels: t.scoreChannels ?? null,
    scoreBreakdown: t.scoreBreakdown ?? null,
    scoringDebug: t.scoringDebug ?? null,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const cookie = await mintCookie();
  const raw = JSON.parse(await readFile(path.join(outDir, "raw-results.json"), "utf8"));
  const cancelled = raw.results.filter(
    (r) => !r.ok && String(r.error || "").toLowerCase().includes("superseded or cancelled")
  );
  console.log(`[retry] ${cancelled.length} cancelled failures`);
  for (const old of cancelled) {
    console.log(`\nretry ${old.id} — ${old.prompt}`);
    const started = Date.now();
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        vibe: old.prompt,
        mode: old.mode,
        length: old.requestedLength,
        varietyBoost: true,
      }),
      signal: AbortSignal.timeout(180000),
    });
    const data = await res.json().catch(() => ({}));
    const tracks = Array.isArray(data.tracks) ? data.tracks.map(normalizeTrack) : [];
    const ok = res.ok && data.success === true;
    const row = {
      ...old,
      ok,
      status: res.status,
      elapsedMs: Date.now() - started,
      playlistName: data.playlistName ?? data.name ?? null,
      spotifyPlaylistUrl: data.spotifyPlaylistUrl ?? data.spotifyUrl ?? null,
      playlistId: data.playlistId ?? null,
      trackCount: data.trackCount ?? tracks.length,
      error: ok ? null : String(data.message ?? data.error ?? data.supplyMessage ?? res.statusText),
      diagnostics: {
        playlistConfidence: data.playlistConfidence ?? null,
        humanQualityGate: data.humanQualityGate ?? null,
        humanExpectation: data.humanExpectation ?? null,
        supplyMessage: data.supplyMessage ?? null,
        honestPartialPublished: data.honestPartialPublished ?? false,
      },
      tracks,
      avgScore: tracks.length
        ? tracks.reduce((s, t) => s + (t.score ?? 0), 0) / tracks.length
        : null,
      retried: true,
    };
    console.log(ok ? `  OK n=${row.trackCount} ${row.spotifyPlaylistUrl}` : `  FAIL ${row.error}`);
    const idx = raw.results.findIndex((r) => r.id === old.id);
    raw.results[idx] = row;
    raw.updatedAt = new Date().toISOString();
    await writeFile(path.join(outDir, "raw-results.json"), JSON.stringify(raw, null, 2));
    await sleep(8000);
  }
  console.log("[retry] done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
