import { Router, type IRouter } from "express";
import { db } from "../db";
import { likedSongsTable } from "../db";
import { eq } from "drizzle-orm";
import { detectMusicChapters } from "../lib/music-life-chapters";
import type { LikedSongRow } from "../lib/library-signals";

const router: IRouter = Router();

/** Life chapters inferred from like-date clusters (no private labels). */
router.get("/library/chapters", async (req, res): Promise<void> => {
  if (!req.session.spotifyUserId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = req.session.spotifyUserId;
  const rows = await db
    .select()
    .from(likedSongsTable)
    .where(eq(likedSongsTable.spotifyUserId, userId));

  const songs: LikedSongRow[] = rows.map((r) => ({
    trackId: r.trackId,
    artistName: r.artistName,
    albumName: r.albumName,
    addedAt: r.addedAt,
    energy: r.energy,
    valence: r.valence,
    acousticness: r.acousticness,
    danceability: r.danceability,
  }));

  const chapters = detectMusicChapters(songs);

  res.json({
    chapters: chapters.map((c) => ({
      id: c.id,
      label: c.label,
      description: c.description,
      start: c.start.toISOString(),
      end: c.end.toISOString(),
      trackCount: c.trackIds.length,
      dominantArtists: c.dominantArtists.slice(0, 5),
      strength: Math.round(c.strength * 100) / 100,
    })),
    hint: 'Reference a chapter in your vibe: "take me back to 2019" or "my forgotten indie phase".',
  });
});

export default router;
