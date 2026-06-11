// ── Kwalify · Gallery ─────────────────────────────────────────────────────────
const root = document.getElementById("galleryRoot");

// ── Theme bootstrap ───────────────────────────────────────────────────────────
(function initTheme() {
  const saved = localStorage.getItem("kwalify-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = saved || (prefersDark ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
})();

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

async function api(path, opts = {}) {
  const r = await fetch(`/api${path}`, { credentials: "include", ...opts });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch { return ""; }
}

function spi() {
  return `<span class="spi"><svg width="11" height="11" viewBox="0 0 24 24" fill="#1db954"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg></span>`;
}

let galleryUser = null;
let profileOpen = false;
let galleryPlaylists = [];
let deleteMode = false;
let selectedPlaylistIds = new Set();
let deletingPlaylists = false;
let galleryFilter = "all";
let gallerySearch = "";
let gallerySort = "newest";
let restoreGallerySearchFocus = false;
let galleryLoadError = null;
let galleryGlobalListenersWired = false;

function getTheme() {
  return document.documentElement.getAttribute("data-theme") || "dark";
}

function toggleTheme() {
  const next = getTheme() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("kwalify-theme", next);
  const icon = document.getElementById("galleryThemeIcon");
  if (icon) icon.textContent = next === "dark" ? "☀️" : "🌙";
}

function navHtml() {
  const isDark = getTheme() === "dark";
  if (!galleryUser) {
    return `
    <nav class="nav">
      <div class="nav-logo">
        <div class="nav-logo-mark">K</div>
        <span>Kwalify</span>
      </div>
      <div class="nav-right">
        <a href="/" class="btn btn-ghost btn-sm">← Back to app</a>
      </div>
    </nav>`;
  }
  const initials = (galleryUser.displayName || "U").charAt(0).toUpperCase();
  const avatar = galleryUser.avatarUrl
    ? `<img src="${esc(galleryUser.avatarUrl)}" alt="">`
    : initials;

  return `
  <nav class="nav">
    <div class="nav-logo">
      <div class="nav-logo-mark">K</div>
      <span>Kwalify</span>
    </div>
    <div class="nav-right">
      <a href="/" class="nav-link">← App</a>
      <div class="nav-profile-wrap" id="galleryProfileWrap">
        <button class="nav-avatar-btn" id="galleryProfileBtn" title="Account">
          <div class="nav-avatar">${avatar}</div>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:var(--muted-2)"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="profile-dropdown ${profileOpen ? "open" : ""}" id="galleryProfileDropdown">
          <div class="profile-dropdown-header">
            <span class="profile-dropdown-name">${esc(galleryUser.displayName || "")}</span>
          </div>
          <button class="profile-dropdown-item" id="galleryThemeToggleBtn">
            <span id="galleryThemeIcon">${isDark ? "☀️" : "🌙"}</span>
            <span>${isDark ? "Light mode" : "Dark mode"}</span>
          </button>
          <div class="profile-dropdown-divider"></div>
          <button class="profile-dropdown-item profile-dropdown-logout" id="galleryLogoutBtn">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            <span>Log out</span>
          </button>
        </div>
      </div>
    </div>
  </nav>`;
}

function wireNavEvents() {
  document.getElementById("galleryProfileBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    profileOpen = !profileOpen;
    document.getElementById("galleryProfileDropdown")?.classList.toggle("open", profileOpen);
  });
  if (!galleryGlobalListenersWired) {
    document.addEventListener("click", (e) => {
      if (!document.getElementById("galleryProfileWrap")?.contains(e.target)) {
        profileOpen = false;
        document.getElementById("galleryProfileDropdown")?.classList.remove("open");
      }
    });
    galleryGlobalListenersWired = true;
  }
  document.getElementById("galleryThemeToggleBtn")?.addEventListener("click", toggleTheme);
  document.getElementById("galleryLogoutBtn")?.addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    window.location.href = "/";
  });
}

function getTags(p) {
  const ep = p.emotionProfile || {};
  const tags = [];
  if (p.mode) tags.push(p.mode.charAt(0).toUpperCase() + p.mode.slice(1));
  if (ep.timeOfDay) tags.push(ep.timeOfDay);
  if (ep.environment) tags.push(ep.environment);
  if (ep.energy !== undefined) {
    if (ep.energy > 0.7) tags.push("High energy");
    else if (ep.energy < 0.4) tags.push("Calm");
  }
  if (ep.valence !== undefined) {
    if (ep.valence > 0.7) tags.push("Happy");
    else if (ep.valence < 0.35) tags.push("Melancholic");
  }
  if (ep.nostalgia > 0.6) tags.push("Nostalgic");
  return tags.slice(0, 4);
}

