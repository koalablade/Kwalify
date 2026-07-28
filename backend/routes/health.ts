import { Router, type IRouter, type Request, type Response } from "express";
import { getRuntimeReadiness, isRuntimeReady } from "../lib/runtime-readiness";
import { deploymentVersion } from "../lib/deployment-version";
import { pipelineDeploymentFingerprint } from "../lib/pipeline-authority/deployment-fingerprint";
import { isShuttingDown } from "../lib/shutdown";
import { pool } from "../lib/pg-pool";
import { getFeatures } from "../lib/env";
import { getGenerateOverloadState } from "../lib/runtime-overload";
import { captureError } from "../lib/error-tracking";

const router: IRouter = Router();

/** Ultra-light liveness — no DB, no Zod, no external I/O. Use for watchdogs. */
function liveHandler(_req: Request, res: Response): void {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ status: "ok" });
}

router.get("/livez", liveHandler);

/** Lightweight process health — in-memory only; safe under generation load. */
router.get("/healthz", (_req, res) => {
  const startedAt = Date.now();
  const generate = getGenerateOverloadState();
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    status: "ok",
    latencyMs: Date.now() - startedAt,
    readiness: getRuntimeReadiness().state,
    generate: {
      active: generate.active,
      queued: generate.queued,
      limit: generate.limit,
    },
  });
});

/** Bounded live database probe — never throws, resolves false on error/timeout. */
async function checkDatabase(timeoutMs = 2_000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("db probe timeout")), timeoutMs);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function checkSpotifyConfigured(): boolean {
  try {
    return getFeatures().spotify.enabled;
  } catch {
    return false;
  }
}

async function readinessHandler(_req: Request, res: Response): Promise<void> {
  const startedAt = Date.now();
  const readiness = getRuntimeReadiness();
  const pipelineAuthority = pipelineDeploymentFingerprint();

  const runtimeReady = isRuntimeReady();
  const generate = getGenerateOverloadState();
  const generationBusy = generate.active > 0 || generate.queued > 0;
  const dbProbeTimeoutMs = generationBusy ? 5_000 : 2_000;
  const databaseProbeOk = runtimeReady ? await checkDatabase(dbProbeTimeoutMs) : false;
  // Active generation proves the DB is usable even if a concurrent probe times out.
  const databaseAvailable = databaseProbeOk || generationBusy;
  const spotifyConfigured = checkSpotifyConfigured();
  const pipelineAvailable = runtimeReady && pipelineAuthority.pipelineAuthorityEnabled !== false;
  const poolWaitingCount = typeof pool.waitingCount === "number" ? pool.waitingCount : 0;
  const defaultPoolMax = process.env["KWALIFY_HOST_MODE"] === "selfhost" ? "15" : "10";
  const poolMax = Number.parseInt(process.env["DB_POOL_MAX"] ?? process.env["PG_POOL_MAX"] ?? defaultPoolMax, 10);
  // During playlist generation the DB pool is legitimately busy — do not mark unhealthy.
  const poolSaturated = poolWaitingCount > Math.max(poolMax + 2, 12) && !generationBusy;

  const shuttingDown = isShuttingDown();
  const ready = runtimeReady && databaseAvailable && !poolSaturated && !shuttingDown;

  res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "not_ready",
    reason: shuttingDown
      ? "shutting_down"
      : poolSaturated
        ? "db_pool_saturated"
        : generationBusy && !databaseProbeOk
          ? "generation_busy"
          : undefined,
    readiness: readiness.state,
    shuttingDown: isShuttingDown(),
    checks: {
      databaseAvailable,
      databaseProbeOk,
      spotifyConfigured,
      pipelineAvailable,
      poolSaturated,
      poolWaitingCount,
      generationBusy,
      generateActive: generate.active,
      generateQueued: generate.queued,
    },
    uptimeMs: readiness.uptimeMs,
    readyAt: readiness.readyAt,
    failedAt: readiness.failedAt,
    error: readiness.error,
    commit: deploymentVersion(),
    pipelineAuthority: {
      enabled: pipelineAuthority.pipelineAuthorityEnabled,
      version: pipelineAuthority.pipelineAuthorityVersion,
      buildTimestamp: pipelineAuthority.buildTimestamp,
    },
    latencyMs: Date.now() - startedAt,
  });
}

router.get("/readyz", (req, res) => {
  void readinessHandler(req, res).catch((err) => {
    captureError(err, { source: "readyz", path: req.path });
    if (!res.headersSent) {
      res.status(503).json({
        status: "not_ready",
        error: "readiness_check_failed",
        readiness: getRuntimeReadiness().state,
      });
    }
  });
});

// Alias — some orchestrators/probes expect /readiness.
router.get("/readiness", (req, res) => {
  void readinessHandler(req, res).catch((err) => {
    captureError(err, { source: "readiness", path: req.path });
    if (!res.headersSent) {
      res.status(503).json({
        status: "not_ready",
        error: "readiness_check_failed",
        readiness: getRuntimeReadiness().state,
      });
    }
  });
});

export default router;
