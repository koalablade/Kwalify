import pino from "pino";

const defaultLevel =
  process.env.LOG_LEVEL ??
  (process.env.NODE_ENV === "production" ? "warn" : "info");

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
  redact: [
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
  ],
});

export function moduleLogger(module: string): pino.Logger {
  return logger.child({ module });
}
