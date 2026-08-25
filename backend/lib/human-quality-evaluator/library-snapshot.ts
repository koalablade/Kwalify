/**
 * Read-only liked-songs snapshot for QA library-opportunity counts.
 * Does not generate playlists or mutate the engine.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { classifyTrack } from "../genre-taxonomy";
import { readLocalDotEnv } from "../benchmark-env-dotenv";
import type { ClassifiedLibraryTrack, QaLibrarySnapshot } from "./library-opportunity";

function hydrateEnv(): void {
  const env = readLocalDotEnv();
  for (const key of ["DATABASE_URL", "SMOKE_SPOTIFY_USER_ID", "SPOTIFY_USER_ID", "PLAYLIST_EVAL_SPOTIFY_USER_ID"] as const) {
    if (!process.env[key] && env[key]) process.env[key] = env[key];
  }
}

export function qaLibraryUserId(): string {
  hydrateEnv();
  return (
    process.env.SMOKE_SPOTIFY_USER_ID
    ?? process.env.PLAYLIST_EVAL_SPOTIFY_USER_ID
    ?? process.env.SPOTIFY_USER_ID
    ?? "koalablade"
  );
}

function parseGenres(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function loadQaLibrarySnapshotFromDb(): Promise<QaLibrarySnapshot | null> {
  hydrateEnv();
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const userId = qaLibraryUserId();
  const pg = await import("pg");
  const client = new pg.default.Client({ connectionString: url });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT track_id, track_name, artist_name, album_name, release_year,
              energy, valence, acousticness, danceability, tempo,
              instrumentalness, speechiness, spotify_artist_genres, album_genres
       FROM liked_songs WHERE spotify_user_id = $1`,
      [userId],
    );
    if (result.rows.length === 0) return null;
    const tracks: ClassifiedLibraryTrack[] = result.rows.map((row) => {
      const classification = classifyTrack({
        trackName: String(row.track_name ?? ""),
        artistName: String(row.artist_name ?? ""),
        albumName: String(row.album_name ?? ""),
        spotifyArtistGenres: parseGenres(row.spotify_artist_genres),
        albumGenres: parseGenres(row.album_genres),
        energy: row.energy,
        valence: row.valence,
        acousticness: row.acousticness,
        danceability: row.danceability,
        instrumentalness: row.instrumentalness,
        speechiness: row.speechiness,
        tempo: row.tempo,
      });
      return {
        trackId: String(row.track_id ?? ""),
        trackName: String(row.track_name ?? ""),
        artistName: String(row.artist_name ?? ""),
        albumName: String(row.album_name ?? ""),
        releaseYear: typeof row.release_year === "number" ? row.release_year : null,
        genreFamily: classification.genreFamily,
        primarySubgenre: classification.primarySubgenre,
        subGenres: classification.subGenres,
        energy: row.energy,
        valence: row.valence,
        acousticness: row.acousticness,
        danceability: row.danceability,
      };
    });
    return {
      userId,
      loadedAt: new Date().toISOString(),
      librarySize: tracks.length,
      tracks,
      source: "postgresql_liked_songs",
    };
  } finally {
    await client.end();
  }
}

export async function saveQaLibrarySnapshot(path: string, snapshot: QaLibrarySnapshot): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(snapshot)}\n`);
}

export async function loadQaLibrarySnapshotFromFile(path: string): Promise<QaLibrarySnapshot | null> {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as QaLibrarySnapshot;
    if (!raw?.tracks?.length) return null;
    return raw;
  } catch {
    return null;
  }
}

export async function resolveQaLibrarySnapshot(cachePath: string): Promise<QaLibrarySnapshot | null> {
  const fresh = await loadQaLibrarySnapshotFromDb();
  if (fresh && fresh.tracks.length > 0) {
    const cached = await loadQaLibrarySnapshotFromFile(cachePath);
    const fileIsStale =
      !cached
      || cached.librarySize !== fresh.librarySize
      || cached.userId !== fresh.userId;
    if (fileIsStale) await saveQaLibrarySnapshot(cachePath, fresh);
    return fresh;
  }
  const cached = await loadQaLibrarySnapshotFromFile(cachePath);
  if (cached && cached.tracks.length > 0) {
    return {
      ...cached,
      source: "file_snapshot",
      sourcePath: cachePath,
    };
  }
  return null;
}
