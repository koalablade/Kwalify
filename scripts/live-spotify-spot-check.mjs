/**
 * Create real Spotify playlists on the authenticated user's account (production).
 * Requires COOKIE_VALUE or PLAYLIST_BENCHMARK_AUTH_COOKIE in env or repo-root .env.
 *
 * Usage:
 *   node scripts/live-spotify-spot-check.mjs
 *   node scripts/live-spotify-spot-check.mjs --limit 5
 */
import { readLocalDotEnvValue } from "../backend/dist/lib/benchmark-env-dotenv.js";
import { resolveVerifiedProductionCredentials } from "../backend/dist/lib/benchmark-env.js";

const PROMPTS = [
  { id: "summer_morning", prompt: "Feel-good summer morning music to hype yourself up for the day, getting ready, and commuting to work." },
  { id: "rainy_walk", prompt: "rainy city morning walk with reflective mood" },
  { id: "sunset_drive", prompt: "driving at sunset with open windows and golden light" },
  { id: "cozy_sunday", prompt: "soft happy Sunday afternoon with light emotional warmth" },
  { id: "gym_boost", prompt: "gym confidence boost high energy workout" },
];

function authCookie() {
  const fromEnv =
    process.env.PLAYLIST_BENCHMARK_AUTH_COOKIE?.trim()
    || process.env.PLAYLIST_EVAL_AUTH_COOKIE?.trim()
    || process.env.SMOKE_AUTH_COOKIE?.trim()
    || readLocalDotEnvValue("PLAYLIST_BENCHMARK_AUTH_COOKIE")
    || readLocalDotEnvValue("PLAYLIST_EVAL_AUTH_COOKIE")
    || readLocalDotEnvValue("COOKIE_VALUE");
  if (!fromEnv) return null;
  if (fromEnv.includes("=")) return fromEnv;
  return `connect.sid=${fromEnv}`;
}

function parseLimit(args) {
  const idx = args.indexOf("--limit");
  if (idx < 0) return 3;
  return Math.max(1, Number(args[idx + 1] ?? 3));
}

async function fetchJson(url, init, timeoutMs = 180_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let data = {};
    try {
      data = text.startsWith("{") ? JSON.parse(text) : { message: text.slice(0, 200) };
    } catch {
      data = { message: text.slice(0, 200) };
    }
    return { response, data };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const cookie = authCookie();
  if (!cookie) {
    console.error("Missing session cookie. Set COOKIE_VALUE or PLAYLIST_BENCHMARK_AUTH_COOKIE in .env or PowerShell.");
    console.error("  DevTools → Application → Cookies → kwalify.net → connect.sid");
    process.exit(2);
  }

  const creds = await resolveVerifiedProductionCredentials({ strict: true });
  const ready = await (await fetch(`${creds.baseUrl}/readyz`)).json();
  const localHead = (await import("node:child_process")).execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const deployed = String(ready.commit ?? "");
  const aligned = deployed.startsWith(localHead.slice(0, 7)) || localHead.startsWith(deployed.slice(0, 7));

  const { response: meRes, data: me } = await fetchJson(`${creds.baseUrl}/api/auth/me`, {
    headers: { Cookie: cookie },
  }, 30_000);
  if (!meRes.ok) {
    throw new Error(`Auth failed (${meRes.status}): ${me.error ?? me.message ?? meRes.statusText}`);
  }

  const limit = parseLimit(process.argv.slice(2));
  const prompts = PROMPTS.slice(0, limit);
  const results = [];

  console.error(`[spot-check] user=${me.id ?? me.spotifyUserId ?? "?"} deploy=${deployed.slice(0, 7)} aligned=${aligned}`);

  for (const item of prompts) {
    console.error(`[spot-check] generating: ${item.id}`);
    const { response, data } = await fetchJson(`${creds.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        vibe: item.prompt,
        mode: "balanced",
        length: 25,
        varietyBoost: true,
      }),
    });
    const tracks = Array.isArray(data.tracks) ? data.tracks : [];
    const url = data.spotifyPlaylistUrl ?? data.playlistUrl ?? null;
    results.push({
      id: item.id,
      ok: response.ok && data.success === true && tracks.length >= 20,
      status: response.status,
      trackCount: tracks.length,
      spotifyPlaylistUrl: url,
      playlistName: data.playlistName ?? null,
      error: data.error ?? data.message ?? null,
      firstThree: tracks.slice(0, 3).map((t) => `${t.artistName ?? "?"} — ${t.trackName ?? "?"}`),
    });
    console.error(`[spot-check] ${item.id}: ${response.status} tracks=${tracks.length} ${url ?? ""}`);
  }

  const summary = {
    deployedCommit: deployed,
    localHead,
    deployAligned: aligned,
    userId: me.id ?? me.spotifyUserId ?? null,
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    withSpotifyUrl: results.filter((r) => r.spotifyPlaylistUrl).length,
    results,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
