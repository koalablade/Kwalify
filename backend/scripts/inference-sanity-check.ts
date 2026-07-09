/** Sanity-check inferred audio features by genre family (read-only). */
import { readFileSync } from "node:fs";
import pg from "pg";
import { classifyTrack } from "../lib/genre-taxonomy";

const userId = process.env["SMOKE_SPOTIFY_USER_ID"] ?? "koalablade";

type Row = {
  track_id: string;
  track_name: string;
  artist_name: string;
  album_name: string;
  energy: number;
  valence: number;
  tempo: number;
  danceability: number;
  acousticness: number;
  spotify_artist_genres: unknown;
};

async function main(): Promise<void> {
  const env = readFileSync(".env", "utf8");
  const match = env.match(/^DATABASE_URL=(.+)$/m);
  if (!match) throw new Error("DATABASE_URL missing");
  const pool = new pg.Pool({ connectionString: match[1].trim().replace(/^"|"$/g, "") });

  const { rows } = await pool.query<Row>(
    `SELECT track_id, track_name, artist_name, album_name, energy, valence, tempo, danceability, acousticness, spotify_artist_genres
     FROM liked_songs WHERE spotify_user_id = $1 AND energy IS NOT NULL`,
    [userId],
  );

  const buckets = {
    folk_acoustic: [] as Row[],
    ambient: [] as Row[],
    metal: [] as Row[],
    gym_like: [] as Row[],
  };

  for (const row of rows) {
    const cls = classifyTrack({
      trackName: row.track_name,
      artistName: row.artist_name,
      albumName: row.album_name,
      spotifyArtistGenres: row.spotify_artist_genres,
      energy: row.energy,
      valence: row.valence,
      tempo: row.tempo,
      danceability: row.danceability,
      acousticness: row.acousticness,
    });
    const text = `${row.track_name} ${row.artist_name}`.toLowerCase();
    const family = cls.genreFamily;
    if (family === "folk" || /\bacoustic\b/.test(text) || row.acousticness >= 0.65) {
      buckets.folk_acoustic.push(row);
    }
    if (/\bambient\b/.test(text) || cls.primarySubgenre === "ambient" || family === "classical" && row.energy < 0.35) {
      buckets.ambient.push(row);
    }
    if (family === "metal" || /\bmetal\b/.test(text)) {
      buckets.metal.push(row);
    }
    if (row.energy >= 0.7 && row.tempo >= 118) {
      buckets.gym_like.push(row);
    }
  }

  function stats(label: string, sample: Row[]) {
    if (!sample.length) return { label, n: 0 };
    const energies = sample.map((r) => r.energy);
    const dances = sample.map((r) => r.danceability);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const max = (xs: number[]) => Math.max(...xs);
    const min = (xs: number[]) => Math.min(...xs);
    const highEnergy = sample.filter((r) => r.energy >= 0.85).length;
    const highDance = sample.filter((r) => r.danceability >= 0.75).length;
    const lowEnergy = sample.filter((r) => r.energy < 0.45).length;
    return {
      label,
      n: sample.length,
      energy: { min: min(energies), avg: avg(energies), max: max(energies), highEnergyPct: highEnergy / sample.length },
      danceability: { min: min(dances), avg: avg(dances), max: max(dances), highDancePct: highDance / sample.length },
      lowEnergyPct: lowEnergy / sample.length,
      outliers: sample
        .filter((r) =>
          (label.includes("folk") && r.energy >= 0.85) ||
          (label.includes("ambient") && r.danceability >= 0.75) ||
          (label.includes("metal") && r.energy < 0.55),
        )
        .slice(0, 5)
        .map((r) => ({ track: r.track_name, artist: r.artist_name, energy: r.energy, danceability: r.danceability })),
    };
  }

  const report = {
    userId,
    totalWithFeatures: rows.length,
    checks: [
      stats("folk_acoustic", buckets.folk_acoustic),
      stats("ambient", buckets.ambient),
      stats("metal", buckets.metal),
      stats("gym_like_high_energy", buckets.gym_like),
    ],
    pass:
      buckets.folk_acoustic.filter((r) => r.energy >= 0.85).length === 0 &&
      buckets.ambient.filter((r) => r.danceability >= 0.8).length / Math.max(1, buckets.ambient.length) < 0.15 &&
      buckets.metal.filter((r) => r.energy < 0.55).length / Math.max(1, buckets.metal.length) < 0.1,
  };

  console.log(JSON.stringify(report, null, 2));
  await pool.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
