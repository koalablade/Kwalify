/**
 * Bootstrap human-playlists.json from editorial reference prompts in the repo.
 * Run immediately without Spotify API — fits real curated track order from benchmarks.
 *
 *   node scripts/bootstrap-playlist-corpus-from-references.mjs
 *   npm run fit:human-playlist-patterns
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const REFS = path.resolve("data/corpus/pairwise-benchmark-prompts.json");
const OUT = path.resolve("data/corpus/human-playlists.json");

async function main() {
  const raw = JSON.parse(await readFile(REFS, "utf8"));
  const prompts = Array.isArray(raw) ? raw : raw.prompts ?? [];
  const playlists = prompts
    .filter((p) => Array.isArray(p.referenceTracks) && p.referenceTracks.length >= 5)
    .map((p) => ({
      id: p.id,
      source: "benchmark_reference",
      name: p.id,
      prompt: p.prompt,
      tracks: p.referenceTracks.map((t, i) => ({
        trackId: `${p.id}_${i}`,
        trackName: t.trackName ?? null,
        artistName: t.artistName ?? null,
        genreFamily: t.genreFamily ?? null,
        energy: t.energy ?? null,
        valence: t.valence ?? null,
        danceability: t.danceability ?? null,
        acousticness: t.acousticness ?? null,
        popularity: t.popularity ?? null,
        releaseYear: t.releaseYear ?? null,
      })),
    }));

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(playlists, null, 2));
  console.log(JSON.stringify({ output: OUT, playlistCount: playlists.length, trackTotal: playlists.reduce((s, p) => s + p.tracks.length, 0) }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
