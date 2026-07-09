/**
 * Probe Spotify audio-features API with CC vs user token (diagnosis).
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { fetchAudioFeatures, getClientCredentialsToken } from "../lib/spotify";

async function main(): Promise<void> {
  const env = readFileSync(".env", "utf8");
  const dbMatch = env.match(/^DATABASE_URL=(.+)$/m);
  if (!dbMatch) throw new Error("DATABASE_URL missing");
  const pool = new pg.Pool({
    connectionString: dbMatch[1].trim().replace(/^"|"$/g, ""),
  });
  const userId = process.env["SMOKE_SPOTIFY_USER_ID"] ?? "koalablade";
  const userToken = process.env["SPOTIFY_ACCESS_TOKEN"] ?? "";
  const sample = await pool.query<{ track_id: string }>(
    "SELECT track_id FROM liked_songs WHERE spotify_user_id = $1 LIMIT 5",
    [userId],
  );
  const ids = sample.rows.map((r) => r.track_id);
  await pool.end();

  let ccToken = "";
  try {
    ccToken = await getClientCredentialsToken();
  } catch (err) {
    console.log("CC token failed:", err instanceof Error ? err.message : String(err));
  }

  const results: Record<string, unknown> = { sampleIds: ids };

  if (ccToken) {
    const cc = await fetchAudioFeatures(ccToken, ids, { userKey: userId });
    results.ccTokenCount = cc.length;
    results.ccSample = cc[0] ?? null;
  }

  if (userToken) {
    const user = await fetchAudioFeatures(userToken, ids, { userKey: userId });
    results.userTokenCount = user.length;
    results.userSample = user[0] ?? null;
  } else {
    results.userToken = "missing (set SPOTIFY_ACCESS_TOKEN to probe)";
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
