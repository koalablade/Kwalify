import type { InferInsertModel } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { db, likedSongsStagingTable, likedSongsTable } from "../db";

export type LikedSongInsert = InferInsertModel<typeof likedSongsTable>;

export async function clearLikedSongsStaging(userId: string): Promise<void> {
  await db.delete(likedSongsStagingTable).where(eq(likedSongsStagingTable.spotifyUserId, userId));
}

export async function insertLikedSongsStagingBatch(rows: LikedSongInsert[]): Promise<void> {
  if (!rows.length) return;
  await db.insert(likedSongsStagingTable).values(rows);
}

/** Atomically replace liked_songs from staging after a successful full fetch. */
export async function commitFullSyncFromStaging(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const staged = await tx
      .select()
      .from(likedSongsStagingTable)
      .where(eq(likedSongsStagingTable.spotifyUserId, userId));

    if (staged.length === 0) return;

    await tx.delete(likedSongsTable).where(eq(likedSongsTable.spotifyUserId, userId));

    const batchSize = 200;
    for (let i = 0; i < staged.length; i += batchSize) {
      const batch = staged.slice(i, i + batchSize).map((row) => ({
        spotifyUserId: row.spotifyUserId,
        trackId: row.trackId,
        trackName: row.trackName,
        artistName: row.artistName,
        albumName: row.albumName,
        albumArt: row.albumArt,
        durationMs: row.durationMs,
        energy: row.energy,
        valence: row.valence,
        tempo: row.tempo,
        danceability: row.danceability,
        acousticness: row.acousticness,
        instrumentalness: row.instrumentalness,
        loudness: row.loudness,
        speechiness: row.speechiness,
        addedAt: row.addedAt,
      }));
      await tx.insert(likedSongsTable).values(batch);
    }

    await tx.delete(likedSongsStagingTable).where(eq(likedSongsStagingTable.spotifyUserId, userId));
  });
}
