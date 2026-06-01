# Use kwalify.net on Render (custom domain)

The app serves **both** the website and the API from one Render service.  
`kwalify.onrender.com` keeps working, but after setup **`https://kwalify.net`** becomes the main URL.

---

## 1 — Render: attach the domain

1. Open [Render Dashboard](https://dashboard.render.com) → your **kwalify** web service.
2. **Settings** → **Custom Domains** → **Add Custom Domain**.
3. Add:
   - `kwalify.net`
   - `www.kwalify.net` (recommended)
4. Render shows DNS records (usually a **CNAME** or **ANAME/ALIAS** target like `kwalify.onrender.com` or a Render hostname).

---

## 2 — DNS at your domain registrar

Where you bought **kwalify.net** (Cloudflare, Namecheap, Google Domains, etc.):

| Host | Type | Value |
|------|------|--------|
| `@` (root) | CNAME or ALIAS | *(what Render shows for apex)* |
| `www` | CNAME | *(Render target, often `*.onrender.com`)* |

- If the registrar does **not** allow CNAME on the root (`@`), use their **ANAME/ALIAS** option or point apex to Render’s documented A records.
- Wait 5–60 minutes for DNS to propagate.

In Render, wait until the domain shows **Verified** and **Certificate Issued** (HTTPS).

---

## 3 — Render environment variables

In the web service → **Environment**, set (then **Save** and redeploy):

| Key | Example value |
|-----|----------------|
| `APP_URL` | `https://kwalify.net` |
| `FRONTEND_URL` | `https://kwalify.net,https://www.kwalify.net` |
| `SPOTIFY_REDIRECT_URI` | `https://kwalify.net/api/auth/callback` |

Keep existing `DATABASE_URL`, `SESSION_SECRET`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `NODE_ENV=production`.

**Important:** `SPOTIFY_REDIRECT_URI` must use the **same host** you want users to log in on (usually `kwalify.net`, not `onrender.com`).

You can leave the old `onrender.com` redirect in Spotify during migration, then remove it later.

---

## 4 — Spotify Developer Dashboard

1. [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) → your Kwalify app → **Settings**.
2. **Redirect URIs** → add exactly:
   ```
   https://kwalify.net/api/auth/callback
   ```
3. If you use www for login, also add:
   ```
   https://www.kwalify.net/api/auth/callback
   ```
4. **Save**.

---

## 5 — Deploy latest code

Push the repo (includes canonical redirect + `APP_URL` support), then **Manual Deploy** on Render if needed.

After deploy:

1. Open `https://kwalify.net/api/healthz` → should return healthy JSON.
2. Open `https://kwalify.net` → site UI loads.
3. **Log in with Spotify** on `kwalify.net` (not only on `onrender.com`).
4. Visiting `https://kwalify.onrender.com/` should **301 redirect** to `https://kwalify.net` (when `APP_URL` is set).

---

## Why it only worked on onrender.com before

| Cause | Fix |
|--------|-----|
| Custom domain not added in Render | Part 1 |
| DNS not pointing to Render | Part 2 |
| `SPOTIFY_REDIRECT_URI` still `…onrender.com/…` | Part 3 + 4 |
| OAuth redirect / cookies tuned for split hosts | Set `APP_URL`; code uses `sameSite: lax` on one domain |
| Hardcoded `kwalify.onrender.com` in share links | Fixed via `APP_URL` in code |

---

## Optional: www vs non-www

Pick one canonical URL for `APP_URL` (e.g. `https://kwalify.net`).  
In DNS/registrar, redirect `www` → apex (or the reverse) so users and Spotify always see one host.

---

## Checklist

- [ ] Custom domain verified on Render with HTTPS
- [ ] `APP_URL=https://kwalify.net`
- [ ] `FRONTEND_URL` includes kwalify.net (and www if used)
- [ ] `SPOTIFY_REDIRECT_URI=https://kwalify.net/api/auth/callback`
- [ ] Same URI added in Spotify dashboard
- [ ] Redeployed
- [ ] Login + generate work on **kwalify.net**
