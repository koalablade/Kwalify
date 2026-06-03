# Kwalify Documentation

This directory contains the technical documentation for the Kwalify codebase, produced during a full application audit in June 2025.

## Documents

| File | Contents |
|---|---|
| [system-overview.md](./system-overview.md) | Stack, repo structure, request path, bootstrap sequence, key design decisions |
| [backend-architecture.md](./backend-architecture.md) | Express app, middleware stack, auth flow, sync, generation, all routes |
| [frontend-architecture.md](./frontend-architecture.md) | Pages, SPA pattern, boot sequence, API calls, styling |
| [database-schema.md](./database-schema.md) | All tables, columns, indexes, notes on usage and gotchas |
| [api-endpoints.md](./api-endpoints.md) | Every endpoint: auth, path, request, response, error cases |
| [playlist-generation-flow.md](./playlist-generation-flow.md) | Step-by-step pipeline from POST /api/generate to Spotify playlist |
| [environment-variables.md](./environment-variables.md) | All env vars: required, optional, undocumented, example .env files |
| [deployment.md](./deployment.md) | Build, run, Replit deploy, schema migration approach, checklist |
| [audit-report.md](./audit-report.md) | Full audit findings: bugs, dead code, design observations, security, recommendations |

## Quick Reference

### Start the app
```bash
npm run build && npm start
```

### Required environment variables
```
DATABASE_URL
SESSION_SECRET
PORT
SPOTIFY_CLIENT_ID
SPOTIFY_CLIENT_SECRET
SPOTIFY_REDIRECT_URI
```

### Key files
- `backend/server.ts` — entry point + bootstrap
- `backend/app.ts` — Express app + middleware
- `backend/controllers/generation.controller.ts` — playlist generation engine
- `backend/routes/auth.ts` — Spotify OAuth
- `backend/routes/spotify.ts` — library sync
- `backend/lib/env.ts` — env validation + feature flags
- `frontend/public/pages/app.js` — main SPA
