import pino from "pino";
import { hashId } from "./pii";

const defaultLevel =
  process.env.LOG_LEVEL ??
  (process.env.KWALIFY_HOST_MODE === "selfhost"
    ? "info"
    : process.env.NODE_ENV === "production"
      ? "warn"
      : "info");

// Keys whose string values are personal identifiers: hash instead of dropping so
// activity can still be correlated across log lines without leaking the raw id.
const HASHED_ID_KEY = /^(spotifyUserId|ownerSpotifyId|spotifyUser|userId|ownerId)$/i;

export const logger = pino({
  level: defaultLevel,
  messageKey: "message",
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
    bindings(bindings) {
      return {
        pid: bindings.pid,
        hostname: bindings.hostname,
        module: "backend",
      };
    },
  },
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers['x-eval-token']",
      "req.headers['x-kwalify-evaluation-token']",
      "res.headers['set-cookie']",
      "err.config.headers.authorization",
      "err.config.headers.Authorization",
      "err.response.config.headers.authorization",
      "err.response.config.headers.Authorization",
      "err.request._header",
      "req.session.spotifyTokens.accessToken",
      "req.session.spotifyTokens.refreshToken",
      "spotifyTokens.accessToken",
      "spotifyTokens.refreshToken",
      "tokens.accessToken",
      "tokens.refreshToken",
      "accessToken",
      "refreshToken",
      "*.accessToken",
      "*.refreshToken",
      "DATABASE_URL",
      "SESSION_SECRET",
      "SPOTIFY_CLIENT_SECRET",
      "PLAYLIST_EVAL_TOKEN",
      "connectionString",
      "*.connectionString",
      "password",
      "*.password",
      "clientSecret",
      "*.clientSecret",
      // Spotify user identifiers — hashed (not dropped) by the censor below.
      "userId",
      "*.userId",
      "spotifyUserId",
      "*.spotifyUserId",
      "ownerSpotifyId",
      "*.ownerSpotifyId",
      "ownerId",
      "*.ownerId",
    ],
    censor: (value: unknown, path: string[]): unknown => {
      const key = path[path.length - 1] ?? "";
      if (typeof value === "string" && HASHED_ID_KEY.test(key)) {
        return `sha256:${hashId(value)}`;
      }
      return "[Redacted]";
    },
  },
});

export function moduleLogger(module: string): pino.Logger {
  return logger.child({ module });
}
