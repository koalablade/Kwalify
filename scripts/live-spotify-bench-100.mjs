/**
 * Live 100-prompt Spotify create bench + full track report.
 *
 * Names: `{prefix} · {generated}` (default prefix "test 2").
 * Spotify cannot create folders — drag into a "test 2" folder in Desktop.
 *
 *   $env:PLAYLIST_VERIFY_FOLDER_PREFIX = "test 2"   # must be set on the API process
 *   $env:PLAYLIST_BENCHMARK_AUTH_COOKIE = (Get-Content .tmp-live-auth-cookie.txt -Raw).Trim()
 *   node scripts/live-spotify-bench-100.mjs --base-url http://127.0.0.1:5000 --limit 100
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import pg from "pg";
import signature from "cookie-signature";

const require = createRequire(import.meta.url);
const { PLAYLIST_BENCHMARK_PROMPTS } = require("./../backend/dist/lib/playlist-evaluation/benchmark-prompts.js");

function loadEnv() {
  const out = {};
  if (!existsSync(".env")) return out;
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

async function mintCookieFromDb() {
  const env = loadEnv();
  const secret = env.SESSION_SECRET;
  if (!secret || !env.DATABASE_URL) throw new Error("SESSION_SECRET / DATABASE_URL required to mint cookie");
  const c = new pg.Client({ connectionString: env.DATABASE_URL });
  await c.connect();
  const rows = await c.query(
    `select sid, sess from session
     where sess::text like '%spotifyTokens%'
     order by expire desc nulls last
     limit 1`
  );
  await c.end();
  if (!rows.rows.length) throw new Error("No session with Spotify tokens in DB");
  const sid = rows.rows[0].sid;
  const sess = typeof rows.rows[0].sess === "string" ? JSON.parse(rows.rows[0].sess) : rows.rows[0].sess;
  const cookie = `connect.sid=${encodeURIComponent("s:" + signature.sign(sid, secret))}`;
  writeFileSync(".tmp-live-auth-cookie.txt", cookie, "utf8");
  return { cookie, spotifyUserId: sess.spotifyUserId ?? null };
}

function argValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] ?? null : null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function promptDifficultyRank(prompt) {
  const tags = new Set(prompt.tags ?? []);
  if (tags.has("edge_case") || tags.has("contradictory") || prompt.mode === "chaotic") return 0;
  if (prompt.mode === "strict" || tags.has("genre") || tags.has("era") || tags.has("mixed_emotion")) return 1;
  if (tags.has("scaling") || tags.has("scene")) return 2;
  if (tags.has("low_complexity")) return 4;
  return 3;
}

function selectStratifiedPrompts(all, size) {
  const byCategory = new Map();
  for (const prompt of all) {
    const list = byCategory.get(prompt.category) ?? [];
    list.push(prompt);
    byCategory.set(prompt.category, list);
  }
  for (const list of byCategory.values()) {
    list.sort((a, b) => promptDifficultyRank(a) - promptDifficultyRank(b) || a.id.localeCompare(b.id));
  }
  const categories = [...byCategory.keys()].sort();
  const selected = [];
  const seen = new Set();
  let round = 0;
  while (selected.length < size && round < all.length) {
    let addedThisRound = false;
    for (const category of categories) {
      if (selected.length >= size) break;
      const candidate = byCategory.get(category)?.[round];
      if (!candidate || seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      selected.push(candidate);
      addedThisRound = true;
    }
    if (!addedThisRound) break;
    round += 1;
  }
  for (const prompt of all) {
    if (selected.length >= size) break;
    if (seen.has(prompt.id)) continue;
    seen.add(prompt.id);
    selected.push(prompt);
  }
  return selected.slice(0, size);
}

async function fetchJson(url, init, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  } finally {
    clearTimeout(t);
  }
}

function normalizeTrack(t, index) {
  const score = typeof t.score === "number" ? t.score : null;
  const scoreChannels = t.scoreChannels ?? null;
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
    confidence: typeof t.confidence === "number" ? t.confidence : score,
    rediscoveryScore: typeof t.rediscoveryScore === "number" ? t.rediscoveryScore : null,
    energy: typeof t.energy === "number" ? t.energy : null,
    valence: typeof t.valence === "number" ? t.valence : null,
    danceability: typeof t.danceability === "number" ? t.danceability : null,
    tempo: typeof t.tempo === "number" ? t.tempo : null,
    popularity: typeof t.popularity === "number" ? t.popularity : null,
    scoreChannels,
    scoreBreakdown: t.scoreBreakdown ?? null,
    scoringDebug: t.scoringDebug ?? null,
    reason: t.reason ?? t.matchReason ?? null,
  };
}

function extractDiagnostics(data) {
  return {
    playlistConfidence: data.playlistConfidence ?? null,
    humanQualityGate: data.humanQualityGate ?? null,
    humanExpectation: data.humanExpectation ?? null,
    supplyMessage: data.supplyMessage ?? null,
    honestPartialPublished: data.honestPartialPublished ?? false,
    thinLibraryPolicy: data.thinLibraryPolicy ?? null,
    scene: data.scene ?? data.canonicalScene ?? null,
    intent: data.intent ?? null,
    mode: data.mode ?? null,
  };
}

async function checkpoint(outDir, payload) {
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "raw-results.json"), JSON.stringify(payload, null, 2));
}

async function main() {
  const args = process.argv.slice(2);
  const baseUrl = (argValue(args, "--base-url") ?? "http://127.0.0.1:5000").replace(/\/+$/, "");
  const limit = Number(argValue(args, "--limit") ?? 100);
  const delayMs = Number(argValue(args, "--delay-ms") ?? 8000);
  const timeoutMs = Number(argValue(args, "--timeout-ms") ?? 180000);
  const outDir = argValue(args, "--out") ?? path.join("reports", "live-spotify-verify", "bench-100-test-2");
  const resume = args.includes("--resume");
  const prefixLabel =
    argValue(args, "--prefix") ??
    process.env.PLAYLIST_VERIFY_FOLDER_PREFIX?.trim() ??
    "test 2";
  const idsArg = argValue(args, "--ids");
  const idSet = idsArg
    ? new Set(idsArg.split(",").map((s) => s.trim()).filter(Boolean))
    : null;
  const matchArg = argValue(args, "--match");
  const matchRe = matchArg ? new RegExp(matchArg, "i") : null;

  let authCookie = process.env.PLAYLIST_BENCHMARK_AUTH_COOKIE?.trim() || "";
  if (!authCookie && process.env.COOKIE_VALUE?.trim()) {
    const v = process.env.COOKIE_VALUE.trim();
    authCookie = v.includes("=") ? v : `connect.sid=${v}`;
  }
  if (!authCookie && existsSync(".tmp-live-auth-cookie.txt")) {
    authCookie = readFileSync(".tmp-live-auth-cookie.txt", "utf8").trim();
  }
  if (!authCookie) {
    const minted = await mintCookieFromDb();
    authCookie = minted.cookie;
    console.log(`[bench100] minted cookie for ${minted.spotifyUserId}`);
  }

  let prompts = selectStratifiedPrompts(PLAYLIST_BENCHMARK_PROMPTS, limit);
  if (idSet || matchRe) {
    prompts = PLAYLIST_BENCHMARK_PROMPTS.filter((p) => {
      if (idSet && idSet.has(p.id)) return true;
      if (matchRe && (matchRe.test(p.id) || matchRe.test(p.prompt))) return true;
      return false;
    });
    if (prompts.length === 0) {
      throw new Error(`No prompts matched --ids/--match (ids=${idsArg ?? "—"} match=${matchArg ?? "—"})`);
    }
  }
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "prompts.json"), JSON.stringify(prompts, null, 2));

  console.log(`[bench100] base=${baseUrl} n=${prompts.length} out=${outDir}`);
  const me = await fetchJson(`${baseUrl}/api/auth/me`, { headers: { Cookie: authCookie } }, 30000);
  if (!me.response.ok) throw new Error(`Auth failed ${me.response.status}: ${JSON.stringify(me.data)}`);
  console.log(`[bench100] authed as ${me.data.id ?? me.data.spotifyUserId ?? "user"}`);

  const ready = await fetchJson(`${baseUrl}/api/readyz`, {}, 15000);
  console.log(`[bench100] ready commit=${ready.data?.commit ?? "unknown"}`);

  let results = [];
  if (resume && existsSync(path.join(outDir, "raw-results.json"))) {
    const prev = JSON.parse(await readFile(path.join(outDir, "raw-results.json"), "utf8"));
    results = Array.isArray(prev.results) ? prev.results : [];
    const retryFailed = args.includes("--retry-failed");
    if (retryFailed) {
      const before = results.length;
      results = results.filter((r) => r.ok === true);
      console.log(`[bench100] resume from ${before} existing; retrying ${before - results.length} failures`);
    } else {
      console.log(`[bench100] resume from ${results.length} existing`);
    }
  }
  const doneIds = new Set(results.map((r) => r.id));
  const maxAttempts = Math.max(1, Number(argValue(args, "--retries") ?? 3));

  for (let i = 0; i < prompts.length; i++) {
    const bench = prompts[i];
    if (doneIds.has(bench.id)) continue;
    console.log(`\n[${results.length + 1}/${prompts.length}] ${bench.id} — ${bench.prompt}`);
    const started = Date.now();
    let row = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const { response, data } = await fetchJson(
          `${baseUrl}/api/generate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: authCookie },
            body: JSON.stringify({
              vibe: bench.prompt,
              mode: bench.mode,
              length: bench.length,
              varietyBoost: true,
            }),
          },
          timeoutMs
        );
        const tracks = Array.isArray(data.tracks) ? data.tracks.map(normalizeTrack) : [];
        const ok = response.ok && data.success === true;
        row = {
          id: bench.id,
          category: bench.category,
          prompt: bench.prompt,
          mode: bench.mode,
          requestedLength: bench.length,
          expectedGenres: bench.expectedGenres ?? [],
          expectedEnergy: bench.expectedEnergy ?? null,
          expectedValence: bench.expectedValence ?? null,
          expectedEra: bench.expectedEra ?? null,
          tags: bench.tags ?? [],
          ok,
          status: response.status,
          elapsedMs: Date.now() - started,
          playlistName: data.playlistName ?? data.name ?? null,
          spotifyPlaylistUrl: data.spotifyPlaylistUrl ?? data.spotifyUrl ?? null,
          playlistId: data.playlistId ?? null,
          trackCount: data.trackCount ?? tracks.length,
          error: ok ? null : String(data.message ?? data.error ?? data.supplyMessage ?? response.statusText),
          diagnostics: extractDiagnostics(data),
          tracks,
          avgScore:
            tracks.length > 0
              ? tracks.reduce((s, t) => s + (t.score ?? t.confidence ?? 0), 0) / tracks.length
              : null,
          attempts: attempt,
        };
        const retryable =
          !ok &&
          (response.status === 409 ||
            /superseded|cancelled|fetch failed|aborted|ECONNRESET|ETIMEDOUT/i.test(row.error ?? ""));
        if (ok || !retryable || attempt >= maxAttempts) break;
        console.log(`  retry ${attempt}/${maxAttempts} after ${response.status} ${row.error}`);
        await sleep(Math.min(20000, 4000 * attempt));
      } catch (err) {
        row = {
          id: bench.id,
          category: bench.category,
          prompt: bench.prompt,
          mode: bench.mode,
          requestedLength: bench.length,
          expectedGenres: bench.expectedGenres ?? [],
          expectedEnergy: bench.expectedEnergy ?? null,
          expectedValence: bench.expectedValence ?? null,
          expectedEra: bench.expectedEra ?? null,
          tags: bench.tags ?? [],
          ok: false,
          status: 0,
          elapsedMs: Date.now() - started,
          playlistName: null,
          spotifyPlaylistUrl: null,
          playlistId: null,
          trackCount: 0,
          error: err instanceof Error ? err.message : String(err),
          diagnostics: {},
          tracks: [],
          avgScore: null,
          attempts: attempt,
        };
        if (attempt >= maxAttempts) break;
        console.log(`  retry ${attempt}/${maxAttempts} after error ${row.error}`);
        await sleep(Math.min(20000, 4000 * attempt));
      }
    }
    results.push(row);
    console.log(
      row.ok
        ? `  OK n=${row.trackCount} avgScore=${row.avgScore?.toFixed?.(3) ?? "n/a"} name=${row.playlistName}\n  ${row.spotifyPlaylistUrl}`
        : `  FAIL ${row.status} ${row.error}`
    );
    await checkpoint(outDir, {
      baseUrl,
      prefix: prefixLabel,
      startedAt: results[0]?.id ? undefined : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      results,
    });
    if (results.length < prompts.length) await sleep(delayMs);
  }

  await writeFile(
    path.join(outDir, "raw-results.json"),
    JSON.stringify({ baseUrl, prefix: prefixLabel, completedAt: new Date().toISOString(), results }, null, 2)
  );
  console.log(`\n[bench100] done ${results.filter((r) => r.ok).length}/${results.length} → ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
