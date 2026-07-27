import { Router, type IRouter } from "express";
import { getGenerateOverloadState } from "../lib/runtime-overload";
import { attachGenerateQueueState, getOpsMetrics } from "../lib/ops-metrics";
import { opsMetricsTokenAuthorized } from "../lib/ops-metrics-auth";

const router: IRouter = Router();

router.get("/ops/metrics", (req, res): void => {
  if (!opsMetricsTokenAuthorized(req)) {
    res.status(403).json({ error: "Not authorized" });
    return;
  }
  const queue = getGenerateOverloadState();
  res.json(attachGenerateQueueState(queue));
});

export default router;
