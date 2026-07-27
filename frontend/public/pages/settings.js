import { esc, initTheme, showToast, toggleTheme, apiJson, confirmDialog, userFacingApiError, siteFooterHtml, FEEDBACK_FORM_URL } from "../lib/shared.js";
import { COPY } from "../lib/copy.js";
import { loadUserPrefs, saveUserPref } from "../lib/user-prefs.js";

initTheme();
const root = document.getElementById("settingsRoot");
const prefs = loadUserPrefs();
let settingsSyncing = false;
const isLocalHost = location.hostname === "localhost" || location.hostname === "127.0.0.1";

function navHtml() {
  return `
  <nav class="nav">
    <a href="/" class="nav-logo" style="text-decoration:none;color:inherit;">
      <div class="nav-logo-mark">K</div><span>Kwalify</span>
    </a>
    <div class="nav-right">
      <a href="/status" class="nav-link">Status</a>
      <a href="/" class="nav-link">App</a>
    </div>
  </nav>`;
}

function render(user, cacheStatus) {
  const syncing = settingsSyncing || cacheStatus?.isSyncing;
  const total = cacheStatus?.totalTracks || 0;
  const lastSynced = cacheStatus?.lastSyncedAt
    ? new Date(cacheStatus.lastSyncedAt).toLocaleString()
    : "Never";
  const syncError = cacheStatus?.syncError;

  root.innerHTML = `
  ${navHtml()}
  <div class="settings-page app-wrap">
    <h1 class="vibe-heading cinematic-headline cinematic-headline--app">${COPY.settings.title}</h1>
    <p class="vibe-sub">${COPY.settings.sub}</p>

    <section class="settings-section">
      <h2 class="section-title">How adventurous</h2>      <div class="settings-field">
        <label>Vibe mode</label>
        <div class="mode-group">
          ${["strict", "balanced", "chaotic"].map((m) => `
            <button type="button" class="mode-btn ${prefs.mode === m ? "active" : ""}" data-pref-mode="${m}" aria-pressed="${prefs.mode === m ? "true" : "false"}">${m.charAt(0).toUpperCase() + m.slice(1)}</button>
          `).join("")}
        </div>
      </div>
      <div class="settings-field">
        <label>Playlist size: <span id="settingsLengthVal">${prefs.length}</span> tracks</label>
        <input type="range" id="settingsLength" min="20" max="60" step="5" value="${prefs.length}" class="length-slider">
      </div>
      <div class="settings-field">
        <label>Familiarity (liked-songs mode)</label>
        <div class="familiarity-group">
          ${["safe", "balanced", "discovery"].map((f) => `
            <button type="button" class="familiarity-btn ${prefs.familiarity === f ? "active" : ""}" data-pref-fam="${f}" aria-pressed="${prefs.familiarity === f ? "true" : "false"}">${f.charAt(0).toUpperCase() + f.slice(1)}</button>
          `).join("")}
        </div>
      </div>
      <div class="settings-field">
        <label class="no-library-toggle">
          <div class="toggle-switch ${prefs.discoveryMode ? "on" : ""}" id="settingsDiscoveryToggle" role="switch" tabindex="0" aria-checked="${prefs.discoveryMode}"></div>
          <div class="no-library-text">
            <span class="no-library-label">Discovery Mode</span>
            <span class="no-library-sub">Search all of Spotify for clear genre prompts (not your liked songs)</span>
          </div>
        </label>
      </div>
      <p class="settings-saved" id="settingsSavedMsg" hidden>Saved — applies on next generation.</p>
    </section>

    <section class="settings-section">
      <h2 class="section-title">Your library</h2>
      ${user ? `
        <p>${total ? `${total.toLocaleString()} songs in your history` : "Not synced yet"} · Last sync: ${esc(lastSynced)}</p>
        ${syncError ? `<p class="alert alert-error">${esc(syncError)}</p>` : ""}
        <div class="settings-actions-row">
          <button type="button" class="btn btn-ghost btn-sm" id="settingsDeltaSync" ${syncing ? "disabled" : ""}>${settingsSyncing ? "Syncing…" : "Sync new likes"}</button>
          <button type="button" class="btn btn-ghost btn-sm" id="settingsFullSync" ${syncing ? "disabled" : ""}>${settingsSyncing ? "Syncing…" : "Full sync"}</button>
        </div>
      ` : `<p><a href="/api/auth/login">Sign in with Spotify</a> to sync your library.</p>`}
    </section>

    <section class="settings-section">
      <h2 class="section-title">Appearance</h2>
      <button type="button" class="btn btn-ghost btn-sm" id="settingsThemeBtn">Toggle light / dark</button>
    </section>

    <section class="settings-section">
      <h2 class="section-title">Help</h2>
      <p><a href="/status">System status page</a>${isLocalHost ? "" : ` · <a href="${FEEDBACK_FORM_URL}" target="_blank" rel="noopener">Report a problem</a>`}</p>
      ${isLocalHost ? `<p class="vibe-sub">Logs: <code>kwalify-start.log</code>, <code>kwalify-api.log</code> in project folder.</p>` : ""}
    </section>

    ${user ? `
    <section class="settings-section settings-section--danger">
      <h2 class="section-title">Account</h2>
      <button type="button" class="btn btn-ghost btn-sm" id="settingsLogout">Log out</button>
      <button type="button" class="btn btn-ghost btn-sm" id="settingsDeleteAccount" style="color:var(--danger,#f87171)">Delete my data</button>
    </section>` : ""}
  </div>
  ${siteFooterHtml()}`;

  const flash = () => {
    const el = document.getElementById("settingsSavedMsg");
    if (!el) return;
    el.hidden = false;
    setTimeout(() => { el.hidden = true; }, 2000);
  };

  document.querySelectorAll("[data-pref-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      prefs.mode = btn.dataset.prefMode;
      saveUserPref("mode", prefs.mode);
      document.querySelectorAll("[data-pref-mode]").forEach((b) => {
        b.classList.toggle("active", b.dataset.prefMode === prefs.mode);
        b.setAttribute("aria-pressed", b.dataset.prefMode === prefs.mode ? "true" : "false");
      });
      flash();
    });
  });

  document.querySelectorAll("[data-pref-fam]").forEach((btn) => {
    btn.addEventListener("click", () => {
      prefs.familiarity = btn.dataset.prefFam;
      saveUserPref("familiarity", prefs.familiarity);
      document.querySelectorAll("[data-pref-fam]").forEach((b) => {
        b.classList.toggle("active", b.dataset.prefFam === prefs.familiarity);
        b.setAttribute("aria-pressed", b.dataset.prefFam === prefs.familiarity ? "true" : "false");
      });
      flash();
    });
  });

  const len = document.getElementById("settingsLength");
  len?.addEventListener("input", () => {
    prefs.length = Number(len.value);
    saveUserPref("length", prefs.length);
    const lbl = document.getElementById("settingsLengthVal");
    if (lbl) lbl.textContent = String(prefs.length);
    flash();
  });

  const discToggle = document.getElementById("settingsDiscoveryToggle");
  const toggleDisc = () => {
    prefs.discoveryMode = !prefs.discoveryMode;
    saveUserPref("discoveryMode", prefs.discoveryMode);
    discToggle?.classList.toggle("on", prefs.discoveryMode);
    discToggle?.setAttribute("aria-checked", String(prefs.discoveryMode));
    flash();
  };
  discToggle?.addEventListener("click", toggleDisc);
  discToggle?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleDisc(); }
  });

  document.getElementById("settingsThemeBtn")?.addEventListener("click", () => toggleTheme());

  document.getElementById("settingsLogout")?.addEventListener("click", async () => {
    await apiJson("/auth/logout", { method: "POST" });
    window.location.href = "/";
  });

  document.getElementById("settingsDeleteAccount")?.addEventListener("click", async () => {
    if (!(await confirmDialog("Delete all your Kwalify data? This cannot be undone.", { title: "Delete account data", confirmLabel: "Delete everything", danger: true }))) return;
    try {
      const r = await apiJson("/auth/account", { method: "DELETE" });
      if (r.ok) window.location.href = "/";
      else showToast(userFacingApiError(r, "Could not delete your data. Try again."), "error");
    } catch {
      showToast("Could not delete your data. Check your connection.", "error");
    }
  });

  async function pollSyncStatus() {
    const cs = await apiJson("/spotify/cache-status").catch(() => ({ ok: false, data: null }));
    if (cs.ok && cs.data?.isSyncing) {
      setTimeout(pollSyncStatus, 5000);
      return;
    }
    settingsSyncing = false;
    boot();
  }

  async function runSync(full) {
    if (settingsSyncing) return;
    settingsSyncing = true;
    render(user, cacheStatus);
    try {
      const result = await apiJson("/spotify/sync", {
        method: "POST",
        body: JSON.stringify({ full }),
      });
      if (!result.ok) {
        settingsSyncing = false;
        showToast(userFacingApiError(result, "Could not start sync. Please try again."), "error");
        boot();
        return;
      }
      void pollSyncStatus();
    } catch (err) {
      settingsSyncing = false;
      showToast(err?.message || "Could not start sync. Check your connection.", "error");
      boot();
    }
  }
  document.getElementById("settingsDeltaSync")?.addEventListener("click", () => runSync(false));
  document.getElementById("settingsFullSync")?.addEventListener("click", () => runSync(true));
}

async function boot() {
  root.innerHTML = `${navHtml()}<div class="loading-shell"><div class="spinner"></div></div>`;
  try {
    const me = await apiJson("/auth/me");
    let cacheStatus = null;
    if (me.ok && me.data?.id) {
      const cs = await apiJson("/spotify/cache-status");
      if (cs.ok) cacheStatus = cs.data;
    }
    render(me.ok ? me.data : null, cacheStatus);
  } catch {
    root.innerHTML = `${navHtml()}<div class="loading-shell"><span>Could not reach Kwalify.</span><button type="button" id="settingsRetryBtn" class="btn btn-green btn-sm">Retry</button></div>${siteFooterHtml()}`;
    document.getElementById("settingsRetryBtn")?.addEventListener("click", boot);
  }
}

boot();
