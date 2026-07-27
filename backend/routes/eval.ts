import { Router, type IRouter, type Request } from "express";
import { deploymentVersion } from "../lib/deployment-version";
import { normalizeEvalToken } from "../lib/eval-token-normalize";
import { expectedEvalToken, safeTokenEqual } from "../lib/eval-token";
import {
  buildFailureAnalyticsReport,
  formatFailureAnalyticsReportMarkdown,
} from "../lib/playlist-failure-analytics";
import { sendApiError } from "../lib/api-error-envelope";

const router: IRouter = Router();

function requestHeader(req: Request, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

router.get("/eval/ping", (_req, res) => {
  const expected = expectedEvalToken();
  res.json({
    status: "ok",
    deployed: true,
    commit: deploymentVersion(),
    evalConfigured: Boolean(expected),
  });
});

router.post("/eval/ping", (req, res) => {
  const expected = expectedEvalToken();
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
  if (!safeTokenEqual(token, expected)) {
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

router.get("/eval/failure-analytics/report", async (req, res): Promise<void> => {
  const expected = expectedEvalToken();
  if (!expected) {
    sendApiError(res, 503, "EVAL_NOT_CONFIGURED", "PLAYLIST_EVAL_TOKEN is not configured.", { requestId: String(req.id) });
    return;
  }
  const token = normalizeEvalToken(
    requestHeader(req, "x-kwalify-evaluation-token")
      ?? requestHeader(req, "x-eval-token"),
  );
  if (!safeTokenEqual(token, expected)) {
    sendApiError(res, 403, "EVAL_TOKEN_INVALID", "Evaluation token was missing or invalid.", { requestId: String(req.id) });
    return;
  }

  const daysRaw = req.query.days;
  const days = typeof daysRaw === "string" ? Math.min(365, Math.max(1, parseInt(daysRaw, 10) || 30)) : 30;
  const format = req.query.format === "markdown" ? "markdown" : "json";

  try {
    const report = await buildFailureAnalyticsReport({ days });
    if (format === "markdown") {
      res.type("text/markdown").send(formatFailureAnalyticsReportMarkdown(report));
      return;
    }
    res.json(report);
  } catch (err) {
    sendApiError(res, 500, "FAILURE_ANALYTICS_ERROR", "Failed to build failure analytics report.", { requestId: String(req.id) });
  }
});

export default router;

