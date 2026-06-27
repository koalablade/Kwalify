/**
 * Collect playlist genome from public Spotify playlists.
 *
 * Requires SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET in .env
 *
 *   node scripts/collect-playlist-genome.mjs
 *   node scripts/collect-playlist-genome.mjs --limit 200 --resume
 */

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";

function loadEnvFile() {
  try {
    const raw = readFileSync(path.resolve(".env"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m && !process.env[m[1].trim()]) {
        process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // optional
  }
}
loadEnvFile();

const OUT = path.resolve("data/corpus/human-playlists.json");
const SEEDS = path.resolve("data/corpus/playlist-genome/seed-playlist-ids.json");
const SPOTIFY_API = "https://api.spotify.com/v1";

/** Public editorial / curated playlists (expand over time). */
const DEFAULT_SEEDS = [
  { id: "37i9dQZF1DXcBWIGoYBM5M", name: "Today's Top Hits" },
  { id: "37i9dQZF1DX0XUsuxWWTQ6", name: "RapCaviar" },
  { id: "37i9dQZF1DX4JAvHpjipBk", name: "New Music Friday" },
  { id: "37i9dQZF1DX4sWSpwq3LiO", name: "Peaceful Piano" },
  { id: "37i9dQZF1DWWEJlAGA9gs0", name: "Deep Focus" },
  { id: "37i9dQZF1DX4WYpdgoIcn6", name: "Chill Hits" },
  { id: "37i9dQZF1DX1tyCD9QhIWF", name: "All Out 2010s" },
  { id: "37i9dQZF1DX5Vy6DFOcx00", name: "All Out 2000s" },
  { id: "37i9dQZF1DX2NcOpBihZS8", name: "All Out 90s" },
  { id: "37i9dQZF1DX0XUsuxWWTQ6", name: "RapCaviar" },
  { id: "37i9dQZF1DXcF6B6QPhFDv", name: "Rock This" },
  { id: "37i9dQZF1DX10zKedJalTt", name: "Viva Latino" },
  { id: "37i9dQZF1DXbSfnOzyXwrh", name: "Mint" },
  { id: "37i9dQZF1DX5Ejj0EkURtP", name: "All Out 80s" },
  { id: "37i9dQZF1DX4JAvHpjipBk", name: "New Music Friday" },
  { id: "37i9dQZF1DX3Ogo29pO0yX", name: "Brown Noise" },
  { id: "37i9dQZF1DX2TRYkJECvfC", name: "Indie Mix" },
  { id: "37i9dQZF1DX0UrRvztWcNU", name: "Hot Country" },
  { id: "37i9dQZF1DX70RN3giFztD", name: "Mood Booster" },
  { id: "37i9dQZF1DX2sUQwD7CbaJ", name: "Feelin' Good" },
  { id: "37i9dQZF1DX2RxHQ640Jyr", name: "Happy Hits!" },
  { id: "37i9dQZF1DX2L0iB23EnRP", name: "Songs to Sing in the Car" },
  { id: "37i9dQZF1DX1lVhptIYRda", name: "Hot Hits UK" },
  { id: "37i9dQZF1DXcF6B6QPhFDv", name: "Rock Classics" },
  { id: "37i9dQZF1DX4UtSsGT1Sbe", name: "All Out 2010s" },
];

async function getToken() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET required");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`token failed: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

async function spotifyGet(token, url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
}

async function fetchPlaylistTracks(token, playlistId, max = 80) {
  const tracks = [];
  let offset = 0;
  while (tracks.length < max) {
    const data = await spotifyGet(
      token,
      `${SPOTIFY_API}/playlists/${playlistId}/items?offset=${offset}&limit=50&fields=items(track(id,name,artists(name),album(release_date),popularity)),total`,
    );
    for (const item of data.items ?? []) {
      const t = item.track;
      if (!t?.id) continue;
      tracks.push({
        trackId: t.id,
        trackName: t.name ?? null,
        artistName: t.artists?.[0]?.name ?? null,
        popularity: t.popularity ?? null,
        releaseYear: t.album?.release_date ? Number.parseInt(String(t.album.release_date).slice(0, 4), 10) : null,
      });
      if (tracks.length >= max) break;
    }
    offset += 50;
    if (offset >= (data.total ?? 0)) break;
    await new Promise((r) => setTimeout(r, 120));
  }
  return tracks;
}

async function fetchAudioFeatures(token, trackIds) {
  const out = new Map();
  for (let i = 0; i < trackIds.length; i += 100) {
    const batch = trackIds.slice(i, i + 100);
    const data = await spotifyGet(token, `${SPOTIFY_API}/audio-features?ids=${batch.join(",")}`);
    for (const f of data.audio_features ?? []) {
      if (f?.id) out.set(f.id, f);
    }
    await new Promise((r) => setTimeout(r, 80));
  }
  return out;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let limit = 100;
  let resume = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--limit" && args[i + 1]) limit = Number.parseInt(args[++i], 10);
    if (args[i] === "--resume") resume = true;
  }
  return { limit, resume };
}

async function main() {
  const { limit, resume } = parseArgs();
  await mkdir(path.dirname(OUT), { recursive: true });
  await mkdir(path.dirname(SEEDS), { recursive: true });

  let seeds = DEFAULT_SEEDS;
  try {
    await access(SEEDS);
    seeds = JSON.parse(await readFile(SEEDS, "utf8"));
  } catch {
    await writeFile(SEEDS, JSON.stringify(DEFAULT_SEEDS, null, 2));
  }

  let existing = [];
  if (resume) {
    try {
      existing = JSON.parse(await readFile(OUT, "utf8"));
    } catch {
      existing = [];
    }
  }
  const seenIds = new Set(existing.map((p) => p.id));
  const token = await getToken();

  let collected = 0;
  for (const seed of seeds) {
    if (collected >= limit) break;
    if (seenIds.has(seed.id)) continue;
    try {
      const rawTracks = await fetchPlaylistTracks(token, seed.id, 80);
      if (rawTracks.length < 15) continue;
      const features = await fetchAudioFeatures(token, rawTracks.map((t) => t.trackId));
      const tracks = rawTracks.map((t) => {
        const f = features.get(t.trackId);
        return {
          ...t,
          energy: f?.energy ?? null,
          valence: f?.valence ?? null,
          danceability: f?.danceability ?? null,
          acousticness: f?.acousticness ?? null,
          tempo: f?.tempo ?? null,
          rediscoveryScore: t.popularity != null ? Math.max(0, 1 - t.popularity / 100) : null,
        };
      });
      existing.push({
        id: seed.id,
        source: "spotify_editorial",
        name: seed.name ?? seed.id,
        trackCount: tracks.length,
        tracks,
      });
      seenIds.add(seed.id);
      collected += 1;
      console.log(`collected ${seed.name ?? seed.id} (${tracks.length} tracks)`);
    } catch (err) {
      console.warn(`skip ${seed.id}: ${err.message}`);
    }
  }

  await writeFile(OUT, JSON.stringify(existing, null, 2));
  console.log(JSON.stringify({ output: OUT, total: existing.length, newThisRun: collected }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
