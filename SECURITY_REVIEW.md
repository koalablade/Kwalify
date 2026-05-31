# Security Review
_Based on real code inspection._

---

## Secrets and Credentials

| Check | Status | Notes |
|---|---|---|
| No secrets in source code | **PASS** | `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SESSION_SECRET`, `DATABASE_URL` are all read from `process.env`. No hardcoded values in committed code. |
| `.env` file gitignored | **PASS** | `.gitignore` covers `.cache/` and `.local/`. No `.env` file exists in the repo. |
| Tokens not logged | **PASS** | Pino logger serializers strip query strings from URLs. Token exchange logs only `userId` and status codes — never token values. |
| Spotify tokens in session only | **PASS** | Access/refresh tokens stored server-side in the PostgreSQL session store. Never sent to the browser. |

---

## OAuth Security

| Check | Status | Notes |
|---|---|---|
| CSRF state verification | **PASS** | `randomBytes(32).toString("hex")` generated per login, stored in session before redirect, verified on callback. Mismatched state → 400 response. |
| State stored server-side | **PASS** | `req.session.oauthState` — in PostgreSQL session store, not a cookie or URL param. |
| State cleared after use | **PASS** | `delete req.session.oauthState` after successful verification. |
| OAuth error handled | **PASS** | Spotify errors redirect to `/?error=<reason>` — never crash or expose stack traces. |

---

## Session Cookies

| Check | Status | Notes |
|---|---|---|
| `httpOnly: true` | **PASS** | JavaScript cannot read the session cookie. XSS attacks cannot steal it. |
| `secure: true` in production | **PASS** | Gated on `NODE_ENV === "production"`. Cookie only sent over HTTPS when deployed. |
| `sameSite` correct | **PASS** | `"none"` in production (required for cross-origin credentialed requests through Render proxy), `"lax"` in development. |
| Session TTL | **PASS** | 7-day TTL on both cookie and PostgreSQL store. |
| Session pruning | **PASS** | `connect-pg-simple` prunes expired sessions every 60 minutes. |
| PostgreSQL session store | **PASS** | No MemoryStore in any environment. Sessions survive server restarts. |

---

## CORS

| Check | Status | Notes |
|---|---|---|
| `credentials: true` set | **PASS** | Required for session cookies to be sent cross-origin. |
| Origin restriction | **CONDITIONAL PASS** | Restricts to `FRONTEND_URL` when set. Defaults to `true` (all origins) when unset. |
| **⚠️ Risk:** FRONTEND_URL not set | **ACTION REQUIRED** | If `FRONTEND_URL` is not set in the Render environment, CORS allows all origins. Any website could make credentialed API calls to your server. **Set `FRONTEND_URL` to your production domain before going live.** |

---

## Input Validation

| Check | Status | Notes |
|---|---|---|
| Generate endpoint validated | **PASS** | `GeneratePlaylistBody` Zod schema validates `vibe` (minLength 1), `mode` (enum), `length` (10–100). |
| SQL injection | **PASS** | Drizzle ORM uses parameterized queries exclusively. No raw SQL with user input. |
| Request body size | **NOT SET** | Express default is 100kb for JSON. No explicit limit set. Low risk for current payloads. |

---

## Rate Limiting

| Check | Status | Notes |
|---|---|---|
| Generate endpoint rate limited | **PASS** | 5 requests per 60 seconds per authenticated user. Responds with 429 + `Retry-After` header. |
| Other endpoints rate limited | **NOT IMPLEMENTED** | Login, sync, history, and `/auth/me` have no rate limiting. Low risk at current scale. |
| Rate limiter persistence | **RISK** | Rate limiter uses an in-memory `Map`. Resets on server restart. A malicious user could trigger a restart to reset their limit. Acceptable for v1. |

---

## Database Security

| Check | Status | Notes |
|---|---|---|
| Connection string not logged | **PASS** | `DATABASE_URL` read from env; never passed to `logger`. |
| Session table created at startup | **PASS** | DDL uses `IF NOT EXISTS` — idempotent and safe. |
| User data isolated | **PASS** | All queries filter by `spotifyUserId` from the server-side session — not from user input. |

---

## Remaining Risks (prioritized)

### HIGH — Fix before production

1. **`FRONTEND_URL` not set = CORS open to all origins.**
   Action: Set `FRONTEND_URL=https://<your-render-domain>` in Render environment variables.

### MEDIUM — Fix when practical

2. **Rate limiter resets on server restart.**
   Action: Replace in-memory Map with Redis or PostgreSQL-backed rate limiting if abuse becomes an issue.

3. **`activeSyncs` Set is in-memory.**
   Action: If a sync is running and the server restarts, `isSyncing` in the DB stays `1` indefinitely. Add a startup cleanup query: `UPDATE sync_status SET is_syncing = 0 WHERE is_syncing = 1`.

### LOW — Acceptable for v1

4. **No rate limiting on `/api/auth/login`.**
   This could allow brute-force redirect loops. Spotify itself rate-limits OAuth, but add Express rate limiting here eventually.

5. **No request body size limit explicitly set.**
   The 100kb Express default is fine for current use.

6. **`use-mobile.tsx` hook is dead code.**
   Not a security issue — cosmetic cleanup.
