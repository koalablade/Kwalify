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
  document.addEventListener("click", (e) => {
    if (!document.getElementById("galleryProfileWrap")?.contains(e.target)) {
      profileOpen = false;
      document.getElementById("galleryProfileDropdown")?.classList.remove("open");
    }
  });
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

function mosaicHtml(arts) {
  if (arts.length === 0) {
    return `<div class="gallery-card-mosaic"><div class="mosaic-empty">🎵</div></div>`;
  }
  const cells = [...arts, ...arts, ...arts, ...arts].slice(0, 4);
  return `<div class="gallery-card-mosaic">
    ${cells.map((a) => `<img class="mosaic-img" src="${esc(a)}" alt="" loading="lazy" onerror="this.style.display='none'">`).join("")}
  </div>`;
}

function renderCards(playlists) {
  if (!playlists.length) {
    return `<div class="empty-state"><h3>No playlists yet</h3><p>Generate your first vibe from the app to see it here.</p></div>`;
  }

  return `<div class="gallery-grid">
    ${playlists.map((p) => {
      const arts = getArts(p);
      const tags = getTags(p);
      const count = Array.isArray(p.tracks) ? p.tracks.length : (p.trackCount || 0);
      return `
      <div class="gallery-card">
        ${mosaicHtml(arts)}
        <div class="gallery-card-body">
          <div class="gallery-card-name" title="${esc(p.name)}">${esc(p.name)}</div>
          ${tags.length ? `<div class="gallery-tags">${tags.map((t) => `<span class="gallery-tag">${esc(t)}</span>`).join("")}</div>` : ""}
          ${p.vibe ? `<div class="gallery-card-quote">"${esc(p.vibe)}"</div>` : ""}
          <div class="gallery-card-meta">${count} tracks · ${fmtDate(p.createdAt)}</div>
          <div class="gallery-card-actions">
            ${p.spotifyUrl ? `<a href="${esc(p.spotifyUrl)}" target="_blank" rel="noopener" class="btn btn-green btn-sm">${spi()} Spotify</a>` : ""}
            <a href="/p/${p.id}" class="btn btn-ghost btn-sm">Share</a>
          </div>
        </div>
      </div>`;
    }).join("")}
  </div>`;
}

async function boot() {
  document.title = "Gallery — Kwalify";

  root.innerHTML = navHtml() + `<div class="loading-shell"><div class="spinner"></div><span>Loading…</span></div>`;

  const meRes = await api("/auth/me");
  if (meRes.status === 401 || !meRes.ok) {
    window.location.href = "/";
    return;
  }
  galleryUser = meRes.data;

  const plRes = await api("/playlists");
  const playlists = plRes.ok ? (plRes.data.playlists || []) : [];

  root.innerHTML = `
  ${navHtml()}
  <div class="gallery-wrap">
    <div class="gallery-header">
      <h1 class="gallery-title">Your playlists</h1>
      <p class="gallery-sub">Every playlist built from songs you already loved — no recommendations, just your library curated for the moment.</p>
    </div>
    ${renderCards(playlists)}
  </div>

  <a
    href="https://docs.google.com/forms/d/1dRFIgqcbNGXXHYHZqaRQ3BhFHqsFmENdmLRCs_YtWhE/edit"
    target="_blank"
    rel="noopener"
    class="feedback-fab"
    title="Send feedback"
  >💬</a>`;

  wireNavEvents();
}

boot();
