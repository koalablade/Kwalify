import { esc, initTheme, toggleTheme, apiJson } from "../lib/shared.js";
import { loadUserPrefs, saveUserPref } from "../lib/user-prefs.js";

initTheme();
const root = document.getElementById("statusRoot");
let statusRefreshTimer = null;

function clearStatusRefresh() {
  if (statusRefreshTimer) {
    clearTimeout(statusRefreshTimer);
    statusRefreshTimer = null;
  }
}

function scheduleStatusRefresh(ready) {
  clearStatusRefresh();
  if (!ready) {
    statusRefreshTimer = setTimeout(() => boot(true), 10_000);
  }
}

function statusLabel(ok, yes = "OK", no = "Problem") {
  return ok ? `<span class="status-pill status-pill--ok">${yes}</span>` : `<span class="status-pill status-pill--bad">${no}</span>`;
}

function navHtml() {
  return `
  <nav class="nav">
    <a href="/" class="nav-logo" style="text-decoration:none;color:inherit;">
      <div class="nav-logo-mark">K</div><span>Kwalify</span>
    </a>
    <div class="nav-right">
      <a href="/" class="nav-link">App</a>
      <a href="/settings" class="nav-link">Settings</a>
    </div>
  </nav>`;
}

async function fetchReady() {
  try {
    const result = await apiJson("/readyz", { timeoutMs: 5000 });
    return { httpOk: result.ok, data: result.data };
  } catch (err) {
    return { httpOk: false, data: { error: err?.message || "Network error" } };
  }
}

function render({ httpOk, data }) {
  const ready = data?.status === "ready" || data?.readiness === "ready";
  const checks = data?.checks || {};
  const db = checks.databaseAvailable === true;
  const spotify = checks.spotifyConfigured === true;
  const pipeline = checks.pipelineAvailable !== false;
  const uptime = data?.uptimeMs ? `${Math.round(data.uptimeMs / 1000)}s` : "—";
  const commit = (data?.commit || "unknown").slice(0, 8);

  root.innerHTML = `
  ${navHtml()}
  <div class="status-page app-wrap">
    <h1 class="vibe-heading">System status</h1>
    <p class="vibe-sub">${ready
    ? "Plain-English health for your Kwalify server. Refresh to update."
    : "Plain-English health for your Kwalify server. Auto-refreshing every 10 seconds until ready."}</p>

    <div class="status-hero ${ready ? "status-hero--ok" : "status-hero--bad"}">
      <div class="status-hero-title">${ready ? "All systems ready" : "Not ready yet"}</div>
      <div class="status-hero-sub">${ready
    ? "You can log in, sync your library, and generate playlists."
    : "Start Kwalify from Desktop, or check kwalify-start.log / kwalify-api.log."}</div>
    </div>

    <div class="status-grid">
      <div class="status-card">
        <div class="status-card-head">API server ${statusLabel(httpOk)}</div>
        <p>Process is responding on this machine.</p>
      </div>
      <div class="status-card">
        <div class="status-card-head">Database ${statusLabel(db)}</div>
        <p>${db ? "PostgreSQL is reachable." : "PostgreSQL not reachable - check the service is running."}</p>
      </div>
      <div class="status-card">
        <div class="status-card-head">Spotify login ${statusLabel(spotify)}</div>
        <p>${spotify ? "Client ID and secret are configured." : "Missing SPOTIFY_CLIENT_ID / SECRET in .env."}</p>
      </div>
      <div class="status-card">
        <div class="status-card-head">Playlist engine ${statusLabel(pipeline)}</div>
        <p>${pipeline ? "Generation pipeline loaded." : "Pipeline not available - check API logs."}</p>
      </div>
    </div>

    <div class="status-meta">
      <div>Uptime: <strong>${esc(uptime)}</strong></div>
      <div>Build: <strong>${esc(commit)}</strong></div>
      ${data?.error ? `<div class="status-error">Error: ${esc(String(data.error))}</div>` : ""}
    </div>

    <div class="status-actions">
      <button type="button" class="btn btn-green" id="refreshStatusBtn">Refresh</button>
      <a href="/" class="btn btn-ghost">Back to app</a>
    </div>

    <details class="status-raw">
      <summary>Technical details (/api/readyz)</summary>
      <pre>${esc(JSON.stringify(data, null, 2))}</pre>
    </details>
  </div>`;

  document.getElementById("refreshStatusBtn")?.addEventListener("click", () => boot(false));
}

async function boot(silent = false) {
  if (!silent) {
    root.innerHTML = `${navHtml()}<div class="loading-shell"><div class="spinner"></div><span>Checking status…</span></div>`;
  }
  const payload = await fetchReady();
  const ready = payload.data?.status === "ready" || payload.data?.readiness === "ready";
  render(payload);
  scheduleStatusRefresh(ready);
}

boot();
