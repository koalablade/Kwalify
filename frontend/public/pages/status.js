import { esc, initTheme, apiJson, siteFooterHtml, FEEDBACK_FORM_URL } from "../lib/shared.js";

initTheme();
const root = document.getElementById("statusRoot");
let statusRefreshTimer = null;
const isLocalHost = location.hostname === "localhost" || location.hostname === "127.0.0.1";
const opsToken = new URLSearchParams(location.search).get("ops")?.trim() || "";

function clearStatusRefresh() {
  if (statusRefreshTimer) {
    clearTimeout(statusRefreshTimer);
    statusRefreshTimer = null;
  }
}

function scheduleStatusRefresh(ready, opsMode) {
  clearStatusRefresh();
  const interval = opsMode ? 30_000 : ready ? 0 : 10_000;
  if (interval > 0) {
    statusRefreshTimer = setTimeout(() => boot(true), interval);
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

async function fetchOpsMetrics() {
  if (!opsToken) return { ok: false, data: null };
  try {
    const result = await apiJson(`/ops/metrics?ops=${encodeURIComponent(opsToken)}`, {
      timeoutMs: 8000,
      headers: { "x-ops-metrics-token": opsToken },
    });
    return { ok: result.ok, data: result.data };
  } catch (err) {
    return { ok: false, data: { error: err?.message || "Network error" } };
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "—";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function opsMetricsHtml(opsPayload) {
  if (!opsToken) return "";
  if (!opsPayload?.ok) {
    return `
    <div class="status-card">
      <div class="status-card-head">Ops metrics ${statusLabel(false, "Enabled", "Unavailable")}</div>
      <p>Could not load ops metrics. Check <code>OPS_METRICS_TOKEN</code> matches the <code>?ops=</code> query param.</p>
    </div>`;
  }

  const data = opsPayload.data ?? {};
  const queue = data.generateQueue;
  const extended = data.extended ?? {};
  const cache = extended.sessionSnapshotCache ?? {};
  const cacheTotal = (cache.hits ?? 0) + (cache.misses ?? 0);
  const cacheHitRate = cacheTotal > 0 ? Math.round((cache.hits / cacheTotal) * 100) : null;
  const spotify = extended.spotifyApi ?? {};
  const phases = extended.generationPhases ?? {};
  const totalPhase = extended.generationPhases?.byPhase?.["generate.total"] ?? phases;
  const outcomes = extended.generateOutcomes ?? {};
  const memory = extended.memory ?? {};
  const errors5xx = extended.response5xx ?? {};

  return `
  <h2 class="vibe-heading" style="margin-top:2rem;font-size:1.25rem;">Ops metrics</h2>
  <p class="vibe-sub">Token-gated snapshot. Refreshes every 30s.</p>
  <div class="status-grid">
    <div class="status-card">
      <div class="status-card-head">Generation queue</div>
      <p>Active: <strong>${esc(String(queue?.active ?? "—"))}</strong> · Queued: <strong>${esc(String(queue?.queued ?? "—"))}</strong></p>
      <p>Avg latency: <strong>${esc(String(queue?.averageLatencyMs ?? "—"))} ms</strong></p>
    </div>
    <div class="status-card">
      <div class="status-card-head">Generation timing</div>
      <p>p50: <strong>${esc(String(totalPhase?.p50Ms ?? phases.p50Ms ?? "—"))} ms</strong></p>
      <p>p95: <strong>${esc(String(totalPhase?.p95Ms ?? phases.p95Ms ?? "—"))} ms</strong></p>
    </div>
    <div class="status-card">
      <div class="status-card-head">Outcomes (1h)</div>
      <p>Success: <strong>${esc(String(outcomes.successLastHour ?? 0))}</strong> · Failure: <strong>${esc(String(outcomes.failureLastHour ?? 0))}</strong></p>
      <p>5xx: <strong>${esc(String(errors5xx.lastHour ?? 0))}</strong> (total ${esc(String(errors5xx.total ?? 0))})</p>
    </div>
    <div class="status-card">
      <div class="status-card-head">Memory</div>
      <p>Heap: <strong>${formatBytes(memory.heapUsed)}</strong> / ${formatBytes(memory.heapTotal)}</p>
      <p>RSS: <strong>${formatBytes(memory.rss)}</strong></p>
    </div>
    <div class="status-card">
      <div class="status-card-head">Spotify API</div>
      <p>Requests: <strong>${esc(String(spotify.totalRequests ?? 0))}</strong></p>
      <p>Failures: <strong>${esc(String(spotify.failures ?? 0))}</strong> · Rate limits: <strong>${esc(String(spotify.rateLimitResponses ?? 0))}</strong></p>
    </div>
    <div class="status-card">
      <div class="status-card-head">Cache & traffic</div>
      <p>Session cache hit rate: <strong>${esc(String(cacheHitRate != null ? `${cacheHitRate}%` : "—"))}</strong></p>
      <p>Requests/min: <strong>${esc(String(extended.requestsPerMinute ?? "—"))}</strong></p>
    </div>
  </div>`;
}

function render({ httpOk, data, opsPayload }) {
  const ready = data?.status === "ready" || data?.readiness === "ready";
  const checks = data?.checks || {};
  const db = checks.databaseAvailable === true;
  const spotify = checks.spotifyConfigured === true;
  const pipeline = checks.pipelineAvailable !== false;
  const uptime = data?.uptimeMs ? `${Math.round(data.uptimeMs / 1000)}s` : "—";
  const commit = (data?.commit || "unknown").slice(0, 8);
  const downHelp = isLocalHost
    ? "Start Kwalify from Desktop, or check kwalify-start.log / kwalify-api.log."
    : "We're looking into it — try again in a few minutes or send feedback.";

  root.innerHTML = `
  ${navHtml()}
  <div class="status-page app-wrap">
    <h1 class="vibe-heading">System status</h1>
    <p class="vibe-sub">${ready
    ? "Plain-English health for Kwalify. Refresh to update."
    : "Auto-refreshing every 10 seconds until ready."}</p>

    <div class="status-hero ${ready ? "status-hero--ok" : "status-hero--bad"}">
      <div class="status-hero-title">${ready ? "All systems ready" : "Not ready yet"}</div>
      <div class="status-hero-sub">${ready
    ? "You can log in, sync your library, and generate playlists."
    : downHelp}</div>
    </div>

    <div class="status-grid">
      <div class="status-card">
        <div class="status-card-head">API server ${statusLabel(httpOk)}</div>
        <p>${httpOk ? "The app is responding." : "The app is not responding right now."}</p>
      </div>
      <div class="status-card">
        <div class="status-card-head">Database ${statusLabel(db)}</div>
        <p>${db ? "Database is reachable." : "Database is temporarily unavailable. Try again shortly."}</p>
      </div>
      <div class="status-card">
        <div class="status-card-head">Spotify login ${statusLabel(spotify)}</div>
        <p>${spotify ? "Spotify login is configured." : "Spotify login is temporarily unavailable."}</p>
      </div>
      <div class="status-card">
        <div class="status-card-head">Playlist engine ${statusLabel(pipeline)}</div>
        <p>${pipeline ? "Generation pipeline loaded." : "Generation pipeline is not ready yet."}</p>
      </div>
    </div>

    ${opsMetricsHtml(opsPayload)}

    <div class="status-meta">
      <div>Uptime: <strong>${esc(uptime)}</strong></div>
      <div>Build: <strong>${esc(commit)}</strong></div>
      ${data?.error ? `<div class="status-error">Error: ${esc(String(data.error))}</div>` : ""}
    </div>

    <div class="status-actions">
      <button type="button" class="btn btn-green" id="refreshStatusBtn">Refresh</button>
      <a href="/" class="btn btn-ghost">Back to app</a>
      <a href="${FEEDBACK_FORM_URL}" target="_blank" rel="noopener" class="btn btn-ghost">Feedback</a>
    </div>
  </div>
  ${siteFooterHtml()}`;

  document.getElementById("refreshStatusBtn")?.addEventListener("click", () => boot(false));
}

async function boot(silent = false) {
  if (!silent) {
    root.innerHTML = `${navHtml()}<div class="loading-shell"><div class="spinner"></div><span>Checking status…</span></div>`;
  }
  const payload = await fetchReady();
  const opsPayload = opsToken ? await fetchOpsMetrics() : null;
  const ready = payload.data?.status === "ready" || payload.data?.readiness === "ready";
  render({ ...payload, opsPayload });
  scheduleStatusRefresh(ready, !!opsToken);
}

boot();
