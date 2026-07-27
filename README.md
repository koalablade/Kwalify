# Kwalify

**Generate Spotify playlists from your liked songs — describe the moment, get the mix.**

Kwalify is a full-stack web app: static frontend in `frontend/public/`, API in `backend/`, deployed as one service on Render.

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

This repo is the **Kwalify app** (Node, Express, PostgreSQL, static frontend).

## Hosting model

| Environment | How to run | Spotify OAuth |
|-------------|------------|---------------|
| **Local Windows (primary)** | `start-kwalify.bat` → `https://kwalify.net` | `https://kwalify.net/api/auth/callback` |
| **Self-hosted beta (your PC)** | `setup-self-host.ps1` then `start-kwalify-selfhost.bat` | Your public URL + `/api/auth/callback` |
| **Render (optional prod)** | `render.yaml` blueprint | Same redirect URI on public domain |
| **Debug only** | `start-kwalify.bat local` → `http://localhost:5000` | Not supported (Spotify blocks localhost) |

CI nightly eval workflows target production `https://kwalify.net` on Render when deployed. Local dev does not need Render.

`start-kwalify.bat` auto-pulls, rebuilds when code changed, and restarts the API every time. Create `.kwalify-nopull` to skip git pull.

### Local setup (Windows — recommended)

1. Read **[FIRST-TIME-SETUP.txt](./FIRST-TIME-SETUP.txt)**
2. Double-click **`start-kwalify.bat`** (or Desktop shortcut via `create-kwalify-shortcuts.bat`)
3. Open **https://kwalify.net** in your browser

Stop: **`stop-kwalify.bat`**

Spotify redirect URI (required): `https://kwalify.net/api/auth/callback`

Flags (optional): `build` force rebuild, `nopull` skip git pull, `quick` skip restart if already running.

**Benchmarks:** one file `start-kwalify-benchmark.bat` (Desktop: **Kwalify Benchmark**) — menu covers smoke, tiers, large run, status, and zip. See [FIRST-TIME-SETUP.txt](./FIRST-TIME-SETUP.txt).

### Local setup (manual)

```bash
npm ci
npm run build
npm start
```

Use Node **20.x** (see `.nvmrc`). Quick check: `npm run test:smoke`

For HTTPS + Spotify locally on Windows, prefer `start-kwalify.bat` over raw `npm start` — see [docs/deployment.md](./docs/deployment.md).

Set `PORT` locally (default `5000`).

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
| **Build command** | `rm -rf node_modules && npm cache clean --force && npm ci --include=dev --cache /tmp/npm-cache --prefer-online && npm run build` |
| **Start command** | `npm start` |

Attach PostgreSQL and set the environment variables above.

**Health check:** `GET /api/healthz`

### Further docs

- [FIRST-TIME-SETUP.txt](./FIRST-TIME-SETUP.txt) — Windows local hosting (start/stop bats)
- [docs/deployment.md](./docs/deployment.md) — local + Render deploy
- [docs/environment-variables.md](./docs/environment-variables.md) — full env reference
- [Genre intelligence](./docs/GENRE_INTELLIGENCE_STACK.md) — technical genre stack overview
- [Genre taxonomy](./docs/GENRE_TAXONOMY.md) — backend genre taxonomy notes
- [Scoring hybrid](./docs/SCORING_HYBRID.md) — backend scoring notes

---

## License

Private / all rights reserved unless a license file is added to this repository.
