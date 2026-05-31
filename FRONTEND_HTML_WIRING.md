# Wiring your HTML site to the Render API

Your UI lives at **https://www.kwalify.net**  
Your API lives at **https://kwalify-api.onrender.com**

They are **two different hosts**. The API does not serve your HTML (that is why `https://kwalify-api.onrender.com/` shows `Cannot GET /`).

## Render env vars

```
FRONTEND_URL=https://www.kwalify.net
SPOTIFY_REDIRECT_URI=https://kwalify-api.onrender.com/api/auth/callback
```

After login, Spotify returns to the API; the API then redirects to **kwalify.net** (when `FRONTEND_URL` is set).

## Add this once at the top of your `<script>` block

```javascript
const API = 'https://kwalify-api.onrender.com/api';
const SITE = 'https://www.kwalify.net';

function apiFetch(path, options = {}) {
  return fetch(`${API}${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}
```

## Replace links and fetches

| Your HTML (old monolith) | Use instead |
|--------------------------|-------------|
| `href="/login"` | `href="${API}/auth/login"` or `https://kwalify-api.onrender.com/api/auth/login` |
| `href="/logout"` | Button: `apiFetch('/auth/logout', { method: 'POST' }).then(() => location.href = SITE)` |
| `fetch('/generate', …)` | `apiFetch('/generate', { method: 'POST', body: … })` |
| `fetch('/cache-status')` | `apiFetch('/spotify/cache-status')` — see mapping below |
| `{% if logged_in %} … {% else %}` | Remove Jinja; use JS: `apiFetch('/auth/me')` → show logged-in or landing section |

## Cache status response mapping

Your script expects `status: 'syncing' | 'done' | …`. The API returns:

```javascript
// After: const d = await apiFetch('/spotify/cache-status').then(r => r.json());
const mapped = {
  status: !d.synced && d.isSyncing ? 'syncing'
    : d.synced ? 'done'
    : 'idle',
  sync_done: d.syncProgress,
  sync_total: d.syncTotal,
  track_count: d.totalTracks,
  last_sync_at: d.lastSyncedAt,
};
```

## Generate response

API returns `playlistUrl` (and `url` as alias). Your `showResult(d.url, …)` still works if you use the updated API.

## Spotify sync

After first login, trigger a one-time sync:

```javascript
apiFetch('/spotify/sync', { method: 'POST' });
```

## Hosting

Upload your `.html` to wherever **kwalify.net** is hosted (Netlify, Cloudflare Pages, cPanel, etc.). Do **not** expect Render to show the website UI.
