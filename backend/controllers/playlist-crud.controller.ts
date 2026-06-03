/**
 * Purpose: CRUD routes for saved playlists — list, share, feedback, delete.
 * Responsibilities:
 *   - GET /playlists        — return saved playlists for the authenticated user
 *   - GET /share/:id        — return a playlist by id for the public share page
 *   - POST /playlists/:id/feedback — record a thumbs-up/neutral/down reaction
 *   - DELETE /playlists/:id — delete a playlist owned by the authenticated user
 * Dependencies: drizzle-orm, db (saved_playlists, playlist_feedback tables)
 */
import { Router, type IRouter } from "express";
import { db } from "../db";
import {
  playlistFeedbackTable,
  savedPlaylistsTable,
} from "../db";
import { eq, desc, and } from "drizzle-orm";

const router: IRouter = Router();

router.get("/playlists", async (req, res): Promise<void> => {
  if (!req.session.spotifyUserId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = req.session.spotifyUserId;

  try {
    const playlists = await db
      .select()
      .from(savedPlaylistsTable)
      .where(eq(savedPlaylistsTable.userId, userId))
      .orderBy(desc(savedPlaylistsTable.createdAt));

    res.json({
      playlists: playlists.map((p) => ({
        id: p.id,
        name: p.name,
        emotionProfile: p.emotionProfile ?? null,
        tracks: p.tracks ?? [],
        createdAt: p.createdAt.toISOString(),
        spotifyUrl: p.spotifyUrl ?? null,
        vibe: p.vibe ?? null,
        mode: p.mode ?? null,
      })),
    });
  } catch (err: any) {
    req.log.error({ err }, "Error fetching playlists");
    res.status(500).json({ error: "Failed to fetch playlists." });
  }
});

router.get("/share/:id", async (req, res): Promise<void> => {
  const playlistId = parseInt(req.params.id, 10);
  if (isNaN(playlistId)) {
    res.status(400).json({ error: "Invalid playlist id." });
    return;
  }
  try {
    const rows = await db
      .select()
      .from(savedPlaylistsTable)
      .where(eq(savedPlaylistsTable.id, playlistId))
      .limit(1);
    const playlist = rows[0];
    if (!playlist) {
      res.status(404).json({ error: "Playlist not found." });
      return;
    }
    const ep = (playlist.emotionProfile ?? {}) as {
      journeyArc?: string;
      librarySize?: number;
      timeOfDay?: string | null;
      environment?: string | null;
      nostalgia?: number;
      calm?: number;
    };
    res.json({
      id: playlist.id,
      name: playlist.name,
      vibe: playlist.vibe ?? null,
      mode: playlist.mode ?? null,
      emotionProfile: playlist.emotionProfile ?? null,
      journeyArc: ep.journeyArc ?? null,
      librarySize: ep.librarySize ?? null,
      tracks: playlist.tracks ?? [],
      trackCount: Array.isArray(playlist.tracks) ? playlist.tracks.length : 0,
      spotifyUrl: playlist.spotifyUrl ?? null,
      createdAt: playlist.createdAt.toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch playlist." });
  }
});

router.post("/playlists/:id/feedback", async (req, res): Promise<void> => {
  if (!req.session.spotifyUserId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = req.session.spotifyUserId;
  const playlistId = parseInt(req.params.id, 10);
  if (isNaN(playlistId)) {
    res.status(400).json({ error: "Invalid playlist id." });
    return;
  }

  const reaction = String(req.body?.reaction ?? "").trim();
  if (!["up", "neutral", "down"].includes(reaction)) {
    res.status(400).json({ error: "Invalid reaction. Use up, neutral, or down." });
    return;
  }

  const vibe = String(req.body?.vibe ?? "").trim().slice(0, 200);
  if (!vibe) {
    res.status(400).json({ error: "Vibe is required for feedback." });
    return;
  }

  try {
    const owned = await db
      .select({ id: savedPlaylistsTable.id })
      .from(savedPlaylistsTable)
      .where(
        and(eq(savedPlaylistsTable.id, playlistId), eq(savedPlaylistsTable.userId, userId))
      )
      .limit(1);
    if (!owned[0]) {
      res.status(404).json({ error: "Playlist not found." });
      return;
    }

    await db
      .delete(playlistFeedbackTable)
      .where(
        and(
          eq(playlistFeedbackTable.playlistId, playlistId),
          eq(playlistFeedbackTable.userId, userId)
        )
      );
    await db.insert(playlistFeedbackTable).values({ playlistId, userId, vibe, reaction });

    req.log.info({ userId, playlistId, reaction }, "Playlist feedback recorded");
    res.json({ success: true });
  } catch (err: any) {
    req.log.error({ err }, "Error saving playlist feedback");
    res.status(500).json({ error: "Failed to save feedback." });
  }
});

router.delete("/playlists/:id", async (req, res): Promise<void> => {
  if (!req.session.spotifyUserId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = req.session.spotifyUserId;
  const playlistId = parseInt(req.params.id, 10);

  if (isNaN(playlistId)) {
    res.status(400).json({ error: "Invalid playlist id." });
    return;
  }

  try {
    const deleted = await db
      .delete(savedPlaylistsTable)
      .where(and(eq(savedPlaylistsTable.id, playlistId), eq(savedPlaylistsTable.userId, userId)))
      .returning({ id: savedPlaylistsTable.id });

    if (deleted.length === 0) {
      res.status(404).json({ error: "Playlist not found." });
      return;
    }

    res.json({ success: true });
  } catch (err: any) {
    req.log.error({ err }, "Error deleting playlist");
    res.status(500).json({ error: "Failed to delete playlist." });
  }
});

export default router;
