import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PROMPTS = [
  { id: "b05", prompt: "rainy city morning walk with reflective mood" },
  { id: "b03", prompt: "cozy optimistic start of the day with soft energy" },
  { id: "b04", prompt: "soft happy Sunday afternoon with light emotional warmth" },
  { id: "v05", prompt: "late night feeling" },
  { id: "v01", prompt: "music for thinking" },
  { id: "b02", prompt: "warm nostalgic feeling that isn't tied to any specific era" },
  { id: "b10", prompt: "calm but emotionally warm day start" },
];

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

function summarize(tracks) {
  const genres = new Map();
  let raveLike = 0;
  for (const t of tracks) {
    const g = t.genreFamily || t.genrePrimary || "?";
    genres.set(g, (genres.get(g) ?? 0) + 1);
    const e = t.energy ?? 0.5;
    const d = t.danceability ?? 0.5;
    if (d > 0.74 && e > 0.60) raveLike++;
  }
  const top = [...genres.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  return { top, raveLike, count: tracks.length };
}

const cfg = await loadEnv();
for (const item of PROMPTS) {
  const res = await fetch(`${cfg.baseUrl}/api/generate?audit=1`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-kwalify-evaluation-token": cfg.token,
    },
    body: JSON.stringify({
      vibe: item.prompt,
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
    genreFamily: t.genreFamily ?? null,
    genrePrimary: t.genrePrimary ?? null,
    energy: t.energy ?? null,
    danceability: t.danceability ?? null,
  }));
  const s = summarize(tracks);
  console.log(`\n=== ${item.id}: ${item.prompt} ===`);
  console.log(`HTTP ${res.status} tracks=${s.count} raveLike=${s.raveLike} genres=${s.top.map(([g, c]) => `${g}:${c}`).join(", ")}`);
  tracks.slice(0, 10).forEach((t) => console.log(`  ${t.trackName} | ${t.artistName}`));
}
