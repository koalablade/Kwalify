# Architecture Contract

This repository is locked to one active implementation path per feature. Future edits must preserve the source-of-truth files listed here and must not introduce parallel systems.

## 1. System Overview

- Backend: Express + TypeScript in `backend/`.
- Frontend: static HTML/CSS/JavaScript served from `frontend/public/`.
- Database layer: PostgreSQL through Drizzle schema in `backend/db/schema/`, configured by root `drizzle.config.ts`.
- Runtime entry: `backend/server.ts` creates the app, initializes database dependencies, and starts the listener.

## 2. Active Systems Only

- Backend server entry point: `backend/server.ts`.
- Express app factory: `backend/app.ts`.
- API route registry: `backend/routes/routes.index.ts`.
- Generation endpoint and pipeline entry: `backend/controllers/generation.controller.ts`.
- Active static UI: `frontend/public/index.html`.
- Supporting static pages: `frontend/public/playlist.html` and `frontend/public/gallery.html`.
- Database schema: `backend/db/schema/index.ts`.

All files under `legacy/` are dormant recovery/reference material. They must not be imported, served, bundled, or auto-executed by production startup.

The old `artifacts/` tree is not an active runtime source. Active build and runtime paths must use `backend/`, `frontend/public/`, and root configuration files.

## 3. Forbidden Patterns

- Multiple UI systems running simultaneously.
- Auto-loading legacy UI scripts such as old grid, world, cinema, or experimental UI layers.
- More than one frontend boot initializer on page load.
- Duplicate route handlers for the same API responsibility.
- Duplicate generation controllers or generation pipelines.
- A second backend app/server entry point.
- Reintroducing `backend/src` or `artifacts/api-server/src` as active TypeScript sources.
- Creating a new state manager when the current UI state can be extended.
- Creating a new service/controller before checking for an existing implementation.

## 4. Edit Rules For Future Dev

- Always search for the existing implementation before creating a new file or system.
- Extend the active source of truth instead of creating a parallel version.
- Keep one source of truth per feature: one route group, one controller, one boot flow, one state manager.
- Legacy code may remain for reference, but it must stay dormant and manually invoked only.
- Do not import from `legacy/` or `artifacts/` into active runtime code.
- Do not add external scripts to `frontend/public/index.html` for inactive UI systems.
- If a feature needs a new route, register it once through `backend/routes/routes.index.ts`.
- If generation behavior changes, change `backend/controllers/generation.controller.ts` and its existing helper modules, not a new controller.
- If frontend startup changes, keep the single boot call in `frontend/public/index.html`.
- If unsure whether code is active, keep it dormant and document the uncertainty instead of duplicating behavior.
