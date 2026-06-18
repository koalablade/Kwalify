import { eq, inArray } from "drizzle-orm";
import pg from "pg";
import { db } from "../db";
import {
  likedSongsTable,
  playlistFeedbackTable,
  playlistHistoryTable,
  savedPlaylistsTable,
  syncStatusTable,
  unknownTermEventsTable,
  promptSceneMemoryTable,
  userFeedbackMemoryTable,
} from "../db";

/** Delete all Kwalify-stored data for a Spotify user id. */
export async function deleteUserData(
  spotifyUserId: string,
  rawPool?: pg.Pool,
): Promise<{ deletedPlaylists: number }> {
  const playlistRows = await db
    .select({ id: savedPlaylistsTable.id })
    .from(savedPlaylistsTable)
    .where(eq(savedPlaylistsTable.userId, spotifyUserId));
  const playlistIds = playlistRows.map((row) => row.id);

  if (playlistIds.length > 0) {
    await db
      .delete(playlistFeedbackTable)
      .where(inArray(playlistFeedbackTable.playlistId, playlistIds));
  }

  await db.delete(playlistFeedbackTable).where(eq(playlistFeedbackTable.userId, spotifyUserId));
  await db.delete(savedPlaylistsTable).where(eq(savedPlaylistsTable.userId, spotifyUserId));
  await db.delete(playlistHistoryTable).where(eq(playlistHistoryTable.spotifyUserId, spotifyUserId));
  await db.delete(likedSongsTable).where(eq(likedSongsTable.spotifyUserId, spotifyUserId));
  await db.delete(syncStatusTable).where(eq(syncStatusTable.spotifyUserId, spotifyUserId));
  await db.delete(userFeedbackMemoryTable).where(eq(userFeedbackMemoryTable.userId, spotifyUserId));
  await db.delete(unknownTermEventsTable).where(eq(unknownTermEventsTable.userId, spotifyUserId));
  await db.delete(promptSceneMemoryTable).where(eq(promptSceneMemoryTable.userId, spotifyUserId));

  if (rawPool) {
    await rawPool.query(
      `DELETE FROM session WHERE sess::jsonb ->> 'spotifyUserId' = $1`,
      [spotifyUserId],
    );
  }

  return { deletedPlaylists: playlistIds.length };
}
