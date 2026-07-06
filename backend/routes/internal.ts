import { Router, type IRouter, type Request } from "express";
import { isLaunchMode } from "../lib/launch-mode";
import { getLaunchHealthSnapshot } from "../lib/launch-health-snapshot";

const router: IRouter = Router();

function isInternalRequest(req: Request): boolean {
  const expected = process.env["INTERNAL_API_TOKEN"]?.trim();
  if (!expected) return false;
  const provided = req.headers["x-internal-token"];
  return typeof provided === "string" && provided === expected;
}

router.get("/internal/launch-health", (req, res): void => {
  if (isLaunchMode()) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (!isInternalRequest(req)) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.json(getLaunchHealthSnapshot());
});

export default router;
