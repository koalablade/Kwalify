import { Router, type IRouter, type Request, type Response } from "express";
import { HealthCheckResponse } from "../zod/api";
import { getRuntimeReadiness, isRuntimeReady } from "../lib/runtime-readiness";
import { deploymentVersion } from "../lib/deployment-version";
import { pipelineDeploymentFingerprint } from "../lib/pipeline-authority/deployment-fingerprint";
import { isShuttingDown } from "../lib/shutdown";
import { pool } from "../lib/pg-pool";
import { getFeatures } from "../lib/env";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const startedAt = Date.now();
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json({
    ...data,
    latencyMs: Date.now() - startedAt,
    readiness: getRuntimeReadiness().state,
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
  const databaseAvailable = runtimeReady ? await checkDatabase() : false;
  const spotifyConfigured = checkSpotifyConfigured();
  const pipelineAvailable = runtimeReady && pipelineAuthority.pipelineAuthorityEnabled !== false;

  // Spotify is required for generation but not for liveness; a missing Spotify
  // config should surface loudly without necessarily failing readiness during a
  // deploy. Database + runtime are the hard gates.
  const ready = runtimeReady && databaseAvailable;

  res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "not_ready",
    readiness: readiness.state,
    shuttingDown: isShuttingDown(),
    checks: {
      databaseAvailable,
      spotifyConfigured,
      pipelineAvailable,
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
  void readinessHandler(req, res);
});

// Alias — some orchestrators/probes expect /readiness.
router.get("/readiness", (req, res) => {
  void readinessHandler(req, res);
});

export default router;
