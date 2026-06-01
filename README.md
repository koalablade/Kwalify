# Kwalify

**An AI DJ that builds Spotify playlists from your liked songs — using your words, not Spotify’s recommendations.**

Describe a moment in plain English. Kwalify reads your vibe, scores your library, and creates a playlist you can open in Spotify. Every track comes from songs you already saved.

**Live app:** [kwalify.net](https://kwalify.net)

---

## What it does

Kwalify is built for real situations, not generic moods:

- *“Late-night drive home after seeing old friends — nostalgic but I want calm, not sad.”*
- *“Gym session, high energy, nothing sleepy.”*
- *“Surface stuff I forgot I loved from my library.”*

You type the vibe. Kwalify handles scene, emotion, pacing, genre balance, and rediscovery — then saves the playlist to your account (and to Spotify when the API allows).

---

## How to use it

1. **Log in with Spotify** and **sync your liked songs** (full sync works best for large libraries).
2. **Describe your vibe** — a sentence beats a single word. Use a quick preset or write your own.
3. **Choose length and mode** (Strict / Balanced / Chaotic), hit **Generate**, and open the playlist in Spotify.

Optional: paste a **reference playlist** link to bias energy and feel without copying its tracks.

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

Feedback and bugs: use the in-app link or open an issue here.

---

## For developers

This repo is the **Kwalify web app and API** (Node, Express, PostgreSQL, static UI in `artifacts/api-server/public/`).

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

- [Product promise](./docs/PRODUCT_PROMISE.md) — what the engine is trying to honour
- [Kwalify V2 capabilities](./docs/KWALIFY_V2.md) — rediscovery, chapters, surprise mix
- [Genre intelligence](./docs/GENRE_INTELLIGENCE_STACK.md) — technical genre stack overview

---

## License

Private / all rights reserved unless a license file is added to this repository.
