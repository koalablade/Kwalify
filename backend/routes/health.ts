import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { HealthCheckResponse } from "../zod/api";

const router: IRouter = Router();

router.get("/healthz", async (_req, res) => {
  try {
    await db.execute(sql`select 1`);
    const data = HealthCheckResponse.parse({ status: "ok" });
    res.json(data);
  } catch {
    res.status(503).json({ status: "error", dependency: "database" });
  }
});

router.get("/readyz", async (_req, res) => {
  try {
    await db.execute(sql`select 1`);
    res.json({ status: "ready", database: "ok" });
  } catch {
    res.status(503).json({ status: "not_ready", database: "error" });
  }
});

export default router;
