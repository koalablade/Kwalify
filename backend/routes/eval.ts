import { Router, type IRouter, type Request } from "express";
import { deploymentVersion } from "../lib/deployment-version";
import { normalizeEvalToken } from "../lib/eval-token-normalize";

const router: IRouter = Router();

function requestHeader(req: Request, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

router.get("/eval/ping", (_req, res) => {
  const expected = normalizeEvalToken(process.env["PLAYLIST_EVAL_TOKEN"]);
  res.json({
    status: "ok",
    deployed: true,
    commit: deploymentVersion(),
    evalConfigured: Boolean(expected),
    evalTokenLength: expected.length,
  });
});

router.post("/eval/ping", (req, res) => {
  const expected = normalizeEvalToken(process.env["PLAYLIST_EVAL_TOKEN"]);
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

  const token = normalizeEvalToken(
    requestHeader(req, "x-kwalify-evaluation-token")
      ?? requestHeader(req, "x-eval-token"),
  );
  if (token !== expected) {
    res.status(403).json({
      status: "error",
      evalEnabled: true,
      tokenAccepted: false,
      commit: deploymentVersion(),
      reason: "Evaluation token was missing or invalid.",
      hint: {
        expectedLength: expected.length,
        receivedLength: token.length,
      },
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

