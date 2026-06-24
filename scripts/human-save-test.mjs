import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PROMPTS = [
  { id: "summer", prompt: "Feel-good summer morning music to hype yourself up for the day, getting ready, and commuting to work." },
  { id: "b05", prompt: "rainy city morning walk with reflective mood" },
  { id: "b03", prompt: "cozy optimistic start of the day with soft energy" },
  { id: "b04", prompt: "soft happy Sunday afternoon with light emotional warmth" },
  { id: "v05", prompt: "late night feeling" },
  { id: "v01", prompt: "music for thinking" },
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

function textureBucket(t) {
  const a = t.acousticness ?? 0.5;
  const d = t.danceability ?? 0.5;
  if (a >= 0.55) return "acoustic";
  if (d >= 0.65) return "rhythmic";
  if (a <= 0.25 && d <= 0.45) return "dense";
  return "balanced";
}

function quickVerdict(track, promptId) {
  const g = track.genreFamily || track.genrePrimary || "unknown";
  const e = track.energy ?? 0.5;
  const v = track.valence ?? 0.5;
  const tex = textureBucket(track);
  const name = `${track.trackName} | ${track.artistName}`.toLowerCase();

  if (promptId === "summer") {
    if (g === "metal" || name.includes("queens of the stone") || (e > 0.58 && v < 0.48)) return "no";
    if (g === "hip_hop" && v < 0.55) return "no";
    if (name.includes("folk punk") || name.includes("obligatory folk")) return "no";
    if (g === "unknown" && tex === "dense") return "no";
    if (g === "rock" && v < 0.50) return "borderline";
    if (g === "unknown") return "borderline";
    if (["pop", "indie", "electronic"].includes(g) && v >= 0.48 && e >= 0.45) return "yes";
    return "borderline";
  }
  if (promptId === "b05") {
    if (g === "electronic" && e > 0.65) return "no";
    if (g === "hip_hop" && e > 0.55) return "no";
    if (["indie", "folk", "soul", "blues"].includes(g) && e < 0.65) return "yes";
    if (g === "unknown" && e < 0.62) return "borderline";
    return "borderline";
  }
  if (promptId === "b03" || promptId === "b04") {
    if (g === "metal" || (e > 0.62 && v < 0.45)) return "no";
    if (g === "hip_hop") return "no";
    if (g === "country" && promptId === "b03") return "borderline";
    if (["indie", "folk", "pop", "soul"].includes(g) && e < 0.58) return "yes";
    if (g === "unknown" && e < 0.55) return "borderline";
    return "borderline";
  }
  if (promptId === "v05") {
    if (g === "country") return "no";
    if (g === "hip_hop" && e > 0.55) return "borderline";
    if (["indie", "electronic", "ambient"].includes(g) && e < 0.62) return "yes";
    return "borderline";
  }
  if (promptId === "v01") {
    if (g === "metal" || g === "hip_hop") return "no";
    if (g === "country" && e > 0.50) return "no";
    if (["indie", "ambient", "classical", "electronic"].includes(g) && e < 0.58) return "yes";
    return "borderline";
  }
  return "borderline";
}

const cfg = await loadEnv();
const results = [];
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
    genreFamily: t.genreFamily ?? t.genrePrimary ?? "unknown",
    energy: t.energy ?? null,
    valence: t.valence ?? null,
    danceability: t.danceability ?? null,
    acousticness: t.acousticness ?? null,
    verdict: null,
  }));
  for (const t of tracks) t.verdict = quickVerdict(t, item.id);
  const opening5 = tracks.slice(0, 5);
  const counts = { yes: 0, borderline: 0, no: 0, unknown: 0 };
  for (const t of tracks) {
    counts[t.verdict]++;
    if (t.genreFamily === "unknown") counts.unknown++;
  }
  console.log(`\n=== ${item.id} ===`);
  console.log(`HTTP ${res.status} | yes=${counts.yes} borderline=${counts.borderline} no=${counts.no} unknown=${counts.unknown}`);
  console.log("Opening 5:");
  opening5.forEach((t) => console.log(`  [${t.verdict}] ${t.trackName} | ${t.artistName} | ${t.genreFamily}`));
  results.push({ id: item.id, prompt: item.prompt, tracks, counts, opening5 });
}

await mkdir(path.join(ROOT, "reports"), { recursive: true });
await writeFile(
  path.join(ROOT, "reports", "human-save-test.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2),
);
console.log("\nWrote reports/human-save-test.json");
