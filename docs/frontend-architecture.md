# Frontend Architecture

## Overview

The frontend is **vanilla JavaScript ES modules** served as static files from `frontend/public/`. There is no build step, no bundler, no framework, and no TypeScript. The files are served directly by Express's `express.static()` middleware.

## Pages

| URL | HTML file | JS file | Description |
|---|---|---|---|
| `/` | `index.html` | `pages/app.js` | Landing page (logged out) + main app (logged in) |
| `/gallery` | `gallery.html` | `pages/gallery.js` | Full playlist history grid |
| `/p/:id` | `playlist.html` | `pages/playlist.js` | Public share page for a single playlist |

Routing for these paths is handled server-side: `app.ts` has explicit `res.sendFile()` handlers for each.

## Main App (`pages/app.js`)

### Architecture Pattern
This is a minimal hand-rolled SPA. State is held in a single `state` object. When state changes, the entire page `innerHTML` is replaced by calling `renderApp()` or `renderLanding()`. After each render, event listeners are re-attached manually.

```js
const state = {
  user: null,
  cacheStatus: null,    // from GET /api/spotify/cache-status
  librarySummary: null, // from GET /api/library/summary
  playlists: [],        // from GET /api/playlists
  history: [],          // from GET /api/history
  mode: "balanced",     // "strict" | "balanced" | "chaotic"
  length: 40,           // 10–100 tracks
  generating: false,
  lastResult: null,
  error: null,
};
```

### Boot Sequence
1. Show loading spinner.
2. Call `GET /api/auth/me`. If 401 → `renderLanding()`.
3. In parallel: `GET /api/spotify/cache-status`, `GET /api/library/summary`, `GET /api/playlists`, `GET /api/history`.
4. Store results in `state`, call `renderApp()`.
5. If `cacheStatus.isSyncing === true`, start polling `refreshStatus()` every 3 seconds.

### Key User Flows

**Generate playlist:**
1. User types vibe text (max 140 chars) and optionally pastes a reference Spotify playlist URL.
2. Clicks "Generate" or presses Enter.
3. `state.generating = true` → re-render shows spinner.
4. `POST /api/generate` with `{ vibe, mode, length, referencePlaylist? }`.
5. On success: `state.lastResult = response.data`, calls `loadPlaylists()` to refresh the list.
6. On 401: redirects to `/api/auth/login`.
7. `finally`: `state.generating = false` → re-render shows result card, restores vibe input value.

**Sync library:**
- "Sync" / "Full sync" button → `POST /api/spotify/sync` with `{ full: true }`.
- After 2 seconds, calls `refreshStatus()`, which polls every 3 seconds until `isSyncing === false`.

**Delete playlist:**
- Confirm dialog → `DELETE /api/playlists/:id` → removes from `state.playlists`, re-renders.

### Presets and Example Vibes
Hardcoded arrays in `app.js`:
```js
PRESETS = ["🌙 Night Drive", "💪 Gym", "☁️ Chill", "🧠 Focus", "🌞 Summer"]
EXAMPLE_VIBES = ["late-night motorway drive", "sunny afternoon...", ...]
```
Clicking a chip fills `vibeInput` but does not auto-submit.

### Keyboard Shortcuts
- `Enter` in vibe input → generate.
- `Ctrl+K` / `Cmd+K` → focus and select vibe input.

## Gallery Page (`pages/gallery.js`)

Simple read-only page. On boot:
1. `GET /api/auth/me` — if 401, redirect to `/`.
2. `GET /api/playlists` — render all playlists as cards.

Each card shows: album art mosaic (up to 4 images), playlist name, auto-derived tags (from `emotionProfile`), vibe quote, track count + date, Spotify link, share link.

Tags are derived client-side from `emotionProfile` fields:
- `energy > 0.7` → "high energy", `energy < 0.4` → "calm"
- `valence > 0.7` → "happy", `valence < 0.35` → "melancholic"
- `nostalgia > 0.6` → "nostalgic"
- `timeOfDay`, `environment` → shown as-is

## Share Page (`pages/playlist.js`)

Public (no auth required). On boot:
1. Extracts playlist ID from URL: `/p/:id`.
2. `GET /api/share/:id` (unauthenticated).
3. Renders: playlist name, vibe quote, track list with album art, Spotify link, "Copy tracklist" button.

The "Copy tracklist" button writes a formatted plain-text tracklist to the clipboard.

Field name inconsistency: the page accepts both `t.trackName`/`t.name` and `t.artistName`/`t.artist` to handle potential legacy data shapes.

## Shared Utilities (Duplicated Across Pages)

Each of the three JS files contains its own copy of:
- `esc(v)` — HTML entity escaping
- `formatDate(iso)` — `en-GB` date formatter
- `spotifyIconSvg()` — inline Spotify logo SVG

These are duplicated rather than shared via a module import.

## API Communication

All three pages use the same pattern:
```js
async function api(path, opts = {}) {
  const r = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}
```

`credentials: "include"` ensures session cookies are sent. Errors from `.json()` are silently swallowed (returns `{}`).

## Styling

All CSS is in `frontend/public/styles/base.css` (~1023 lines). Dark theme throughout. No CSS framework or preprocessor. CSS custom properties are used for the colour palette.

Key design tokens (approximate):
- Background: `#0a0a14` (near-black)
- Surface: `#12121f`, `#1a1a2c`
- Accent purple: `#6c47ff`
- Accent green (Spotify): `#1db954`
- Text primary: white, muted at `rgba(255,255,255,0.5)`

## Frontend → Backend API Calls Summary

| Page | Endpoint | Purpose |
|---|---|---|
| app.js | `GET /api/auth/me` | Auth check / user info |
| app.js | `GET /api/spotify/cache-status` | Sync status |
| app.js | `GET /api/library/summary` | Library stats |
| app.js | `GET /api/playlists` | Playlist list |
| app.js | `GET /api/history` | Recent vibes |
| app.js | `POST /api/generate` | Generate playlist |
| app.js | `POST /api/spotify/sync` | Trigger sync |
| app.js | `DELETE /api/playlists/:id` | Delete playlist |
| app.js | `POST /api/auth/logout` | Logout |
| gallery.js | `GET /api/auth/me` | Auth check |
| gallery.js | `GET /api/playlists` | All playlists |
| playlist.js | `GET /api/share/:id` | Public playlist data |

**Not called by any frontend page:**
- `GET /api/library/chapters`
- `GET /api/generate/status`
