# Post-Deployment Test Checklist
_Run these in order after every fresh deployment. Each test depends on the previous one._

---

## Infrastructure

- [ ] **Site loads**
  - Visit `https://<your-domain>/`
  - Expected: Dark login page with "Connect with Spotify" button
  - Fail means: Build failed, server not starting, or routing misconfigured

- [ ] **Health check returns OK**
  - Visit `https://<your-domain>/api/healthz`
  - Expected: `{"status":"ok"}`
  - Fail means: Server is not running or not reachable

- [ ] **Database is connected**
  - Confirmed if healthz passes and session table was created (check Render logs for `Session table ready`)
  - Fail means: `DATABASE_URL` is wrong or database is not running

---

## Authentication

- [ ] **Login redirects to Spotify**
  - Click "Connect with Spotify" on the login page
  - Expected: Browser redirects to `accounts.spotify.com` with your Client ID in the URL
  - Fail means: `SPOTIFY_CLIENT_ID` not set, or `window.location.href` navigation broken

- [ ] **Callback works**
  - Approve the Spotify permission dialog
  - Expected: Redirected back to `https://<your-domain>/` and the dashboard is shown
  - Fail means: Redirect URI not whitelisted in Spotify Developer Dashboard, or `SPOTIFY_CLIENT_SECRET` wrong

- [ ] **Session persists across page refresh**
  - After logging in, press F5 (hard refresh)
  - Expected: Dashboard still shown (not kicked back to login)
  - Fail means: Session cookie not being set (`NODE_ENV=production` not set, or `HTTPS` not working, or `SESSION_SECRET` mismatch)

- [ ] **Session persists across server restart**
  - Trigger a redeploy on Render
  - After redeploy, refresh the browser
  - Expected: Still logged in (session stored in PostgreSQL, not memory)
  - Fail means: PostgreSQL session store not working; sessions reverting to MemoryStore

---

## Library Sync

- [ ] **Sync banner shows**
  - On first login, the amber "Sync your Spotify library" banner should appear on the dashboard
  - Fail means: `GET /api/spotify/cache-status` returning an error

- [ ] **Sync starts**
  - Click "Sync now"
  - Expected: Banner changes to "Syncing… X / Y tracks" with a progress bar
  - Fail means: `POST /api/spotify/sync` returning an error; check that Spotify token is valid and has `user-library-read` scope

- [ ] **Sync completes**
  - Wait for sync to finish (depends on library size — 1,000 songs ≈ 30 seconds)
  - Expected: Green "Library synced — N tracks ready" banner
  - Fail means: Sync died mid-way; check Render logs for `Sync failed` with error details

---

## Playlist Generation

- [ ] **Generate works**
  - Type a vibe description (e.g., "late night drive, windows down")
  - Select a mode, adjust length
  - Click "Generate playlist"
  - Expected: Loading state → playlist result card appears with track list and "Open in Spotify" button
  - Fail means: `POST /api/generate` failing; check logs for error details

- [ ] **Playlist created in Spotify**
  - Click "Open in Spotify"
  - Expected: Spotify opens with the generated playlist containing the correct tracks
  - Fail means: Spotify playlist creation failed; check Render logs for `Spotify playlist creation failed`

- [ ] **History saved**
  - After generating, click "History" in the header
  - Expected: The just-generated playlist appears in the list
  - Fail means: `GET /api/history` failing or `INSERT` to `playlist_history` table failed

---

## Edge Cases

- [ ] **Logout works**
  - Click your name in the header → "Sign out"
  - Expected: Redirected to login page; refreshing still shows login page (session destroyed)
  - Fail means: `POST /api/auth/logout` failing or session destroy not working

- [ ] **Second login works**
  - After logout, log in again
  - Expected: Normal dashboard; no double-session errors
  - Library sync status should still show (data persisted in DB)

- [ ] **Database reconnects after sleep**
  - On Render free tier, the database may go idle
  - Leave the app for 30 minutes, then try generating a playlist
  - Expected: Works normally (pg Pool handles reconnection)
  - Fail means: `ECONNRESET` or `ETIMEDOUT` errors in logs — may need connection pool configuration

---

## Performance Baseline (note for records)

After completing all tests, record:

- [ ] Time from "Connect with Spotify" click → dashboard visible: _______ sec
- [ ] Time from "Sync now" click → sync complete (for your library size): _______ sec  
  _(Library size: _______ tracks)_
- [ ] Time from "Generate playlist" click → results shown: _______ sec
- [ ] Time from results shown → playlist visible in Spotify: _______ sec
