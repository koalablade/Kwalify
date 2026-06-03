import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import spotifyRouter from "./spotify";
import generateRouter from "../controllers/generation.controller";
import historyRouter from "./history";
import libraryRouter from "./library";

const router: IRouter = Router();
const mountedRouteGroups = new Set<string>();

function mountRouteGroup(name: string, childRouter: IRouter): void {
  if (mountedRouteGroups.has(name)) {
    throw new Error(`[architecture] duplicate API route group registered: ${name}`);
  }
  mountedRouteGroups.add(name);
  router.use(childRouter);
}

mountRouteGroup("health", healthRouter);
mountRouteGroup("auth", authRouter);
mountRouteGroup("spotify", spotifyRouter);
mountRouteGroup("generate", generateRouter);
mountRouteGroup("history", historyRouter);
mountRouteGroup("library", libraryRouter);

export default router;
