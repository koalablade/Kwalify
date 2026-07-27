import { Router, type IRouter } from "express";
import { db } from "../db";
import { playlistHistoryTable } from "../db";
import { eq, desc } from "drizzle-orm";
import { sendApiError } from "../lib/api-error-envelope";

const router: IRouter = Router();

router.get("/history", async (req, res): Promise<void> => {
  if (!req.session.spotifyUserId) {
    sendApiError(res, 401, "NOT_AUTHENTICATED", "Not authenticated", { requestId: String(req.id) });
    return;
  }

  const userId = req.session.spotifyUserId;

  try {
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
  } catch (err) {
    req.log.error({ err, requestId: req.id }, "Failed to load playlist history");
    sendApiError(res, 500, "HISTORY_LOAD_FAILED", "Could not load playlist history. Please try again.", { requestId: String(req.id) });
  }
});

export default router;