function generatorNote(p) {
  const summary = p.emotionProfile?.generationSummary;
  if (!summary) return "";
  const confidence = summary.confidence;
  const diagnostics = summary.generationDiagnostics || {};
  const bits = [];
  if (confidence?.label && typeof confidence.percent === "number") {
    bits.push(`${confidence.label} ${confidence.percent}%`);
  }
  if (diagnostics.fallbackTriggered) bits.push("fallback used");
  if (diagnostics.identityType) bits.push(String(diagnostics.identityType).replace(/_/g, " "));
  if (typeof diagnostics.humanCoherenceScore === "number") {
    bits.push(`coherence ${Math.round(diagnostics.humanCoherenceScore * 100)}%`);
  }
  if (Array.isArray(diagnostics.recoveryRelaxations) && diagnostics.recoveryRelaxations.length) {
    bits.push("relaxed checks");
  }
  if (diagnostics.largestDrop?.stage && diagnostics.largestDrop.stage !== "Sampled") {
    bits.push(`biggest drop: ${diagnostics.largestDrop.stage}`);
  }
  return bits.length ? bits.slice(0, 3).join(" · ") : "";
}

function getArts(p) {
  const tracks = Array.isArray(p.tracks) ? p.tracks : [];
  const arts = [];
  for (const t of tracks) {
    const art = t.albumArt || t.album_art;
    if (art && !arts.includes(art)) arts.push(art);
    if (arts.length >= 4) break;
  }
  return arts;
}

function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

function isThisWeek(iso) {
  if (!iso) return false;
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return false;
  return Date.now() - d <= 7 * 24 * 60 * 60 * 1000;
}

function looksLikeTestPlaylist(p) {
  const text = `${p.name || ""} ${p.vibe || ""}`.toLowerCase();
  return /\b(?:test|testing|vibe|asdf|demo|delete|draft|untitled)\b/.test(text);
}

function playlistSearchText(p) {
  const tags = getTags(p).join(" ");
  return `${p.name || ""} ${p.vibe || ""} ${p.mode || ""} ${tags}`.toLowerCase();
}

function getVisiblePlaylists() {
  const q = gallerySearch.trim().toLowerCase();
  const filtered = galleryPlaylists.filter((p) => {
    if (galleryFilter === "today" && !isToday(p.createdAt)) return false;
    if (galleryFilter === "week" && !isThisWeek(p.createdAt)) return false;
    if (galleryFilter === "noSpotify" && p.spotifyUrl) return false;
    if (galleryFilter === "test" && !looksLikeTestPlaylist(p)) return false;
    return !q || playlistSearchText(p).includes(q);
  });
  return filtered.sort((a, b) => {
    const da = new Date(a.createdAt || 0).getTime();
    const db = new Date(b.createdAt || 0).getTime();
    return gallerySort === "oldest" ? da - db : db - da;
  });
}

function mosaicHtml(arts) {
  if (arts.length === 0) {
    return `<div class="gallery-card-mosaic"><div class="mosaic-empty">🎵</div></div>`;
  }
  const cells = [...arts, ...arts, ...arts, ...arts].slice(0, 4);
  return `<div class="gallery-card-mosaic">
    ${cells.map((a) => `<img class="mosaic-img" src="${esc(a)}" alt="" loading="lazy" onerror="this.style.display='none'">`).join("")}
  </div>`;
}

function renderGalleryControls(visiblePlaylists) {
  if (!galleryPlaylists.length) return "";
  const filters = [
    ["all", "All"],
    ["today", "Today"],
    ["week", "This week"],
    ["noSpotify", "No Spotify"],
    ["test", "Test-looking"],
  ];
  return `<div class="gallery-filter-panel">
    <div class="gallery-search-wrap">
      <input
        id="gallerySearchInput"
        class="gallery-search-input"
        type="search"
        placeholder="Search name, prompt, mood..."
        value="${esc(gallerySearch)}"
      >
    </div>
    <div class="gallery-filter-row">
      <div class="gallery-filter-chips">
        ${filters.map(([id, label]) => `
          <button class="gallery-filter-chip ${galleryFilter === id ? "active" : ""}" data-gallery-filter="${id}">
            ${label}
          </button>
        `).join("")}
      </div>
      <select id="gallerySortSelect" class="gallery-sort-select" aria-label="Sort playlists">
        <option value="newest" ${gallerySort === "newest" ? "selected" : ""}>Newest first</option>
        <option value="oldest" ${gallerySort === "oldest" ? "selected" : ""}>Oldest first</option>
      </select>
    </div>
    <div class="gallery-filter-meta">Showing ${visiblePlaylists.length.toLocaleString()} of ${galleryPlaylists.length.toLocaleString()}</div>
  </div>`;
}

