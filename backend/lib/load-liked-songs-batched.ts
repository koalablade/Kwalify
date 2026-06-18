/**
 * Keyset-paginated liked_songs reads for large libraries (10k+).
 */

import { db, likedSongsTable } from "../db";
import { and, asc, eq, gt } from "drizzle-orm";
import { logger } from "./logger";

const DEFAULT_BATCH = Number.parseInt(process.env["LIKED_SONGS_BATCH_SIZE"] ?? "2500", 10);

export async function loadLikedSongsBatched(
  userId: string,
  batchSize = DEFAULT_BATCH,
): Promise<Array<typeof likedSongsTable.$inferSelect>> {
  const rows: Array<typeof likedSongsTable.$inferSelect> = [];
  let lastId = 0;
  const started = Date.now();
  for (;;) {
    const batch = await db
      .select()
      .from(likedSongsTable)
      .where(and(eq(likedSongsTable.spotifyUserId, userId), gt(likedSongsTable.id, lastId)))
      .orderBy(asc(likedSongsTable.id))
      .limit(batchSize);
    if (batch.length === 0) break;
    rows.push(...batch);
    lastId = batch[batch.length - 1]!.id;
  }
  logger.debug({ userId, count: rows.length, ms: Date.now() - started, batchSize }, "loadLikedSongsBatched");
  return rows;
}
