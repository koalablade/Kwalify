# Kwalify

A context-aware Spotify playlist generator that scores and organizes a user's Liked Songs library against natural language descriptions (e.g., "late-night motorway drive"). Unlike standard recommendation engines, it focuses on **rediscovery** — using a deterministic scoring engine to create playlists with emotional arcs and genre balance, without external LLMs.

## Tech Stack

- **Runtime:** Node.js 20
- **Language:** TypeScript (compiled to `backend/dist/`)
- **Framework:** Express 5
- **Database:** PostgreSQL (Replit managed) with Drizzle ORM
- **Session:** express-session + connect-pg-simple (persisted in Postgres)
- **Frontend:** Vanilla JS (ES Modules), served statically from `frontend/public/`
- **External APIs:** Spotify Web API (OAuth 2.0, library sync, audio features)

## Project Structure

- `backend/` — Server-side TypeScript
  - `server.ts` — Bootstrap entry point (env → DB → app → listen)
  - `app.ts` — Express app factory
  - `controllers/` — Route handlers
  - `core/` — Scoring, emotion, genre, and playlist composition engines
  - `lib/` — Spotify integration, caching, utilities
  - `db/` — Drizzle ORM setup and schema
  - `routes/` — Express router definitions
- `frontend/public/` — Static frontend (HTML, CSS, JS)
- `docs/` — Architecture and flow documentation

## Running the App

```bash
npm run build   # Compile TypeScript → backend/dist/
npm start       # Run the compiled server
```

The workflow runs `npm run build && npm start` automatically.

## Required Secrets

Set these in the Replit Secrets tab:

- `DATABASE_URL` — Replit managed PostgreSQL (auto-set)
- `SESSION_SECRET` — Random string for session signing (auto-set)
- `SPOTIFY_CLIENT_ID` — From your Spotify Developer app
- `SPOTIFY_CLIENT_SECRET` — From your Spotify Developer app
- `SPOTIFY_REDIRECT_URI` — Your app's OAuth callback URL

## Optional Environment Variables

- `APP_URL` — Canonical public URL (e.g. `https://kwalify.net`) — used for CORS and redirect enforcement in production
- `FRONTEND_URL` — Comma-separated list of allowed CORS origins if frontend is on a different domain

## User Preferences

- Keep the Express + TypeScript + Drizzle stack as-is
- The bootstrap sequence in `server.ts` is intentional — do not shortcut it
- Spotify credentials are optional at boot; the app gracefully degrades (503s on Spotify routes)
