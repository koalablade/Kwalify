#!/usr/bin/env node
import pg from "pg";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { applyMusicalWorldPreV3Sampling } from "../dist/core/pre-v3-world-sampling.js";
import { resolveWorldBoundary } from "../dist/core/world-boundary.js";
import { classifyTrack } from "../dist/lib/genre-taxonomy.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const env = readFileSync(resolve(ROOT, ".env"), "utf8");
const db = env.match(/^DATABASE_URL=(.+)$/m)[1].trim().replace(/^["']|["']$/g, "");
const pool = new pg.Pool({ connectionString: db });
const { rows } = await pool.query(
  "SELECT track_id, track_name, artist_name, album_name, energy, valence, spotify_artist_genres FROM liked_songs WHERE spotify_user_id = $1",
  ["koalablade"],
);
await pool.end();
const classMap = new Map();
for (const r of rows) {
  classMap.set(r.track_id, classifyTrack({
    trackName: r.track_name,
    artistName: r.artist_name,
    albumName: r.album_name ?? "",
    energy: r.energy,
    valence: r.valence,
  }));
}
const library = rows.map((r) => ({
  trackId: r.track_id,
  trackName: r.track_name,
  artistName: r.artist_name,
  albumName: r.album_name,
  energy: r.energy,
  valence: r.valence,
  spotifyArtistGenres: r.spotify_artist_genres,
  score: 0.6,
}));
const prompt = "sunset beach reggae";
const worldBoundary = resolveWorldBoundary({ prompt });
const contractEvidence = library.filter((t) =>
  /bob marley|shaggy|sean paul|peter tosh|gregory isaacs|damian marley|ub40/i.test(t.artistName ?? ""),
).slice(0, 17);
const result = applyMusicalWorldPreV3Sampling({
  prompt,
  currentPool: contractEvidence,
  retrievalPool: contractEvidence,
  libraryPool: library,
  classMap,
  worldBoundary,
  minTarget: 50,
  maxTarget: 200,
  contractEvidenceCount: 17,
});
console.log(JSON.stringify({
  librarySize: library.length,
  contractEvidence: contractEvidence.length,
  diagnostics: result.diagnostics,
  sampleArtists: result.pool.slice(0, 8).map((t) => t.artistName),
}, null, 2));
