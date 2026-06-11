# Render setup guide (Kwalify)

Repo: **https://github.com/koalablade/Kwalify**

Follow these steps in order. Each step takes about 2–5 minutes.

---

## Part 1 — Spotify Developer app

1. Open **https://developer.spotify.com/dashboard**
2. **Create app** (or use an existing one).
3. Open the app → **Settings**.
4. Copy **Client ID** and **Client Secret** (click *View client secret*).
5. Under **Redirect URIs**, you will add your Render URL in Part 4 (leave this tab open).

---

## Part 2 — Create PostgreSQL on Render

1. Go to **https://dashboard.render.com**
2. **New +** → **PostgreSQL**
3. Name: `kwalify-db` (any name is fine)
4. Plan: **Free** (or paid if you prefer)
5. Click **Create Database**
6. When it’s ready, open the database → **Connect** tab.
7. Copy **Internal Database URL** (use this if the API runs on Render in the same account).

---

## Part 3 — Create the Web Service (API)

### Option A — Blueprint (fastest)

1. **New +** → **Blueprint**
2. Connect GitHub → choose **koalablade/Kwalify**
3. Render reads `render.yaml` and creates DB + web service.
4. When prompted, fill in the Spotify variables (Part 4).
5. Deploy.

### Option B — Manual

1. **New +** → **Web Service**
2. Connect **koalablade/Kwalify** → branch **main**
3. Settings:

| Field | Value |
|--------|--------|
| **Name** | `kwalify-api` (your URL will be `https://kwalify-api.onrender.com`) |
| **Region** | Closest to you |
| **Runtime** | **Node** |
| **Build Command** | `rm -rf node_modules && npm cache clean --force && npm ci --include=dev --cache /tmp/npm-cache --prefer-online && npm run build` |
| **Start Command** | `npm start` |
| **Plan** | Free |

4. **Advanced** → **Health Check Path**: `/api/healthz`

---

## Part 4 — Environment variables

In the web service → **Environment** → add:

| Key | Value | Notes |
|-----|--------|--------|
| `NODE_ENV` | `production` | Required for secure cookies |
| `DATABASE_URL` | *(paste Internal Database URL from Part 2)* | Link database in Render UI if available |
| `SESSION_SECRET` | Random long string | e.g. run locally: `openssl rand -hex 32` or use any 32+ char secret |
| `SPOTIFY_CLIENT_ID` | From Spotify dashboard | |
| `SPOTIFY_CLIENT_SECRET` | From Spotify dashboard | |
| `APP_URL` | `https://kwalify.net` | Canonical public URL; enables redirect from `*.onrender.com` |
| `SPOTIFY_REDIRECT_URI` | `https://kwalify.net/api/auth/callback` | **Must match Spotify exactly** |
| `FRONTEND_URL` | `https://kwalify.net,https://www.kwalify.net` | Comma-separated CORS origins (no trailing slashes) |

**Do not set `PORT`** — Render sets it automatically.

Example for custom domain **kwalify.net**:

```
APP_URL=https://kwalify.net
SPOTIFY_REDIRECT_URI=https://kwalify.net/api/auth/callback
FRONTEND_URL=https://kwalify.net,https://www.kwalify.net
```

Add the **same** redirect URI in Spotify → **Redirect URIs** → **Save**.

Full DNS + Render domain steps: **[CUSTOM_DOMAIN.md](./CUSTOM_DOMAIN.md)**.

---

## Part 5 — Create database tables (one time)

The API creates the **session** table on startup. App tables (`liked_songs`, `playlist_history`, etc.) need Drizzle once:

**On your PC** (with Node/npm installed):

```powershell
cd "c:\Users\Kwalah\Downloads\Asset-Manager (1)\Asset-Manager (2)\Asset-Manager\artifacts\api-server"

$env:DATABASE_URL = "PASTE_YOUR_RENDER_EXTERNAL_DATABASE_URL_HERE"
npm install
npx drizzle-kit push
```

Use the **External** Database URL from Render if running from your machine (not Internal).

---

## Part 6 — Deploy and test

1. Click **Manual Deploy** → **Deploy latest commit** (or wait for auto-deploy).
2. Wait until status is **Live**.
3. Open: `https://YOUR-SERVICE-NAME.onrender.com/api/healthz`  
   You should see a healthy JSON response.
   For dependency readiness, open `/api/readyz`.
4. Test login: `https://YOUR-SERVICE-NAME.onrender.com/api/auth/login`  
   Should redirect to Spotify.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Build fails / pnpm | Build must be `rm -rf node_modules && npm cache clean --force && npm ci --include=dev --cache /tmp/npm-cache --prefer-online && npm run build` — no pnpm/yarn |
| `SESSION_SECRET` / `DATABASE_URL` required | Add env vars and redeploy |
| Spotify redirect error | `SPOTIFY_REDIRECT_URI` must match Spotify dashboard character-for-character |
| Login works but sync/generate fails | Run `drizzle-kit push` (Part 5) |
| 502 on free tier | Service may be sleeping; wait 30s and retry |
| CORS errors from a frontend | Set `FRONTEND_URL` to your frontend origin (https, no trailing slash) |

---

## Quick checklist

- [ ] Render web service live
- [ ] PostgreSQL linked (`DATABASE_URL`)
- [ ] All env vars set
- [ ] Spotify redirect URI added
- [ ] `drizzle-kit push` completed
- [ ] `/api/healthz` works
- [ ] `/api/auth/login` redirects to Spotify

---

## Your links

- **GitHub:** https://github.com/koalablade/Kwalify  
- **Render dashboard:** https://dashboard.render.com  
- **Spotify dashboard:** https://developer.spotify.com/dashboard
