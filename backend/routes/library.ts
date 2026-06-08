import { Router, type IRouter } from "express";
import { db } from "../db";
import { likedSongsTable } from "../db";
import { eq, sql } from "drizzle-orm";
import { detectMusicChapters } from "../lib/music-life-chapters";
import type { LikedSongRow } from "../lib/library-signals";
import { computeLibrarySummary } from "../lib/library-summary";
import { getFeatures } from "../lib/env";
import { generateMockSpotifyLibrary } from "../lib/mock-spotify";

const router: IRouter = Router();

/** Aggregate stats for synced library health. */
router.get("/library/summary", async (req, res): Promise<void> => {
  if (getFeatures().devMode.useMockSpotify) {
    const sample = generateMockSpotifyLibrary();
    const summary = computeLibrarySummary(sample);
    summary.trackCount = sample.length;
    summary.artistCount = new Set(sample.map((track) => track.artistName.toLowerCase())).size;
    res.json({ ...summary, devMode: true });
    return;
  }

  if (!req.session.spotifyUserId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = req.session.spotifyUserId;
  const whereUser = eq(likedSongsTable.spotifyUserId, userId);

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(likedSongsTable)
    .where(whereUser);

  const trackCount = Number(countRow?.count ?? 0);
  if (trackCount === 0) {
    res.json({
      trackCount: 0,
      artistCount: 0,
      genreFamilyCount: 0,
      topDecade: null,
      oldestLikedYear: null,
      newestLikedYear: null,
    });
    return;
  }

  const [artistRow] = await db
    .select({
      count: sql<number>`count(distinct lower(${likedSongsTable.artistName}))::int`,
    })
    .from(likedSongsTable)
    .where(whereUser);

  const dated = await db
    .select({ addedAt: likedSongsTable.addedAt })
    .from(likedSongsTable)
    .where(whereUser);

  const sampleSize = Math.min(400, trackCount);
  const sample = await db
    .select({
      trackName: likedSongsTable.trackName,
      artistName: likedSongsTable.artistName,
      albumName: likedSongsTable.albumName,
      addedAt: likedSongsTable.addedAt,
      energy: likedSongsTable.energy,
      valence: likedSongsTable.valence,
      acousticness: likedSongsTable.acousticness,
      danceability: likedSongsTable.danceability,
      instrumentalness: likedSongsTable.instrumentalness,
      speechiness: likedSongsTable.speechiness,
      tempo: likedSongsTable.tempo,
    })
    .from(likedSongsTable)
    .where(whereUser)
    .limit(sampleSize);

  const summary = computeLibrarySummary(sample);
  summary.trackCount = trackCount;
  summary.artistCount = Number(artistRow?.count ?? summary.artistCount);

  const decades = new Map<string, number>();
  let oldest: number | null = null;
  let newest: number | null = null;
  for (const { addedAt } of dated) {
    if (!addedAt) continue;
    const y = addedAt.getFullYear();
    if (oldest === null || y < oldest) oldest = y;
    if (newest === null || y > newest) newest = y;
    const decade = `${Math.floor(y / 10) * 10}s`;
    decades.set(decade, (decades.get(decade) ?? 0) + 1);
  }
  let topDecade: string | null = null;
  let topCount = 0;
  for (const [d, c] of decades) {
    if (c > topCount) {
      topCount = c;
      topDecade = d;
    }
  }
  summary.topDecade = topDecade;
  summary.oldestLikedYear = oldest;
  summary.newestLikedYear = newest;

  res.json(summary);
});

/** Life chapters inferred from like-date clusters (no private labels). */
router.get("/library/chapters", async (req, res): Promise<void> => {
  if (getFeatures().devMode.useMockSpotify) {
    const songs: LikedSongRow[] = generateMockSpotifyLibrary().map((r) => ({
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
      devMode: true,
    });
    return;
  }

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
