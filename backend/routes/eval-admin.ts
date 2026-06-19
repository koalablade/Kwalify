/**
 * Eval admin routes — alias review, taste graph explorer (token-protected).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "../lib/pg-pool";
import {
  listPendingAliasPromotions,
  approveAliasPromotion,
  rejectAliasPromotion,
  queueHarvestedAliasesForReview,
} from "../lib/alias-promotion-store";
import { loadTasteGraphV2 } from "../lib/taste-graph-v2";
import { loadGlobalTasteProfile } from "../lib/global-taste-profile";
import { matchCultureEntities, warmSceneCultureCache } from "../lib/scene-culture-graph";
import { refreshLiveTrends } from "../lib/trend-ingestion-live";
import { getSessionSnapshotCacheStats } from "../core/cache/session-snapshot-cache";
import { deploymentVersion } from "../lib/deployment-version";
import { normalizeEvalToken } from "../lib/eval-token-normalize";

const router: IRouter = Router();

function requestHeader(req: Request, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function requireEvalToken(req: Request, res: Response): boolean {
  const expected = normalizeEvalToken(process.env["PLAYLIST_EVAL_TOKEN"]);
  if (!expected) {
    res.status(503).json({ error: "PLAYLIST_EVAL_TOKEN not configured" });
    return false;
  }
  const token = normalizeEvalToken(
    requestHeader(req, "x-kwalify-evaluation-token")
      ?? requestHeader(req, "x-eval-token"),
  );
  if (token !== expected) {
    res.status(403).json({ error: "Invalid evaluation token" });
    return false;
  }
  return true;
}

router.get("/eval/admin/alias-queue", async (req, res) => {
  if (!requireEvalToken(req, res)) return;
  const pending = await listPendingAliasPromotions();
  res.json({ commit: deploymentVersion(), pending, count: pending.length });
});

router.post("/eval/admin/alias-queue/harvest", async (req, res) => {
  if (!requireEvalToken(req, res)) return;
  const queued = await queueHarvestedAliasesForReview(pool as unknown as import("pg").Pool);
  res.json({ commit: deploymentVersion(), queued, count: queued.length });
});

router.post("/eval/admin/alias-queue/:term/approve", async (req, res) => {
  if (!requireEvalToken(req, res)) return;
  const term = String(req.params.term ?? "");
  const row = await approveAliasPromotion(term);
  if (!row) {
    res.status(404).json({ error: "Alias promotion not found" });
    return;
  }
  res.json({ commit: deploymentVersion(), approved: row });
});

router.post("/eval/admin/alias-queue/:term/reject", async (req, res) => {
  if (!requireEvalToken(req, res)) return;
  const term = String(req.params.term ?? "");
  const row = await rejectAliasPromotion(term);
  if (!row) {
    res.status(404).json({ error: "Alias promotion not found" });
    return;
  }
  res.json({ commit: deploymentVersion(), rejected: row });
});

router.get("/eval/admin/taste-graph/:userId", async (req, res) => {
  if (!requireEvalToken(req, res)) return;
  const userId = String(req.params.userId ?? "");
  const [graph, globalTaste] = await Promise.all([
    loadTasteGraphV2(userId),
    loadGlobalTasteProfile(userId),
  ]);
  res.json({ commit: deploymentVersion(), userId, graph, globalTaste });
});

router.get("/eval/admin/culture-match", async (req, res) => {
  if (!requireEvalToken(req, res)) return;
  const prompt = typeof req.query.prompt === "string" ? req.query.prompt : "";
  await warmSceneCultureCache();
  const matches = prompt ? matchCultureEntities(prompt) : [];
  res.json({ commit: deploymentVersion(), prompt, matches });
});

router.get("/eval/admin/trends", async (req, res) => {
  if (!requireEvalToken(req, res)) return;
  const trends = await refreshLiveTrends(req.query.refresh === "1");
  res.json({ commit: deploymentVersion(), trends });
});

/** Best synced library for CI smoke / live coherence regression. */
router.get("/eval/admin/smoke-spotify-user-id", async (req, res) => {
  if (!requireEvalToken(req, res)) return;
  const result = await pool.query<{ spotify_user_id: string; total_tracks: number | null }>(
    `SELECT spotify_user_id, total_tracks
     FROM sync_status
     ORDER BY total_tracks DESC NULLS LAST, updated_at DESC NULLS LAST
     LIMIT 5`,
  );
  const candidates = result.rows.map((row) => ({
    spotifyUserId: row.spotify_user_id,
    totalTracks: row.total_tracks ?? 0,
  }));
  res.json({
    commit: deploymentVersion(),
    recommended: candidates[0]?.spotifyUserId ?? null,
    candidates,
    hint: "Set GitHub secret SMOKE_SPOTIFY_USER_ID to recommended (not your GitHub username).",
  });
});

router.get("/eval/admin/observability", async (req, res) => {
  if (!requireEvalToken(req, res)) return;
  res.json({
    commit: deploymentVersion(),
    sessionSnapshotCache: getSessionSnapshotCacheStats(),
    runtime: {
      nodeEnv: process.env.NODE_ENV ?? "development",
      generateConcurrencyLimit: process.env.GENERATE_CONCURRENCY_LIMIT ?? null,
      jsonBodyLimit: process.env.JSON_BODY_LIMIT ?? "64kb",
    },
  });
});

router.get("/eval/admin/intent-survival-aggregates", async (req, res) => {
  if (!requireEvalToken(req, res)) return;
  const result = await pool.query<{ playlist_count: string }>(
    `SELECT COUNT(*)::text AS playlist_count
     FROM saved_playlists
     WHERE created_at > NOW() - INTERVAL '30 days'`,
  );
  const feedback = await pool.query<{ reaction: string; count: string }>(
    `SELECT reaction, COUNT(*)::text AS count
     FROM playlist_feedback
     WHERE created_at > NOW() - INTERVAL '30 days'
     GROUP BY reaction`,
  );
  const row = result.rows[0];
  res.json({
    commit: deploymentVersion(),
    windowDays: 30,
    playlistCount: Number(row?.playlist_count ?? 0),
    playlistFeedbackByReaction: Object.fromEntries(
      feedback.rows.map((r) => [r.reaction, Number(r.count)]),
    ),
  });
});

export default router;
