import { Router, type IRouter } from "express";
import authRouter from "./auth";
import spotifyRouter from "./spotify";
import generateRouter from "../controllers/generation.controller";
import playlistCrudRouter from "../controllers/playlist-crud.controller";
import historyRouter from "./history";
import libraryRouter from "./library";
import benchmarkUiRouter from "./benchmark-ui";
import internalRouter from "./internal";

const router: IRouter = Router();
const mountedRouteGroups = new Set<string>();

function mountRouteGroup(name: string, childRouter: IRouter): void {
  if (mountedRouteGroups.has(name)) {
    throw new Error(`[architecture] duplicate API route group registered: ${name}`);
  }
  mountedRouteGroups.add(name);
  router.use(childRouter);
}

mountRouteGroup("auth", authRouter);
mountRouteGroup("spotify", spotifyRouter);
mountRouteGroup("generate", generateRouter);
mountRouteGroup("playlist-crud", playlistCrudRouter);
mountRouteGroup("history", historyRouter);
mountRouteGroup("library", libraryRouter);
mountRouteGroup("benchmark", benchmarkUiRouter);
mountRouteGroup("internal", internalRouter);

export default router;
