/**
 * Purpose: Spotify OAuth routes — login, callback, logout, and session check.
 * Responsibilities:
 *   - GET /api/auth/login    — redirect to Spotify authorization page
 *   - GET /api/auth/callback — exchange code for tokens, create session
 *   - POST /api/auth/logout  — destroy session
 *   - GET /api/auth/me       — return current authenticated user
 * Dependencies: spotify lib, express-session
 */
import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import { getAuthUrl, exchangeCode, getSpotifyUser, getValidAccessToken } from "../lib/spotify";
import { getFeatures } from "../lib/env";
import { db, syncStatusTable } from "../db";
import { eq } from "drizzle-orm";
import { runSync, activeSyncs } from "./spotify";
import { recordSyncFailure } from "../lib/ops-metrics";
import { logger } from "../lib/logger";
import { getPublicBaseUrl } from "../lib/public-url";
import { deleteUserData } from "../lib/delete-user-data";
import { pool } from "../lib/pg-pool";

const router: IRouter = Router();

/** Where to send the browser after OAuth (your public site). */
function getFrontendRedirect(path = "/"): string {
  const base = getPublicBaseUrl();
  if (!base) {
    return path;
  }
  return path === "/" ? base : `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Returns the registered SPOTIFY_REDIRECT_URI from the features singleton.
 * Only callable after requireSpotify() has confirmed Spotify is enabled, which
 * means the discriminated union narrows to { enabled: true } and redirectUri
 * is a typed string — no process.env access or unsafe cast needed.
 */
function getRedirectUri(): string {
  const feat = getFeatures();
  if (!feat.spotify.enabled) {
    throw new Error("[auth] getRedirectUri() called when Spotify is disabled");
  }
  return feat.spotify.redirectUri;
}

/** Returns false and sends 503 if Spotify credentials were not provided at startup. */
function requireSpotify(res: any): boolean {
  if (getFeatures().devMode.useMockSpotify) {
    res.status(503).json({ error: "Spotify auth is disabled in mock dev mode." });
    return false;
  }
  if (!getFeatures().spotify.enabled) {
    res.status(503).json({ error: "Spotify is not configured on this server." });
    return false;
  }
  return true;
}

router.get("/auth/login", (req, res): void => {
  if (!requireSpotify(res)) return;
  const redirectUri = getRedirectUri();

  const state = randomBytes(32).toString("hex");
  req.session.oauthState = state;

  req.log.info({ statePrefix: state.slice(0, 8) }, "OAuth login — state stored");

  req.session.save((err) => {
    if (err) {
      req.log.error({ err }, "Failed to save session before OAuth redirect");
      res.status(500).json({ error: "Session error. Please try again." });
      return;
    }
    req.log.info({ redirectUri }, "OAuth login — redirecting to Spotify");
    const url = getAuthUrl(redirectUri, state);
    res.redirect(url);
  });
});

router.get("/auth/callback", async (req, res): Promise<void> => {
  if (!requireSpotify(res)) return;
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
    res.redirect(getFrontendRedirect("/?error=session_failed"));
    return;
  }

  delete req.session.oauthState;

  try {
    const redirectUri = getRedirectUri();
    const tokens = await exchangeCode(String(code), redirectUri);
    const user = await getSpotifyUser(tokens.accessToken);

    const persistOAuthSession = (): void => {
      req.session.spotifyTokens = tokens;
      req.session.spotifyUserId = user.id;
      req.session.spotifyDisplayName = user.display_name ?? user.id;
      req.session.spotifyEmail = user.email ?? null;
      req.session.spotifyAvatarUrl = user.images?.[0]?.url ?? null;
      req.session.spotifyCountry = user.country ?? null;

      req.log.info({ spotifyUserId: user.id }, "Spotify OAuth successful");

      req.session.save((saveErr) => {
        if (saveErr) {
          req.log.error({ err: saveErr }, "Failed to save session after OAuth");
          res.redirect(getFrontendRedirect("/?error=session_failed"));
          return;
        }
        res.redirect(getFrontendRedirect("/"));
      });

      // Auto-sync on first login — never block redirect on DB work
      void (async () => {
        try {
          const [syncStatus] = await db
            .select()
            .from(syncStatusTable)
            .where(eq(syncStatusTable.spotifyUserId, user.id));

          const neverSynced =
            !syncStatus ||
            (syncStatus.totalTracks === 0 && syncStatus.lastSyncedAt === null);

          if (neverSynced && !activeSyncs.has(user.id)) {
            req.log.info({ userId: user.id }, "Auto-syncing on first login");
            await db
              .insert(syncStatusTable)
              .values({ spotifyUserId: user.id, isSyncing: 1, totalTracks: 0 })
              .onConflictDoUpdate({
                target: syncStatusTable.spotifyUserId,
                set: { isSyncing: 1, syncProgress: 0, updatedAt: new Date() },
              });
            activeSyncs.add(user.id);
            runSync(user.id, tokens).catch((err) => {
              recordSyncFailure({ userId: user.id, phase: "oauth_auto_sync", message: err instanceof Error ? err.message : String(err) });
              logger.error({ err, userId: user.id }, "Background auto-sync failed");
            });
          }
        } catch (autoSyncErr) {
          req.log.warn({ err: autoSyncErr }, "Auto-sync check failed — continuing");
        }
      })();
    };

    req.session.regenerate((regenerateErr) => {
      if (regenerateErr) {
        req.log.error({ err: regenerateErr }, "Failed to regenerate session after OAuth");
        res.redirect(getFrontendRedirect("/?error=session_failed"));
        return;
      }
      persistOAuthSession();
    });
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

router.delete("/auth/account", async (req, res): Promise<void> => {
  const userId = req.session.spotifyUserId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  try {
    const result = await deleteUserData(userId, pool);
    req.session.destroy((err) => {
      if (err) {
        req.log.error({ err, userId }, "Account data deleted but session destroy failed");
        res.status(500).json({ error: "Account data deleted, but logout failed. Clear cookies and try again." });
        return;
      }
      res.json({
        success: true,
        message: "Your Kwalify data has been deleted.",
        deletedPlaylists: result.deletedPlaylists,
      });
    });
  } catch (err) {
    req.log.error({ err, userId }, "Account deletion failed");
    res.status(500).json({ error: "Could not delete account data. Please try again." });
  }
});

router.get("/auth/me", async (req, res): Promise<void> => {
  if (getFeatures().devMode.useMockSpotify) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (!requireSpotify(res)) return;

  // Session exists but tokens missing — still authenticated for session checks.
  if (req.session.spotifyUserId) {
    if (req.session.spotifyTokens) {
      try {
        const freshTokens = await getValidAccessToken(
          req.session.spotifyTokens,
          req.session.spotifyUserId,
        );
        if (freshTokens.accessToken !== req.session.spotifyTokens.accessToken) {
          req.session.spotifyTokens = freshTokens;
        }
      } catch (err) {
        req.log.warn({ err, userId: req.session.spotifyUserId }, "Token refresh failed — serving session user");
        res.json({
          id: req.session.spotifyUserId,
          displayName: req.session.spotifyDisplayName,
          email: req.session.spotifyEmail ?? null,
          avatarUrl: req.session.spotifyAvatarUrl ?? null,
          country: req.session.spotifyCountry ?? null,
          reauthRequired: true,
        });
        return;
      }
    }
    res.json({
      id: req.session.spotifyUserId,
      displayName: req.session.spotifyDisplayName,
      email: req.session.spotifyEmail ?? null,
      avatarUrl: req.session.spotifyAvatarUrl ?? null,
      country: req.session.spotifyCountry ?? null,
    });
    return;
  }

  res.status(401).json({ error: "Not authenticated" });
});

export default router;
