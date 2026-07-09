/** Verify validCandidateSupply after audio feature backfill (read-only). */
import { readFileSync } from "node:fs";
import pg from "pg";
import { estimateValidCandidateSupply } from "../lib/library-valid-candidate-supply";
import { classifyTrack } from "../lib/genre-taxonomy";

const userId = process.env["SMOKE_SPOTIFY_USER_ID"] ?? "koalablade";

async function main(): Promise<void> {
  const env = readFileSync(".env", "utf8");
  const match = env.match(/^DATABASE_URL=(.+)$/m);
  if (!match) throw new Error("DATABASE_URL missing");
  const pool = new pg.Pool({ connectionString: match[1].trim().replace(/^"|"$/g, "") });

  const { rows } = await pool.query(
    `SELECT track_id, track_name, artist_name, album_name, energy, valence, tempo, danceability,
            acousticness, instrumentalness, speechiness, release_year
     FROM liked_songs WHERE spotify_user_id = $1`,
    [userId],
  );

  const tracks = rows.map((r) => ({
    trackId: r.track_id as string,
    trackName: r.track_name as string,
    artistName: r.artist_name as string,
    albumName: r.album_name as string,
    energy: r.energy as number | null,
    valence: r.valence as number | null,
    tempo: r.tempo as number | null,
    danceability: r.danceability as number | null,
    acousticness: r.acousticness as number | null,
    instrumentalness: r.instrumentalness as number | null,
    speechiness: r.speechiness as number | null,
    releaseYear: r.release_year as number | null,
  }));

  const classMap = new Map(
    tracks.map((t) => [
      t.trackId,
      classifyTrack({
        trackName: t.trackName,
        artistName: t.artistName,
        albumName: t.albumName ?? "",
        energy: t.energy,
        valence: t.valence,
        tempo: t.tempo,
        danceability: t.danceability,
        acousticness: t.acousticness,
        instrumentalness: t.instrumentalness,
        speechiness: t.speechiness,
      }),
    ]),
  );

  const emotionProfile = {
    energy: 0.82,
    valence: 0.7,
    tension: 0.4,
    nostalgia: 0.2,
    calm: 0.1,
    environment: null,
    timeOfDay: null,
    motionState: null,
  };

  const prompts = [
    { vibe: "gym", intent: { activity: "gym" } },
    { vibe: "2000s pop punk gym workout", intent: { activity: "gym", primaryGenres: ["rock"], eraRange: { start: 1998, end: 2012 } } },
    { vibe: "heavy lifting gym pump aggressive", intent: { activity: "gym" } },
  ];

  const results = prompts.map(({ vibe, intent }) => ({
    prompt: vibe,
    ...estimateValidCandidateSupply({
      tracks,
      vibe,
      intent,
      emotionProfile,
      classMap,
      requestedLength: 30,
    }),
  }));

  console.log(JSON.stringify({ userId, trackCount: tracks.length, results }, null, 2));
  await pool.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
