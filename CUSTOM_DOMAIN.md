# Custom domain (kwalify.net)

Kwalify runs on **your PC** with a **Cloudflare Tunnel** — not a cloud PaaS.

## Setup

1. Run **`setup-self-host.bat`** once (or `start.bat` on first launch — setup runs automatically).
2. Complete Cloudflare tunnel login when prompted.
3. Ensure `.env` has:

| Variable | Example |
|----------|---------|
| `KWALIFY_HOST_MODE` | `selfhost` |
| `APP_URL` | `https://kwalify.net` |
| `FRONTEND_URL` | `https://kwalify.net` |
| `SPOTIFY_REDIRECT_URI` | `https://kwalify.net/api/auth/callback` |

4. In the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), add redirect URI:

```
https://kwalify.net/api/auth/callback
```

## Verify

- `https://kwalify.net/api/healthz` — process up
- `https://kwalify.net/api/readyz` — database and dependencies ready
- `https://kwalify.net/api/auth/login` — redirects to Spotify

## More detail

- [docs/SELF-HOST-PRODUCTION.md](docs/SELF-HOST-PRODUCTION.md)
- [START-HERE.txt](START-HERE.txt)