function renderGalleryActions(playlists) {
  if (!galleryPlaylists.length) return "";
  const selectedCount = selectedPlaylistIds.size;
  return `<div class="gallery-tools">
    <div class="gallery-tools-copy">
      <strong>${selectedCount ? `${selectedCount.toLocaleString()} selected` : `${playlists.length.toLocaleString()} visible playlist${playlists.length === 1 ? "" : "s"}`}</strong>
      <span>${deleteMode ? "Select the test playlists you want to remove." : "Tip: use delete mode to clear batches from testing."}</span>
    </div>
    <div class="gallery-tools-actions">
      ${deleteMode ? `
        <button class="section-action" id="selectAllPlaylistsBtn">${playlists.length > 0 && playlists.every((p) => selectedPlaylistIds.has(Number(p.id))) ? "Clear visible" : "Select visible"}</button>
        <button class="section-action gallery-danger-action" id="deleteSelectedPlaylistsBtn" ${selectedCount === 0 || deletingPlaylists ? "disabled" : ""}>
          ${deletingPlaylists ? "Deleting..." : `Delete ${selectedCount || ""}`.trim()}
        </button>
        <button class="section-action" id="cancelDeleteModeBtn">Cancel</button>
      ` : `
        <button class="section-action gallery-danger-action" id="startDeleteModeBtn">Select to delete</button>
      `}
    </div>
  </div>`;
}

function renderCards(playlists) {
  if (galleryLoadError) {
    return `<div class="empty-state"><h3>Could not load playlists</h3><p>${esc(galleryLoadError)}</p><button class="btn btn-green btn-sm" id="galleryRetryBtn">Retry</button></div>`;
  }
  if (!playlists.length) {
    return galleryPlaylists.length
      ? `<div class="empty-state"><h3>No matches</h3><p>Try clearing the search or switching back to All.</p></div>`
      : `<div class="empty-state"><h3>No playlists yet</h3><p>Generate your first vibe from the app to see it here.</p></div>`;
  }

  return `<div class="gallery-grid">
    ${playlists.map((p) => {
      const arts = getArts(p);
      const tags = getTags(p);
      const note = generatorNote(p);
      const count = Array.isArray(p.tracks) ? p.tracks.length : (p.trackCount || 0);
      const selected = selectedPlaylistIds.has(Number(p.id));
      return `
      <div class="gallery-card ${deleteMode ? "gallery-card--selectable" : ""} ${selected ? "selected" : ""}" ${deleteMode ? `data-select-playlist-id="${p.id}" role="button" tabindex="0"` : ""}>
        ${deleteMode ? `<div class="gallery-select-check">${selected ? "✓" : ""}</div>` : ""}
        ${mosaicHtml(arts)}
        <div class="gallery-card-body">
          <div class="gallery-card-name" title="${esc(p.name)}">${esc(p.name)}</div>
          ${tags.length ? `<div class="gallery-tags">${tags.map((t) => `<span class="gallery-tag">${esc(t)}</span>`).join("")}</div>` : ""}
          ${p.vibe ? `<div class="gallery-card-quote">"${esc(p.vibe)}"</div>` : ""}
          ${note ? `<div class="gallery-generator-note">${esc(note)}</div>` : ""}
          <div class="gallery-card-meta">${count} tracks · ${fmtDate(p.createdAt)}</div>
          ${deleteMode ? "" : `<div class="gallery-card-actions">
            ${p.spotifyUrl ? `<a href="${esc(p.spotifyUrl)}" target="_blank" rel="noopener" class="btn btn-green btn-sm">${spi()} Spotify</a>` : ""}
            <a href="/p/${p.id}" class="btn btn-ghost btn-sm">Share</a>
          </div>`}
        </div>
      </div>`;
    }).join("")}
  </div>`;
}

