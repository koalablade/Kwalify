import { Router, type IRouter, type Request } from "express";
import { isLaunchMode } from "../lib/launch-mode";
import { getLaunchHealthSnapshot } from "../lib/launch-health-snapshot";
import { safeTokenEqual } from "../lib/eval-token";
import { sendApiError } from "../lib/api-error-envelope";

const router: IRouter = Router();

function isInternalRequest(req: Request): boolean {
  const expected = process.env["INTERNAL_API_TOKEN"]?.trim();
  if (!expected) return false;
  const provided = req.headers["x-internal-token"];
  return typeof provided === "string" && safeTokenEqual(provided, expected);
}

router.get("/internal/launch-health", (req, res): void => {
  if (isLaunchMode()) {
    sendApiError(res, 404, "NOT_FOUND", "Not found", { requestId: String(req.id) });
    return;
  }

  if (!isInternalRequest(req)) {
    sendApiError(res, 404, "NOT_FOUND", "Not found", { requestId: String(req.id) });
    return;
  }

  res.json(getLaunchHealthSnapshot());
});

export default router;
