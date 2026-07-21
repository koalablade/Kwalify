/**
 * Live Spotify verify bench — creates real playlists for manual listening.
 *
 * Spotify cannot create folders via API. Playlists are named:
 *   test · <generated name>
 * Create a Spotify folder named "test" and drag these in (Desktop/app).
 *
 * Usage:
 *   $env:PLAYLIST_BENCHMARK_AUTH_COOKIE = (Get-Content .tmp-live-auth-cookie.txt -Raw).Trim()
 *   $env:PLAYLIST_VERIFY_FOLDER_PREFIX = "test"
 *   node scripts/live-spotify-verify-bench.mjs --base-url https://kwalify.net --limit 12
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import dns from "node:dns";
import https from "node:https";

const require = createRequire(import.meta.url);

// Bypass hosts-file override (127.0.0.1 kwalify.net) when targeting real production.
const FORCE_PROD_IP = process.env.KWALIFY_FORCE_PROD_IP?.trim() || "";
if (FORCE_PROD_IP) {
  const orig = dns.lookup.bind(dns);
  dns.lookup = (hostname, options, callback) => {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    if (hostname === "kwalify.net" || hostname === "www.kwalify.net") {
      return callback(null, FORCE_PROD_IP, 4);
    }
    return orig(hostname, options, callback);
  };
}

const PROMPTS = [
  { id: "verify-coding-sprint", prompt: "coding sprint focus", mode: "balanced", length: 25 },
  { id: "verify-ambient-rain", prompt: "ambient rain night", mode: "balanced", length: 25 },
  { id: "verify-gym-cardio", prompt: "gym cardio upbeat", mode: "balanced", length: 25 },
  { id: "verify-disco", prompt: "disco party", mode: "balanced", length: 25 },
  { id: "verify-rain-drive", prompt: "music for driving through rain at night", mode: "balanced", length: 25 },
  { id: "verify-indie-chill", prompt: "indie chill sunday morning", mode: "balanced", length: 25 },
  { id: "verify-angry-rock", prompt: "gym angry rock", mode: "balanced", length: 25 },
  { id: "verify-lofi-study", prompt: "lofi study beats", mode: "balanced", length: 25 },
  { id: "verify-neon-city", prompt: "neon city night drive", mode: "balanced", length: 25 },
  { id: "verify-rave", prompt: "underground rave", mode: "balanced", length: 25 },
  { id: "verify-sad-indie", prompt: "sad indie breakup", mode: "balanced", length: 25 },
  { id: "verify-latin-party", prompt: "latin party dancing", mode: "balanced", length: 25 },
];

function argValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] ?? null : null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeCookie() {
  const full = process.env.PLAYLIST_BENCHMARK_AUTH_COOKIE?.trim();
  if (full) return full;
  const value = process.env.COOKIE_VALUE?.trim();
  if (value) return value.includes("=") ? value : `connect.sid=${value}`;
  return "";
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

async function main() {
  const args = process.argv.slice(2);
  const baseUrl = (argValue(args, "--base-url") ?? process.env.API_BASE_URL ?? "https://kwalify.net").replace(/\/+$/, "");
  const limit = Number(argValue(args, "--limit") ?? PROMPTS.length);
  const delayMs = Number(argValue(args, "--delay-ms") ?? 13000);
  const timeoutMs = Number(argValue(args, "--timeout-ms") ?? 180000);
  const outDir = argValue(args, "--out") ?? path.join("reports", "live-spotify-verify", new Date().toISOString().replace(/[:.]/g, "-"));
  const authCookie = normalizeCookie();
  if (!authCookie) {
    throw new Error("Set PLAYLIST_BENCHMARK_AUTH_COOKIE or COOKIE_VALUE");
  }

  console.log(`[verify] base=${baseUrl} limit=${limit} forceIp=${FORCE_PROD_IP || "none"}`);
  const me = await fetchJson(`${baseUrl}/api/auth/me`, { headers: { Cookie: authCookie } }, 30000);
  if (!me.response.ok) {
    throw new Error(`Auth failed ${me.response.status}: ${JSON.stringify(me.data)}`);
  }
  console.log(`[verify] authed as ${me.data.spotifyUserId ?? me.data.id ?? "user"}`);

  const ready = await fetchJson(`${baseUrl}/api/readyz`, {}, 30000);
  console.log(`[verify] ready commit=${ready.data?.commit ?? "unknown"}`);

  const selected = PROMPTS.slice(0, Math.max(1, limit));
  const results = [];
  for (let i = 0; i < selected.length; i++) {
    const bench = selected[i];
    console.log(`\n[${i + 1}/${selected.length}] ${bench.id} — ${bench.prompt}`);
    const started = Date.now();
    const { response, data } = await fetchJson(
      `${baseUrl}/api/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: authCookie },
        body: JSON.stringify({ vibe: bench.prompt, mode: bench.mode, length: bench.length, varietyBoost: true }),
      },
      timeoutMs
    );
    const tracks = Array.isArray(data.tracks) ? data.tracks : [];
    const row = {
      id: bench.id,
      prompt: bench.prompt,
      ok: response.ok && data.success === true,
      status: response.status,
      elapsedMs: Date.now() - started,
      playlistName: data.playlistName ?? data.name ?? null,
      spotifyPlaylistUrl: data.spotifyPlaylistUrl ?? data.spotifyUrl ?? null,
      playlistId: data.playlistId ?? null,
      trackCount: data.trackCount ?? tracks.length,
      error: response.ok ? data.message ?? null : String(data.message ?? data.error ?? response.statusText),
      tracks: tracks.slice(0, 8).map((t) => ({
        name: t.trackName ?? t.name,
        artist: t.artistName ?? t.artist,
      })),
    };
    results.push(row);
    console.log(
      row.ok
        ? `  OK n=${row.trackCount} name=${row.playlistName}\n  ${row.spotifyPlaylistUrl}`
        : `  FAIL ${row.status} ${row.error}`
    );
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, "results.json"), JSON.stringify({ baseUrl, results }, null, 2));
    if (i < selected.length - 1) await sleep(delayMs);
  }

  const md = [
    "# Live Spotify verify",
    "",
    `Base: ${baseUrl}`,
    `Created: ${new Date().toISOString()}`,
    "",
    "Spotify API cannot place playlists into folders. Names are prefixed `test · …` when `PLAYLIST_VERIFY_FOLDER_PREFIX=test` is set on the server. Create a folder named **test** in Spotify Desktop and drag these playlists in.",
    "",
    "| # | Prompt | Status | Tracks | Playlist |",
    "|---|---|---|---:|---|",
    ...results.map((r, i) => {
      const link = r.spotifyPlaylistUrl ? `[open](${r.spotifyPlaylistUrl})` : "—";
      return `| ${i + 1} | ${r.prompt} | ${r.ok ? "ok" : "fail"} | ${r.trackCount} | ${link} |`;
    }),
    "",
    ...results.flatMap((r) => [
      `## ${r.id}`,
      `- Prompt: ${r.prompt}`,
      `- Name: ${r.playlistName ?? "—"}`,
      `- URL: ${r.spotifyPlaylistUrl ?? "—"}`,
      `- Sample: ${(r.tracks ?? []).map((t) => `${t.name} — ${t.artist}`).join("; ") || "—"}`,
      "",
    ]),
  ].join("\n");
  await writeFile(path.join(outDir, "VERIFY.md"), md);
  console.log(`\n[verify] wrote ${outDir}`);
  console.log(`[verify] pass ${results.filter((r) => r.ok).length}/${results.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
