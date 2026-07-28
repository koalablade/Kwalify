import { Router, type IRouter } from "express";
import { getGenerateOverloadState } from "../lib/runtime-overload";
import { attachGenerateQueueState, getOpsMetrics } from "../lib/ops-metrics";
import { opsMetricsTokenAuthorized } from "../lib/ops-metrics-auth";
import { sendApiError } from "../lib/api-error-envelope";
import { getRuntimeReadiness } from "../lib/runtime-readiness";

const router: IRouter = Router();

function buildOpsDashboard(queue: ReturnType<typeof getGenerateOverloadState>) {
  const metrics = attachGenerateQueueState(queue);
  const ext = metrics.extended;
  const cache = ext.sessionSnapshotCache;
  const cacheHitRate =
    cache.hits + cache.misses > 0
      ? Math.round((cache.hits / (cache.hits + cache.misses)) * 1000) / 10
      : null;
  const totalPhase = ext.generationPhases.byPhase["generate.total"];

  return {
    generatedAt: metrics.generatedAt,
    uptimeMs: getRuntimeReadiness().uptimeMs,
    generations: {
      active: queue.active,
      queued: queue.queued,
      limit: queue.limit,
      queueLimit: queue.queueLimit,
      averageLatencyMs: queue.averageLatencyMs,
      avgTotalMs: totalPhase?.p50Ms ?? null,
      p95TotalMs: totalPhase?.p95Ms ?? ext.generationPhases.p95Ms,
      failuresTotal: ext.generateOutcomes.failureTotal,
      failuresLastHour: ext.generateOutcomes.failureLastHour,
      successesTotal: ext.generateOutcomes.successTotal,
      successesLastHour: ext.generateOutcomes.successLastHour,
    },
    spotify: {
      failuresTotal: ext.spotifyApi.failures,
      requestsTotal: ext.spotifyApi.totalRequests,
      rateLimitResponses: ext.spotifyApi.rateLimitResponses,
      retries: ext.spotifyApi.retries,
    },
    memory: {
      heapUsedMb: Math.round(ext.memory.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(ext.memory.heapTotal / 1024 / 1024),
      rssMb: Math.round(ext.memory.rss / 1024 / 1024),
    },
    cache: {
      hitRatePercent: cacheHitRate,
      hits: cache.hits,
      misses: cache.misses,
      evictions: cache.evictions,
    },
    requestsPerMinute: ext.requestsPerMinute,
    serverBusyLastHour: metrics.serverBusy.lastHour,
    syncFailuresLastHour: metrics.syncFailures.lastHour,
    alerts: metrics.alerts.slice(0, 10),
    full: metrics,
  };
}

/** Public aggregate summary — no user data, safe for /status page. */
router.get("/ops/summary", (_req, res): void => {
  const queue = getGenerateOverloadState();
  const dashboard = buildOpsDashboard(queue);
  res.json({
    generatedAt: dashboard.generatedAt,
    uptimeMs: dashboard.uptimeMs,
    generations: dashboard.generations,
    spotify: dashboard.spotify,
    memory: dashboard.memory,
    cache: dashboard.cache,
    requestsPerMinute: dashboard.requestsPerMinute,
    serverBusyLastHour: dashboard.serverBusyLastHour,
    syncFailuresLastHour: dashboard.syncFailuresLastHour,
  });
});

router.get("/ops/metrics", (req, res): void => {
  if (!opsMetricsTokenAuthorized(req)) {
    sendApiError(res, 403, "NOT_AUTHORIZED", "Not authorized", { requestId: String(req.id) });
    return;
  }
  const queue = getGenerateOverloadState();
  res.json(buildOpsDashboard(queue));
});

export default router;
