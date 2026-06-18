# Custom domain (kwalify.net)

Use this when pointing a domain at the Kwalify service on Render.

## 1. Add the domain in Render

1. Open your **Kwalify** web service in the [Render dashboard](https://dashboard.render.com).
2. Go to **Settings** → **Custom Domains**.
3. Add `kwalify.net` and `www.kwalify.net` (optional).
4. Render shows DNS records to create at your registrar.

## 2. DNS at your registrar

Typical setup:

| Host | Type | Value |
|------|------|--------|
| `@` | A or ALIAS | Render’s apex target (shown in dashboard) |
| `www` | CNAME | Your `*.onrender.com` hostname |

DNS can take up to 48 hours to propagate; often it is much faster.

## 3. Environment variables

After the domain is live, set on Render:

| Variable | Example |
|----------|---------|
| `APP_URL` | `https://kwalify.net` |
| `FRONTEND_URL` | `https://www.kwalify.net` (if you use www) |
| `SPOTIFY_REDIRECT_URI` | `https://kwalify.net/api/auth/callback` |

Redeploy after changing env vars.

## 4. Spotify Developer Dashboard

Under your Spotify app → **Redirect URIs**, add exactly:

```
https://kwalify.net/api/auth/callback
```

Remove or keep localhost URIs only if you still need local development.

## 5. Verify

- `https://kwalify.net/api/healthz` — process up
- `https://kwalify.net/api/readyz` — database and dependencies ready
- `https://kwalify.net/api/auth/login` — redirects to Spotify
