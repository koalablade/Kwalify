import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import spotifyRouter from "./spotify";
import generateRouter from "./generate";
import historyRouter from "./history";
import libraryRouter from "./library";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(spotifyRouter);
router.use(generateRouter);
router.use(historyRouter);
router.use(libraryRouter);

export default router;
