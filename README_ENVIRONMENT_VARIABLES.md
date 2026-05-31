# Environment Variables Reference

Every variable the application reads, where to get it, and what happens without it.

---

## Required — Server will not start without these

### `DATABASE_URL`
- **What it does:** PostgreSQL connection string. Used by Drizzle ORM (all DB queries) and `connect-pg-simple` (session storage).
- **Where to get it:** On Render: create a PostgreSQL database → copy the "External Database URL" or "Internal Database URL" (use Internal if API server is on Render too).
- **Example:** `postgresql://user:password@hostname:5432/kwalify_db`
- **Required:** Yes — server throws `Error: DATABASE_URL environment variable is required` on startup if missing.

### `SESSION_SECRET`
- **What it does:** Secret key used to sign session cookies. If this changes, all existing sessions are invalidated (users must log in again).
- **Where to get it:** Generate a random string: `openssl rand -hex 32` or any password generator set to 64 characters.
- **Example:** `a3f8c21d9e7b4056...` (64-char hex string)
- **Required:** Yes — server throws `Error: SESSION_SECRET environment variable is required` on startup if missing.
- **Warning:** Never reuse across environments. Never commit to version control.

### `SPOTIFY_CLIENT_ID`
- **What it does:** Identifies your Spotify application to the Spotify OAuth API.
- **Where to get it:** [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) → select your app → Settings → Client ID.
- **Example:** `53ced0e3c0e847bda87a3cfe71656996`
- **Required:** Yes — OAuth login fails silently without it.

### `SPOTIFY_CLIENT_SECRET`
- **What it does:** Authenticates your Spotify application when exchanging OAuth codes for access tokens.
- **Where to get it:** Same place as Client ID — click "Show client secret".
- **Example:** `822e7ed2cf104dbf965d306a6ebe9fa7`
- **Required:** Yes — token exchange fails without it.
- **Warning:** Treat like a password. Never log or expose in client-side code.

---

## Required at Runtime — Provided automatically by Render

### `PORT`
- **What it does:** Port number the Express server binds to.
- **Where to get it:** Render injects this automatically. You do not set it.
- **Example:** `10000`
- **Required:** Yes — server throws on startup if missing. Render always provides it.

### `NODE_ENV`
- **What it does:** Controls security settings. When set to `production`:
  - Session cookies use `secure: true` (HTTPS only)
  - Session cookies use `sameSite: "none"` (cross-origin support)
- **Where to get it:** Set manually in Render environment variables.
- **Example:** `production`
- **Required:** Technically optional (defaults to development behavior), but **must be set to `production` on Render** or session cookies won't work over HTTPS.

---

## Optional — Has safe defaults, but set for production

### `SPOTIFY_REDIRECT_URI`
- **What it does:** The callback URL Spotify redirects to after login. Must exactly match what's registered in the Spotify Developer Dashboard.
- **Default behavior:** If not set, the server auto-detects from `REPLIT_DOMAINS` env var (Replit only) or the request `Host` header. On Render, the Host header may not match your production domain reliably — **set this explicitly**.
- **Example:** `https://kwalify.onrender.com/api/auth/callback`
- **Required:** Strongly recommended in production. Optional on Replit (auto-detected).

### `FRONTEND_URL`
- **What it does:** CORS `origin` setting. Restricts which origins can make credentialed API requests.
- **Default behavior:** If not set, CORS allows **all origins** (`origin: true`). This is a security risk in production.
- **Example:** `https://kwalify.onrender.com`
- **Required:** Optional technically, but **should always be set in production** to prevent cross-origin credential theft.
- **Multiple origins:** Comma-separate them: `https://kwalify.onrender.com,https://www.kwalify.com`

---

## Not Used — Do NOT set these expecting them to do anything

| Variable | Status |
|---|---|
| `OPENAI_API_KEY` | **Not used.** The emotion engine (`lib/emotion.ts`) is fully rule-based (keyword matching + weighted scoring). No AI API calls are made. |
| `ANTHROPIC_API_KEY` | **Not used.** |
| `REDIS_URL` | **Not used.** Rate limiting and sync state use in-memory Maps. |

---

## Full Required List for Render

Copy this list when setting environment variables in the Render dashboard:

```
DATABASE_URL=postgresql://...
SESSION_SECRET=<64-char random hex>
SPOTIFY_CLIENT_ID=<from Spotify dashboard>
SPOTIFY_CLIENT_SECRET=<from Spotify dashboard>
SPOTIFY_REDIRECT_URI=https://<your-render-domain>/api/auth/callback
FRONTEND_URL=https://<your-render-domain>
NODE_ENV=production
```
