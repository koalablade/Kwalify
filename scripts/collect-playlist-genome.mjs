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
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

function loadEnvFile() {
  const candidates = [
    path.join(REPO_ROOT, ".env"),
    path.resolve(process.cwd(), ".env"),
  ];
  for (const envPath of candidates) {
    try {
      const raw = readFileSync(envPath, "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (m && !process.env[m[1]]) {
          process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
        }
      }
      return;
    } catch {
      // try next
    }
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

async function getAccessToken() {
  const refresh = process.env.SPOTIFY_REFRESH_TOKEN;
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET required in .env");

  const credentials = Buffer.from(`${id}:${secret}`).toString("base64");
  const headers = {
    Authorization: `Basic ${credentials}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (refresh) {
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers,
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(`refresh_token failed: ${data.error_description ?? res.status}. Run npm run spotify:oauth-setup`);
    }
    return data.access_token;
  }

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers,
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`client_credentials failed: ${res.status}`);
  const data = await res.json();
  console.warn(
    "Warning: no SPOTIFY_REFRESH_TOKEN — playlist tracks often return 401/403 in Development mode.",
    "Run: npm run spotify:oauth-setup",
  );
  return data.access_token;
}

/** Editorial search queries → pseudo-playlists (works with client-credentials in Dev mode). */
const EDITORIAL_SEARCH_QUERIES = [
  "chill indie morning", "rainy day indie", "late night city", "sunset drive indie",
  "feel good pop", "sad indie acoustic", "gym motivation", "running playlist energy",
  "study focus instrumental", "deep focus ambient", "cozy sunday morning", "party dance hits",
  "90s hip hop classics", "2000s r&b", "2010s indie pop", "80s synth pop",
  "country road trip", "latin reggaeton party", "jazz cafe", "lofi hip hop beats",
  "metal workout", "punk rock energy", "folk campfire", "soul neo soul",
  "electronic house club", "techno underground", "bloghouse indie dance", "tumblr indie 2012",
  "breakup sad songs", "summer road trip", "winter cozy", "spring awakening",
  "tokyo city pop", "uk garage", "afrobeats party", "k-pop hits",
  "classic rock driving", "blues rainy night", "disco funk", "ambient sleep",
  "yoga flow calm", "meditation peaceful", "cooking dinner jazz", "wine and dine",
  "morning commute upbeat", "Friday night out", "Saturday morning coffee", "Sunday vinyl",
  "nostalgic 2000s", "nostalgic 90s alternative", "indie folk road trip", "dream pop night",
  "shoegaze atmospheric", "post punk dark", "garage rock raw", "psychedelic rock trip",
  "hip hop chill", "trap workout", "drill uk", "boom bap classic",
  "rnb slow jams", "motown classics", "reggae summer", "dancehall party",
  "EDM festival", "trance euphoric", "dubstep heavy", "drum and bass fast",
  "classical piano calm", "soundtrack epic", "movie scores emotional", "video game focus",
  "indie pop sunshine", "bedroom pop", "hyperpop experimental", "alt r&b moody",
  "singer songwriter intimate", "acoustic covers", "piano ballads", "orchestral cinematic",
  "road rage rock", "open window drive", "beach summer hits", "pool party",
  "late night study", "early morning run", "pre game hype", "cool down stretch",
  "romantic date night", "heartbreak healing", "confidence boost", "feel powerful",
  "rain window indie", "snow day cozy", "autumn leaves folk", "golden hour",
  "warehouse rave electronic", "after hours club", "sunrise set", "sunset dj",
  "indie sleaze 2010", "bloghouse 2008", "new rave", "electroclash",
  "deep house lounge", "minimal techno", "progressive house", "future bass",
  "phonk drift", "cloud rap", "emo rap sad", "conscious hip hop",
  "alternative metal", "pop punk 2000s", "grunge 90s", "britpop 90s",
  "city rain walk", "night bus home", "airport waiting", "train journey",
  "bookshop indie", "art gallery ambient", "farmers market folk", "late night diner",
];

async function searchEditorialTracks(token, query, max = 30) {
  const tracks = [];
  let offset = 0;
  while (tracks.length < max && offset < 50) {
    const params = new URLSearchParams({
      q: query,
      type: "track",
      limit: "10",
      offset: String(offset),
    });
    const url = `${SPOTIFY_API}/search?${params.toString()}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`search "${query}" → ${res.status}`);
    const data = await res.json();
    for (const t of data.tracks?.items ?? []) {
      if (!t?.id) continue;
      tracks.push({
        trackId: t.id,
        trackName: t.name ?? null,
        artistName: t.artists?.[0]?.name ?? null,
        popularity: t.popularity ?? null,
        releaseYear: t.album?.release_date ? Number.parseInt(String(t.album.release_date).slice(0, 4), 10) : null,
        rediscoveryScore: t.popularity != null ? Math.max(0, 1 - t.popularity / 100) : null,
      });
      if (tracks.length >= max) break;
    }
    if ((data.tracks?.items ?? []).length < 50) break;
    offset += 50;
    await new Promise((r) => setTimeout(r, 350));
  }
  const seen = new Set();
  return tracks.filter((t) => {
    if (seen.has(t.trackId)) return false;
    seen.add(t.trackId);
    return true;
  });
}

async function collectFromSearchQueries(token, existing, seenIds, limit) {
  let collected = 0;
  for (const query of EDITORIAL_SEARCH_QUERIES) {
    if (collected >= limit) break;
    const id = `search:${query.replace(/\s+/g, "_").slice(0, 48)}`;
    if (seenIds.has(id)) continue;
    try {
      const tracks = await searchEditorialTracks(token, query, 30);
      if (tracks.length < 8) continue;
      existing.push({
        id,
        source: "spotify_search_corpus",
        name: query,
        prompt: query,
        trackCount: tracks.length,
        tracks,
      });
      seenIds.add(id);
      collected += 1;
      if (collected % 10 === 0) console.log(`search corpus: ${collected} playlists (${query})`);
      await new Promise((r) => setTimeout(r, 400));
    } catch (err) {
      console.warn(`skip search "${query}": ${err.message}`);
    }
  }
  return collected;
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
  const token = await getAccessToken();

  let collected = 0;
  const hasRefresh = !!process.env.SPOTIFY_REFRESH_TOKEN;
  if (hasRefresh) {
    for (const seed of seeds) {
      if (collected >= limit) break;
      if (seenIds.has(seed.id)) continue;
      try {
        const rawTracks = await fetchPlaylistTracks(token, seed.id, 80);
        if (rawTracks.length < 15) continue;
        let features = new Map();
        try {
          features = await fetchAudioFeatures(token, rawTracks.map((t) => t.trackId));
        } catch {
          // audio-features may be blocked in Dev mode
        }
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
  }

  if (!hasRefresh || collected === 0) {
    console.log("Using editorial search corpus (client-credentials compatible)...");
    collected += await collectFromSearchQueries(token, existing, seenIds, limit);
  }

  await writeFile(OUT, JSON.stringify(existing, null, 2));
  console.log(JSON.stringify({ output: OUT, total: existing.length, newThisRun: collected }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
