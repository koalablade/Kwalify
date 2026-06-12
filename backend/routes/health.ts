import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "../zod/api";
import { getRuntimeReadiness, isRuntimeReady } from "../lib/runtime-readiness";

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

router.get("/readyz", (_req, res) => {
  const startedAt = Date.now();
  const readiness = getRuntimeReadiness();
  res.status(isRuntimeReady() ? 200 : 503).json({
    status: isRuntimeReady() ? "ready" : "not_ready",
    readiness: readiness.state,
    uptimeMs: readiness.uptimeMs,
    readyAt: readiness.readyAt,
    failedAt: readiness.failedAt,
    error: readiness.error,
    latencyMs: Date.now() - startedAt,
  });
});

export default router;
