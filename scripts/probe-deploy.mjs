import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const env = {};
try {
  const raw = await readFile(path.join(ROOT, ".env"), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
} catch { /* no .env */ }

const token = process.env.PLAYLIST_EVAL_TOKEN || env.PLAYLIST_EVAL_TOKEN;
const baseUrl = process.env.SMOKE_BASE_URL || env.SMOKE_BASE_URL || "https://kwalify.net";

const res = await fetch(`${baseUrl}/api/generate?audit=1`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-kwalify-evaluation-token": token,
  },
  body: JSON.stringify({
    vibe: "music for thinking",
    mode: "balanced",
    length: 25,
    varietyBoost: true,
    auditMode: true,
    spotifyUserId: process.env.SMOKE_SPOTIFY_USER_ID || env.SMOKE_SPOTIFY_USER_ID || "koalablade",
  }),
});
const data = await res.json();
console.log(JSON.stringify({
  status: res.status,
  success: data.success,
  deploymentVersion: data.deploymentVersion ?? data.commitHash ?? null,
  trackCount: (data.tracks || []).length,
  sample: (data.tracks || []).slice(0, 5).map((t) => `${t.trackName} — ${t.artistName}`),
}, null, 2));
