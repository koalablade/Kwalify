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
import { deploymentVersion } from "../lib/deployment-version";

const router: IRouter = Router();

function requestHeader(req: Request, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function requireEvalToken(req: Request, res: Response): boolean {
  const expected = process.env["PLAYLIST_EVAL_TOKEN"]?.trim();
  if (!expected) {
    res.status(503).json({ error: "PLAYLIST_EVAL_TOKEN not configured" });
    return false;
  }
  const token = requestHeader(req, "x-eval-token");
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

export default router;
