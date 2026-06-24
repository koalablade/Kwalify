import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PROMPT = process.argv[2] ||
  "Feel-good summer morning music to hype yourself up for the day, getting ready, and commuting to work.";

async function loadEnv() {
  const env = {};
  try {
    const raw = await readFile(path.join(ROOT, ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch { /* no .env */ }
  return {
    baseUrl: process.env.SMOKE_BASE_URL || env.SMOKE_BASE_URL || "https://kwalify.net",
    token: process.env.PLAYLIST_EVAL_TOKEN || env.PLAYLIST_EVAL_TOKEN || "",
    spotifyUserId: process.env.SMOKE_SPOTIFY_USER_ID || env.SMOKE_SPOTIFY_USER_ID || "koalablade",
  };
}

const cfg = await loadEnv();
const res = await fetch(`${cfg.baseUrl}/api/generate?audit=1`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-kwalify-evaluation-token": cfg.token,
  },
  body: JSON.stringify({
    vibe: PROMPT,
    mode: "balanced",
    length: 25,
    varietyBoost: true,
    auditMode: true,
    spotifyUserId: cfg.spotifyUserId,
  }),
});
const data = await res.json();
const tracks = (data.tracks || []).map((t, i) => ({
  position: i + 1,
  trackName: t.trackName || t.name,
  artistName: t.artistName || t.artist,
  genreFamily: t.genreFamily ?? t.genrePrimary ?? "?",
}));
const genres = new Map();
for (const t of tracks) genres.set(t.genreFamily, (genres.get(t.genreFamily) ?? 0) + 1);
console.log(`HTTP ${res.status} tracks=${tracks.length}`);
console.log(`genres: ${[...genres.entries()].sort((a, b) => b[1] - a[1]).map(([g, n]) => `${g}:${n}`).join(", ")}`);
tracks.slice(0, 12).forEach((t) => console.log(`  ${t.trackName} | ${t.artistName} | ${t.genreFamily}`));
