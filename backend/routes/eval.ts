import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/eval/ping", (_req, res) => {
  res.json({
    status: "ok",
    evalEnabled: !!process.env["PLAYLIST_EVAL_TOKEN"]?.trim(),
  });
});

export default router;

