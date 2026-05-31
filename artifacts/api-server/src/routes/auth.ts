import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import { getAuthUrl, exchangeCode, getSpotifyUser, getValidAccessToken } from "../lib/spotify";

const router: IRouter = Router();

/** Where to send the browser after OAuth (your site, not the API root). */
function getFrontendRedirect(path = "/"): string {
  const base = process.env.FRONTEND_URL?.split(",")[0]?.trim();
  if (!base) {
    return path;
  }
  const normalized = base.replace(/\/$/, "");
  return path === "/" ? normalized : `${normalized}${path.startsWith("/") ? path : `/${path}`}`;
}

function getRedirectUri(req: any): string {
  if (process.env.SPOTIFY_REDIRECT_URI) {
    return process.env.SPOTIFY_REDIRECT_URI;
  }
  const domains = process.env.REPLIT_DOMAINS?.split(",")[0];
  if (domains) {
    return `https://${domains}/api/auth/callback`;
  }
  const host = req.get("host") ?? "localhost:5000";
  const proto = req.get("x-forwarded-proto") ?? req.protocol ?? "http";
  return `${proto}://${host}/api/auth/callback`;
}

router.get("/auth/login", (req, res): void => {
  const redirectUri = getRedirectUri(req);

  const state = randomBytes(32).toString("hex");
  req.session.oauthState = state;

  req.session.save((err) => {
    if (err) {
      req.log.error({ err }, "Failed to save session before OAuth redirect");
      res.status(500).json({ error: "Session error. Please try again." });
      return;
    }
    req.log.info({ redirectUri }, "Initiating Spotify OAuth");
    const url = getAuthUrl(redirectUri, state);
    res.redirect(url);
  });
});

router.get("/auth/callback", async (req, res): Promise<void> => {
  const { code, error, state: returnedState } = req.query as {
    code?: string;
    error?: string;
    state?: string;
  };

  if (error) {
    req.log.warn({ error }, "Spotify OAuth error");
    res.redirect(getFrontendRedirect(`/?error=${encodeURIComponent(String(error))}`));
    return;
  }

  if (!code) {
    res.redirect(getFrontendRedirect("/?error=no_code"));
    return;
  }

  const expectedState = req.session.oauthState;
  if (!expectedState || !returnedState || returnedState !== expectedState) {
    req.log.warn(
      { expectedState: !!expectedState, returnedState: !!returnedState, match: returnedState === expectedState },
      "OAuth state mismatch — possible CSRF attempt"
    );
    res.status(400).json({ error: "Invalid OAuth state. Please try logging in again." });
    return;
  }

  delete req.session.oauthState;

  try {
    const redirectUri = getRedirectUri(req);
    const tokens = await exchangeCode(String(code), redirectUri);
    const user = await getSpotifyUser(tokens.accessToken);

    req.session.spotifyTokens = tokens;
    req.session.spotifyUserId = user.id;
    req.session.spotifyDisplayName = user.display_name ?? user.id;
    req.session.spotifyEmail = user.email ?? null;
    req.session.spotifyAvatarUrl = user.images?.[0]?.url ?? null;
    req.session.spotifyCountry = user.country ?? null;

    req.log.info({ userId: user.id }, "Spotify OAuth successful");
    res.redirect(getFrontendRedirect("/"));
  } catch (err) {
    req.log.error({ err }, "Spotify OAuth callback failed");
    res.redirect(getFrontendRedirect("/?error=auth_failed"));
  }
});

router.post("/auth/logout", (req, res): void => {
  req.session.destroy(() => {
    res.json({ message: "Logged out successfully" });
  });
});

router.get("/auth/me", async (req, res): Promise<void> => {
  if (!req.session.spotifyTokens || !req.session.spotifyUserId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  try {
    const freshTokens = await getValidAccessToken(req.session.spotifyTokens);
    if (freshTokens.accessToken !== req.session.spotifyTokens.accessToken) {
      req.session.spotifyTokens = freshTokens;
    }

    res.json({
      id: req.session.spotifyUserId,
      displayName: req.session.spotifyDisplayName,
      email: req.session.spotifyEmail ?? null,
      avatarUrl: req.session.spotifyAvatarUrl ?? null,
      country: req.session.spotifyCountry ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get user");
    res.status(401).json({ error: "Not authenticated" });
  }
});

export default router;
