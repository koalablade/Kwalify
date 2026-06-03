---
name: Kwalify project overview
description: Architecture, stack, secrets needed, and Replit-specific setup notes.
---

## Stack
- Backend: Node.js + Express + TypeScript (`backend/`), built with `npx tsc` → `dist/`
- Frontend: Vanilla JS served from `frontend/public/`
- DB: PostgreSQL via Replit's built-in DB (DATABASE_URL set automatically)
- Auth: Spotify OAuth (custom, NOT Supabase/Firebase/Replit Auth)
- Workflow: "Start application" runs `node dist/server.js` on port 5000

## Secrets required (not yet provided by user as of migration)
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `SPOTIFY_REDIRECT_URI`
All requested via environment-secrets skill. App runs but Spotify endpoints return 503 until provided.

**Why:** Spotify has no Replit integration connector, so secrets must be provided manually.

## Build
Run `npm run build` (= `npx tsc`) before restarting workflow after any TypeScript changes.
Build output goes to `dist/`.