function renderGallery() {
  const visiblePlaylists = getVisiblePlaylists();
  root.innerHTML = `
  ${navHtml()}
  <div class="gallery-wrap">
    <div class="gallery-header">
      <h1 class="gallery-title">Your playlists</h1>
      <p class="gallery-sub">Saved mixes from your liked songs. Use this page to revisit good results or clean up test runs.</p>
    </div>
    ${renderGalleryControls(visiblePlaylists)}
    ${renderGalleryActions(visiblePlaylists)}
    ${renderCards(visiblePlaylists)}
  </div>

  <a
    href="https://docs.google.com/forms/d/1dRFIgqcbNGXXHYHZqaRQ3BhFHqsFmENdmLRCs_YtWhE/edit"
    target="_blank"
    rel="noopener"
    class="feedback-fab"
    title="Send feedback"
  >💬</a>`;

  wireNavEvents();
  wireGalleryEvents();
  if (restoreGallerySearchFocus) {
    const input = document.getElementById("gallerySearchInput");
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
    restoreGallerySearchFocus = false;
  }
}

function togglePlaylistSelection(id) {
  if (selectedPlaylistIds.has(id)) selectedPlaylistIds.delete(id);
  else selectedPlaylistIds.add(id);
  renderGallery();
}

async function deleteSelectedPlaylists() {
  const ids = [...selectedPlaylistIds];
  if (!ids.length) return;
  if (!confirm(`Delete ${ids.length} playlist${ids.length === 1 ? "" : "s"}?`)) return;
  deletingPlaylists = true;
  renderGallery();
  await Promise.all(ids.map((id) => api(`/playlists/${id}`, { method: "DELETE" })));
  galleryPlaylists = galleryPlaylists.filter((p) => !selectedPlaylistIds.has(Number(p.id)));
  selectedPlaylistIds = new Set();
  deleteMode = false;
  deletingPlaylists = false;
  renderGallery();
}

function wireGalleryEvents() {
  document.getElementById("startDeleteModeBtn")?.addEventListener("click", () => {
    deleteMode = true;
    selectedPlaylistIds = new Set();
    renderGallery();
  });
  document.getElementById("cancelDeleteModeBtn")?.addEventListener("click", () => {
    deleteMode = false;
    selectedPlaylistIds = new Set();
    renderGallery();
  });
  document.getElementById("selectAllPlaylistsBtn")?.addEventListener("click", () => {
    const visibleIds = getVisiblePlaylists().map((p) => Number(p.id));
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedPlaylistIds.has(id));
    if (allVisibleSelected) {
      visibleIds.forEach((id) => selectedPlaylistIds.delete(id));
    } else {
      visibleIds.forEach((id) => selectedPlaylistIds.add(id));
    }
    renderGallery();
  });
  document.getElementById("deleteSelectedPlaylistsBtn")?.addEventListener("click", deleteSelectedPlaylists);
  document.getElementById("galleryRetryBtn")?.addEventListener("click", boot);
  document.querySelectorAll("[data-gallery-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      galleryFilter = btn.dataset.galleryFilter || "all";
      renderGallery();
    });
  });
  document.getElementById("gallerySearchInput")?.addEventListener("input", (e) => {
    gallerySearch = e.target.value;
    restoreGallerySearchFocus = true;
    renderGallery();
  });
  document.getElementById("gallerySortSelect")?.addEventListener("change", (e) => {
    gallerySort = e.target.value === "oldest" ? "oldest" : "newest";
    renderGallery();
  });
  document.querySelectorAll("[data-select-playlist-id]").forEach((card) => {
    const id = Number(card.dataset.selectPlaylistId);
    card.addEventListener("click", () => togglePlaylistSelection(id));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        togglePlaylistSelection(id);
      }
    });
  });
}

async function boot() {
  document.title = "Gallery — Kwalify";

  root.innerHTML = navHtml() + `<div class="loading-shell"><div class="spinner"></div><span>Loading…</span></div>`;

  const meRes = await api("/auth/me").catch((err) => ({ ok: false, status: 0, data: { error: err.message } }));
  if (meRes.status === 401 || !meRes.ok) {
    if (meRes.status === 401) window.location.href = "/";
    else root.innerHTML = navHtml() + `<div class="empty-state"><h3>Could not load gallery</h3><p>Check your connection and refresh.</p></div>`;
    return;
  }
  galleryUser = meRes.data;

  const plRes = await api("/playlists").catch((err) => ({ ok: false, status: 0, data: { error: err.message } }));
  if (plRes.ok) {
    galleryLoadError = null;
    galleryPlaylists = plRes.data.playlists || [];
  } else {
    galleryLoadError = plRes.data?.error || plRes.data?.message || "Refresh and try again.";
    galleryPlaylists = [];
  }
  renderGallery();
}

boot();
