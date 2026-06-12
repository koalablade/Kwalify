import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { HealthCheckResponse } from "../zod/api";

const router: IRouter = Router();
const HEALTH_CHECK_TIMEOUT_MS = 3_000;

async function checkDatabase(): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("database health check timed out")), HEALTH_CHECK_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

router.get("/healthz", async (_req, res) => {
  const startedAt = Date.now();
  try {
    await checkDatabase();
    const data = HealthCheckResponse.parse({ status: "ok" });
    res.json({ ...data, latencyMs: Date.now() - startedAt });
  } catch (err) {
    res.status(503).json({
      status: "error",
      dependency: "database",
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : "database health check failed",
    });
  }
});

router.get("/readyz", async (_req, res) => {
  const startedAt = Date.now();
  try {
    await checkDatabase();
    res.json({ status: "ready", database: "ok", latencyMs: Date.now() - startedAt });
  } catch (err) {
    res.status(503).json({
      status: "not_ready",
      database: "error",
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : "database readiness check failed",
    });
  }
});

export default router;
