# Kwalify

**Backend/API service for generating Spotify playlists from liked songs.**

The frontend has been removed. This repository currently exposes backend/API behavior only.

---

## What makes it different

| | Kwalify | Typical mood apps |
|---|---------|-------------------|
| **Music source** | Only your liked songs | Often Spotify’s catalog / Discover |
| **Input** | Natural language moments | Sliders or genres |
| **Goal** | Soundtrack a *situation* with arc and variety | “Play something chill” |

Under the hood, a deterministic emotion and scoring engine runs on the server (no external LLM for generation). Your library stays the source of truth.

---

## Features

- **Vibe intelligence** — time of day, place, motion, mixed feelings, emotional “destination” (e.g. anxious → calm)
- **Hybrid scoring** — scene fit, taste, and genre balance on a capped candidate pool (fast even with 5k–10k likes)
- **Rediscovery** — forgotten favourites, life chapters, archaeology-style prompts
- **Freshness** — cooldown on tracks you’ve recently generated so playlists don’t feel cloned
- **Strict / Balanced / Chaotic** — control how adventurous the pick is
- **Saved playlists** — history in Kwalify; Spotify playlist when creation succeeds

---

## Beta notes

Kwalify is in **public beta**. Large libraries (thousands of likes) are supported with caching and time limits; repeat prompts may return cached results for speed.

Spotify **Developer Mode** may limit who can log in until the app is fully approved — check the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) user allowlist if login fails for friends.

Feedback and bugs: open an issue here.

---

## For developers

This repo is the **Kwalify backend/API** (Node, Express, PostgreSQL, backend in `backend/`). No runtime frontend is currently present.

### Local setup

```bash
npm install
npm run build
npm start
```

Set `PORT` locally (e.g. `5000`). Render sets `PORT` in production.

### Environment variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Session cookie signing secret |
| `SPOTIFY_CLIENT_ID` | Spotify app client ID |
| `SPOTIFY_CLIENT_SECRET` | Spotify app client secret |
| `SPOTIFY_REDIRECT_URI` | OAuth callback (must match Spotify dashboard) |
| `APP_URL` | Public site URL, e.g. `https://kwalify.net` (no trailing slash) |
| `FRONTEND_URL` | CORS origins; comma-separated if you use www + apex |
| `NODE_ENV` | Use `production` on Render |

### Spotify redirect URI

In the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), add:

```
https://kwalify.net/api/auth/callback
```

Use the same value for `SPOTIFY_REDIRECT_URI`. Custom domain setup: [CUSTOM_DOMAIN.md](./CUSTOM_DOMAIN.md).

### Deploy on Render

| Setting | Value |
|---------|--------|
| **Build command** | `NPM_CONFIG_PRODUCTION=false npm install && npm run build` |
| **Start command** | `npm start` |

Attach PostgreSQL and set the environment variables above.

**Health check:** `GET /api/healthz`

### Further docs

- [Genre intelligence](./docs/GENRE_INTELLIGENCE_STACK.md) — technical genre stack overview
- [Genre taxonomy](./docs/GENRE_TAXONOMY.md) — backend genre taxonomy notes
- [Scoring hybrid](./docs/SCORING_HYBRID.md) — backend scoring notes

---

## License

Private / all rights reserved unless a license file is added to this repository.
