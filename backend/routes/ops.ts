import { Router, type IRouter } from "express";
import { getGenerateOverloadState } from "../lib/runtime-overload";
import { attachGenerateQueueState, getOpsMetrics } from "../lib/ops-metrics";
import { opsMetricsTokenAuthorized } from "../lib/ops-metrics-auth";
import { sendApiError } from "../lib/api-error-envelope";

const router: IRouter = Router();

router.get("/ops/metrics", (req, res): void => {
  if (!opsMetricsTokenAuthorized(req)) {
    sendApiError(res, 403, "NOT_AUTHORIZED", "Not authorized", { requestId: String(req.id) });
    return;
  }
  const queue = getGenerateOverloadState();
  res.json(attachGenerateQueueState(queue));
});

export default router;
