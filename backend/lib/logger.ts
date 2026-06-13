import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
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
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
