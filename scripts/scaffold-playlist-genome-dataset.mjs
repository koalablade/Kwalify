/**
 * Playlist genome dataset scaffold — learn playlist-level patterns from real corpora.
 *
 * Target: 5,000–20,000 high-quality public Spotify playlists (editorial + user-curated).
 * Features are playlist-level (not track-level): spacing, discovery cadence, energy arc, etc.
 *
 * Usage:
 *   node scripts/scaffold-playlist-genome-dataset.mjs
 *   node scripts/scaffold-playlist-genome-dataset.mjs --validate data/corpus/human-playlists.json
 *
 * After collecting corpus:
 *   npm run fit:human-playlist-patterns -- --in data/corpus/human-playlists.json
 */

import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";

const OUT_DIR = path.resolve("data/corpus/playlist-genome");
const SCHEMA_PATH = path.join(OUT_DIR, "playlist-genome-schema.json");
const README_PATH = path.join(OUT_DIR, "README.md");
const CORPUS_PATH = path.resolve("data/corpus/human-playlists.json");

const SCHEMA = {
  version: 1,
  description: "Playlist genome — one row per playlist with playlist-level features for learning editorial patterns",
  playlist: {
    id: "string — Spotify playlist id or stable hash",
    source: "editorial | user_curated | benchmark_reference",
    name: "string",
    prompt: "optional — natural language intent if known",
    trackCount: "number",
    tracks: [
      {
        trackId: "string",
        trackName: "string",
        artistName: "string",
        genreFamily: "string | null",
        energy: "0-1 | null",
        valence: "0-1 | null",
        danceability: "0-1 | null",
        acousticness: "0-1 | null",
        popularity: "0-100 | null",
        releaseYear: "number | null",
        rediscoveryScore: "0-1 — optional proxy for discovery",
      },
    ],
    genome: {
      artistSpacingMedian: "computed",
      maxArtistShare: "computed",
      discoveryRatio: "computed",
      energySlope: "computed",
      avgEnergyJump: "computed",
      smoothTransitionShare: "computed",
      decadeSpread: "optional — era diversity",
      popularityFrontLoad: "optional — mean popularity first 25%",
      popularityMidPeak: "optional",
      popularityDiscoveryTail: "optional",
    },
  },
  collectionNotes: [
    "Prefer editorial playlists (Spotify official) + high-save user lists",
    "Exclude algorithmic 'Daily Mix' style unless labelled",
    "Minimum 15 tracks per playlist, maximum 100",
    "Store raw tracks; run fit:human-playlist-patterns for percentile priors",
    "Human pairwise A/B labels (separate file) train preference model — not this schema alone",
  ],
};

async function validateCorpus(filePath) {
  const raw = JSON.parse(await readFile(filePath, "utf8"));
  const playlists = Array.isArray(raw) ? raw : raw.playlists ?? [];
  let valid = 0;
  let invalid = 0;
  for (const p of playlists) {
    const tracks = p.tracks ?? [];
    if (tracks.length >= 10 && tracks[0]?.artistName && tracks[0]?.trackName) valid += 1;
    else invalid += 1;
  }
  return { total: playlists.length, valid, invalid, path: filePath };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--validate")) {
    const p = args[args.indexOf("--validate") + 1] ?? CORPUS_PATH;
    try {
      await access(p);
      console.log(JSON.stringify(await validateCorpus(p), null, 2));
    } catch {
      console.log(JSON.stringify({ error: "corpus_not_found", path: p }, null, 2));
      process.exit(1);
    }
    return;
  }

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(SCHEMA_PATH, JSON.stringify(SCHEMA, null, 2));
  await writeFile(README_PATH, `# Playlist genome dataset

Collect **5,000–20,000** real Spotify playlists here. This contributes more to "feels human" than additional deterministic pipeline code.

## Steps

1. Export playlists to \`data/corpus/human-playlists.json\` (array of \`{ tracks: [...] }\`)
2. Validate: \`node scripts/scaffold-playlist-genome-dataset.mjs --validate\`
3. Fit priors: \`npm run fit:human-playlist-patterns\`
4. Point \`HUMAN_PLAYLIST_PATTERNS_PATH\` at fitted output for production

## Playlist-level features to learn

- Artist spacing & repetition distance
- Popularity curve (front-load vs mid-peak vs discovery tail)
- Discovery cadence
- Decade / era mixing
- Tempo & energy drift
- Emotional arc shape
- Transition style frequency

## Human preference learning (separate)

Pairwise blind ratings → \`data/corpus/pairwise-human-labels.jsonl\`  
Format: \`{ prompt, playlistA_id, playlistB_id, winner, rater_id, questions }\`

North-star metric: **Kwalify win rate vs human reference** in blind pairwise — not gate pass rate.
`);
  console.log(JSON.stringify({ schema: SCHEMA_PATH, readme: README_PATH }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
