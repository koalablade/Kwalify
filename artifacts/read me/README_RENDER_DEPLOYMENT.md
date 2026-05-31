# Render Deployment Guide
_Step-by-step for first-time deployers. No experience assumed._

---

## Overview

Kwalify requires two services on Render:
1. **Web Service** — the Node.js API server (also serves the frontend via the proxy)
2. **PostgreSQL Database** — stores liked songs, playlist history, and sessions

Total time: ~30 minutes on first deploy.

---

## Step 1 — Push Code to GitHub

If your code is not yet on GitHub:

1. Go to [github.com](https://github.com) and sign in (or create an account).
2. Click **"New repository"** (the green button, top-right or on the dashboard).
3. Name it `kwalify`. Keep it **Private**. Do not initialize with README.
4. Click **"Create repository"**.
5. GitHub shows you a page with commands. Run these in your terminal from the project root:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/kwalify.git
git push -u origin main
```

6. Refresh the GitHub page — you should see your files listed.

If your code is already on GitHub, just push the latest changes:
```bash
git add .
git commit -m "Pre-deployment"
git push
```

---

## Step 2 — Create a Render Account

1. Go to [render.com](https://render.com) and click **"Get Started"**.
2. Sign up with GitHub (recommended — it links directly).
3. Verify your email if prompted.

---

## Step 3 — Create the PostgreSQL Database

**Do this before the web service** — you need the database URL to configure the web service.

1. In the Render dashboard, click **"New +"** → **"PostgreSQL"**.
2. Fill in:
   - **Name:** `kwalify-db`
   - **Region:** Choose the closest to your users (e.g., Oregon US West)
   - **PostgreSQL Version:** 16 (or latest offered)
   - **Plan:** Free (for testing) or Starter ($7/mo for persistence after free tier)
3. Click **"Create Database"**.
4. Wait ~2 minutes for the database to become available.
5. Once ready, click the database name → scroll to **"Connections"**.
6. Copy the **"External Database URL"**. It looks like:
   ```
   postgresql://kwalify_db_user:abc123@dpg-xxx.oregon-postgres.render.com/kwalify_db
   ```
   Save this — you'll need it in Step 5.

> **Note:** On Render's free plan, PostgreSQL databases are deleted after 90 days. Use the Starter plan for production.

---

## Step 4 — Create the Web Service

1. In the Render dashboard, click **"New +"** → **"Web Service"**.
2. Choose **"Build and deploy from a Git repository"** → click **"Next"**.
3. Connect your GitHub account if prompted → find `kwalify` → click **"Connect"**.
4. Fill in the service configuration:

   | Field | Value |
   |---|---|
   | **Name** | `kwalify` |
   | **Region** | Same as your database |
   | **Branch** | `main` |
   | **Root Directory** | _(leave blank)_ |
   | **Runtime** | `Node` |
   | **Build Command** | `npm install -g pnpm && pnpm install && pnpm run build` |
   | **Start Command** | `node --enable-source-maps artifacts/api-server/dist/index.mjs` |
   | **Plan** | Free (or Starter for production) |

5. Do **not** click "Create Web Service" yet — continue to Step 5.

---

## Step 5 — Set Environment Variables

Still on the "Create Web Service" page, scroll down to **"Environment Variables"**.

Click **"Add Environment Variable"** for each of the following:

| Key | Value |
|---|---|
| `DATABASE_URL` | Paste the External Database URL from Step 3 |
| `SESSION_SECRET` | Generate: go to [this generator](https://generate-secret.vercel.app/64) and paste the result |
| `SPOTIFY_CLIENT_ID` | From Spotify Developer Dashboard (see Step 6) |
| `SPOTIFY_CLIENT_SECRET` | From Spotify Developer Dashboard (see Step 6) |
| `SPOTIFY_REDIRECT_URI` | `https://kwalify.onrender.com/api/auth/callback` _(replace `kwalify` with your actual service name)_ |
| `FRONTEND_URL` | `https://kwalify.onrender.com` _(same domain as above)_ |
| `NODE_ENV` | `production` |

> **How to find your Render domain:** Render shows the URL at the top of the web service page as `https://<service-name>.onrender.com`. If you named it `kwalify`, it's `https://kwalify.onrender.com`.

Now click **"Create Web Service"**.

---

## Step 6 — Configure Spotify Developer App

**You must do this, or OAuth login will fail.**

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard).
2. Sign in with your Spotify account.
3. Click your app (or create one: **"Create app"** → fill in name/description → agree to terms).
4. Click **"Settings"** (top-right of your app page).
5. Under **"Redirect URIs"**, click **"Add"**.
6. Paste: `https://kwalify.onrender.com/api/auth/callback`
   _(Use your actual Render domain)_
7. Click **"Add"** → then click **"Save"** at the bottom.
8. Copy your **Client ID** and **Client Secret** from the Settings page.
9. Paste them into the Render environment variables (Step 5).

---

## Step 7 — Wait for First Deployment

1. After clicking "Create Web Service", Render starts building your app.
2. Click **"Logs"** in the left sidebar to watch progress.
3. The build takes 3–8 minutes on first run (installing pnpm + all dependencies).
4. A successful deployment shows:
   ```
   Session table ready
   Server listening
       port: 10000
   ```
5. If you see errors, check the **Deployment Readiness Report** for common blockers.

---

## Step 8 — Verify Deployment

1. Click the service URL at the top of the Render page (`https://kwalify.onrender.com`).
2. You should see the Kwalify login page with a dark background.
3. Test the health check: visit `https://kwalify.onrender.com/api/healthz`
   - Should return: `{"status":"ok"}`

---

## Re-deploying After Code Changes

1. Push changes to GitHub:
   ```bash
   git add .
   git commit -m "Your change description"
   git push
   ```
2. Render detects the push and automatically starts a new build.
3. The old version stays live until the new one is healthy.
4. Check the **"Events"** tab in Render to see deployment history.

To deploy manually without a push: go to your Render web service → click **"Manual Deploy"** → **"Deploy latest commit"**.

---

## Free Tier Limitations

| Limitation | Impact |
|---|---|
| Web service spins down after 15 min of inactivity | First request after idle takes 30–60 seconds |
| PostgreSQL deleted after 90 days | Upgrade to Starter plan to keep data |
| 750 free hours/month | Enough for one always-on service |

For real users, upgrade both the web service and database to the Starter plan.
