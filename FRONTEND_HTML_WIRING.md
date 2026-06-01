# Frontend + API hosting

This repo serves **both** from one Render web service:

- UI: `/`, `/gallery`, `/p/:id` (files in `artifacts/api-server/public/`)
- API: `/api/*`

## Production URL

Use your custom domain, e.g. **https://kwalify.net** — not a separate API host.

Environment on Render:

```
APP_URL=https://kwalify.net
FRONTEND_URL=https://kwalify.net,https://www.kwalify.net
SPOTIFY_REDIRECT_URI=https://kwalify.net/api/auth/callback
```

See **[CUSTOM_DOMAIN.md](./CUSTOM_DOMAIN.md)** to connect **kwalify.net** in Render and DNS.

## HTML / fetch

`index.html` uses **relative** API paths (`/api/generate`, `/api/auth/login`), so it works on any host once the domain points at Render.

No need for `const API = 'https://….onrender.com/api'` unless you split frontend and API onto different domains again.
