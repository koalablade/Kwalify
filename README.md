# Kwalify — Spotify Emotional AI DJ

Spotify OAuth, liked-song sync, emotion-based playlist generation, and playlist history. Backend API only in this repo.

## Setup

```bash
npm install
npm run build
npm start
```

Set `PORT` locally (e.g. `5000`). Render sets `PORT` automatically.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Session cookie signing secret |
| `SPOTIFY_CLIENT_ID` | Spotify app client ID |
| `SPOTIFY_CLIENT_SECRET` | Spotify app client secret |
| `SPOTIFY_REDIRECT_URI` | OAuth callback (must match Spotify dashboard) |
| `FRONTEND_URL` | CORS origin for your frontend |
| `NODE_ENV` | Use `production` on Render |

## Spotify setup

In [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), add this **Redirect URI**:

```
https://YOUR-RENDER-URL.onrender.com/api/auth/callback
```

Set the same value as `SPOTIFY_REDIRECT_URI` in Render.

## Deploy (Render)

| Setting | Value |
|---------|--------|
| **Build command** | `NPM_CONFIG_PRODUCTION=false npm install && npm run build` |
| **Start command** | `npm start` |

Attach a PostgreSQL database and add the environment variables above.

## Notes

- Uses PostgreSQL for app data and sessions (`connect-pg-simple`)
- Requires Spotify OAuth
- Emotion engine runs locally (no external AI API)

## Health check

`GET /api/healthz` on your service URL after deploy.
