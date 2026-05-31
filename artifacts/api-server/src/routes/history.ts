import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { playlistHistoryTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/history", async (req, res): Promise<void> => {
  if (!req.session.spotifyUserId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = req.session.spotifyUserId;

  const history = await db
    .select()
    .from(playlistHistoryTable)
    .where(eq(playlistHistoryTable.spotifyUserId, userId))
    .orderBy(desc(playlistHistoryTable.createdAt))
    .limit(50);

  res.json(
    history.map((item) => ({
      id: item.id,
      playlistId: item.playlistId,
      playlistUrl: item.playlistUrl,
      name: item.name,
      vibe: item.vibe,
      mode: item.mode,
      trackCount: item.trackCount,
      createdAt: item.createdAt.toISOString(),
      emotionProfile: item.emotionProfile ?? null,
    }))
  );
});

export default router;
