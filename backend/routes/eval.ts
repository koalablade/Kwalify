import { Router, type IRouter, type Request } from "express";
import { deploymentVersion } from "../lib/deployment-version";

const router: IRouter = Router();

function requestHeader(req: Request, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

router.get("/eval/ping", (_req, res) => {
  res.json({
    status: "ok",
    deployed: true,
    commit: deploymentVersion(),
  });
});

router.post("/eval/ping", (req, res) => {
  const expected = process.env["PLAYLIST_EVAL_TOKEN"]?.trim();
  if (!expected) {
    res.status(503).json({
      status: "error",
      evalEnabled: false,
      tokenAccepted: false,
      commit: deploymentVersion(),
      reason: "PLAYLIST_EVAL_TOKEN is not configured on this deployment.",
    });
    return;
  }

  const token = requestHeader(req, "x-eval-token");
  if (token !== expected) {
    res.status(403).json({
      status: "error",
      evalEnabled: true,
      tokenAccepted: false,
      commit: deploymentVersion(),
      reason: "Evaluation token was missing or invalid.",
    });
    return;
  }

  res.json({
    status: "ok",
    evalEnabled: true,
    tokenAccepted: true,
    commit: deploymentVersion(),
    mode: "evaluation",
  });
});

export default router;

