/**
 * Diagnosis: audio feature coverage in liked_songs (read-only).
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const env = readFileSync(".env", "utf8");
const dbMatch = env.match(/^DATABASE_URL=(.+)$/m);
if (!dbMatch) throw new Error("DATABASE_URL missing in .env");

const userId = process.env["SMOKE_SPOTIFY_USER_ID"] ?? "koalablade";
const pool = new pg.Pool({
  connectionString: dbMatch[1].trim().replace(/^"|"$/g, ""),
});

async function main(): Promise<void> {
  const q = async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await pool.query(sql, params)).rows as T[];

  const [totals] = await q<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM liked_songs WHERE spotify_user_id = $1",
    [userId],
  );
  const [features] = await q<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM liked_songs WHERE spotify_user_id = $1 AND energy IS NOT NULL AND valence IS NOT NULL",
    [userId],
  );
  const [enrichment] = await q<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM liked_songs WHERE spotify_user_id = $1 AND enrichment_version IS NOT NULL",
    [userId],
  );
  const [semantic] = await q<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM liked_songs WHERE spotify_user_id = $1 AND semantic_profile IS NOT NULL",
    [userId],
  );
  const [sync] = await q<Record<string, unknown>>(
    "SELECT total_tracks, last_synced_at, sync_error, is_syncing FROM sync_status WHERE spotify_user_id = $1 LIMIT 1",
    [userId],
  );
  const sampleIds = await q<{ track_id: string; energy: number | null; added_at: string | null }>(
    `SELECT track_id, energy, added_at FROM liked_songs
     WHERE spotify_user_id = $1 ORDER BY id DESC LIMIT 5`,
    [userId],
  );
  const byYear = await q<{ yr: number | null; n: number; with_features: number }>(
    `SELECT release_year AS yr, COUNT(*)::int AS n,
            COUNT(*) FILTER (WHERE energy IS NOT NULL)::int AS with_features
     FROM liked_songs WHERE spotify_user_id = $1
     GROUP BY release_year ORDER BY n DESC NULLS LAST LIMIT 8`,
    [userId],
  );
  const tables = await q<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name LIKE '%liked%' ORDER BY 1`,
  );

  console.log(JSON.stringify({
    userId,
    totalTracks: totals?.n ?? 0,
    withAudioFeatures: features?.n ?? 0,
    featureCoveragePct: totals?.n ? Math.round(((features?.n ?? 0) / totals.n) * 1000) / 10 : 0,
    withEnrichmentVersion: enrichment?.n ?? 0,
    withSemanticProfile: semantic?.n ?? 0,
    syncStatus: sync[0] ?? null,
    recentSample: sampleIds,
    topReleaseYears: byYear,
    likedTables: tables.map((t) => t.table_name),
    gymRelaxedGate: (await q<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM liked_songs WHERE spotify_user_id = $1
       AND (energy >= 0.52 OR tempo >= 105 OR danceability >= 0.54)`,
      [userId],
    ))[0]?.n ?? 0,
    minRequiredForLength30: 12,
  }, null, 2));
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  })
  .finally(() => pool.end());
