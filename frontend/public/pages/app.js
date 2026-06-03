// ── Kwalify · Single app entry point ─────────────────────────────────────────
const root = document.getElementById("appRoot");

// ── Helpers ──────────────────────────────────────────────────────────────────
function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

async function api(path, opts = {}) {
  const r = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}

function timeAgo(iso) {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  } catch { return ""; }
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  } catch { return ""; }
}

function spi() {
  return `<span class="spi"><svg width="11" height="11" viewBox="0 0 24 24" fill="#1db954"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg></span>`;
}

// ── Single state store ────────────────────────────────────────────────────────
const state = {
  user: null,
  cacheStatus: null,
  librarySummary: null,
  playlists: [],
  history: [],
  mode: "balanced",
  length: 40,
  generating: false,
  lastResult: null,
  error: null,
  tasteOpen: false,
};

// ── Nav ───────────────────────────────────────────────────────────────────────
function navHtml(user) {
  const cs = state.cacheStatus;
  const syncing = cs?.isSyncing;
  const total = cs?.totalTracks || 0;
  const syncLabel = total > 0 ? `${total.toLocaleString()} synced` : syncing ? "Syncing…" : "Sync library";
  const initials = (user?.displayName || "U").charAt(0).toUpperCase();
  const avatar = user?.avatarUrl
    ? `<img src="${esc(user.avatarUrl)}" alt="">`
    : initials;

  return `
  <nav class="nav">
    <div class="nav-logo">
      <div class="nav-logo-mark">K</div>
      <span>Kwalify</span>
    </div>
    <div class="nav-right">
      <a href="/gallery" class="nav-link">Gallery <span class="nav-link-arrow">→</span></a>
      <div class="nav-sync-chip">
        <span class="sync-dot ${syncing ? "sync-dot--live" : ""}"></span>
        <span>${syncLabel}</span>
      </div>
      <div class="nav-avatar-group">
        <div class="nav-avatar">${avatar}</div>
        <button id="logoutBtn" class="nav-logout" title="Log out">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        </button>
      </div>
    </div>
  </nav>`;
}

// ── Landing page ──────────────────────────────────────────────────────────────
function renderLanding() {
  document.title = "Kwalify — Moment-to-Music from your liked songs";
  root.innerHTML = `
  <nav class="nav">
    <div class="nav-logo">
      <div class="nav-logo-mark">K</div>
      <span>Kwalify</span>
    </div>
    <div class="nav-right">
      <a href="/api/auth/login" class="btn btn-green btn-sm">${spi()} Connect Spotify</a>
    </div>
  </nav>

  <div class="landing-page">

    <section class="hero">
      <div class="hero-eyebrow">
        <span class="hero-eyebrow-dot"></span>
        From your liked songs only
      </div>
      <h1>What's the <em>moment</em>?</h1>
      <p class="hero-sub">Describe a feeling — we'll build a playlist entirely from songs you already love.</p>

      <div class="hero-demo">
        <div class="hero-demo-box">
          <div class="hero-demo-placeholder">empty petrol station at 2am<span class="hero-demo-cursor"></span></div>
        </div>
        <div class="hero-chips">
          <span class="hero-chip">"Driving somewhere you don't need to be"</span>
          <span class="hero-chip">"Late night thinking about everything"</span>
          <span class="hero-chip">"First warm day after winter"</span>
          <span class="hero-chip">"Walking home after a good night"</span>
        </div>
      </div>

      <a href="/api/auth/login" class="btn btn-green btn-lg hero-cta">${spi()} Get started — free</a>
      <div class="hero-trust">
        <span>No credit card</span>
        <span class="hero-trust-sep">·</span>
        <span>Only reads your liked songs</span>
        <span class="hero-trust-sep">·</span>
        <span>Private playlists</span>
      </div>
    </section>

    <section class="how-section">
      <div class="how-label">How it works</div>
      <h2 class="how-title">Three steps to your soundtrack</h2>
      <p class="how-sub">No recommendations. No new music. Just the right songs from the library you spent years building.</p>
      <div class="how-steps">
        <div class="how-step">
          <div class="how-step-num">Step 01</div>
          <div class="how-step-icon">🎵</div>
          <h3>Connect Spotify</h3>
          <p>We read only your Liked Songs. Nothing else is accessed or stored.</p>
        </div>
        <div class="how-step">
          <div class="how-step-num">Step 02</div>
          <div class="how-step-icon">💬</div>
          <h3>Describe the moment</h3>
          <p>One sentence. A time, a place, a feeling. As specific as you like.</p>
        </div>
        <div class="how-step">
          <div class="how-step-num">Step 03</div>
          <div class="how-step-icon">⚡</div>
          <h3>Get the playlist</h3>
          <p>A private playlist lands in your Spotify within seconds. Every track is one you already saved.</p>
        </div>
      </div>
    </section>

    <section class="features-section">
      <div style="text-align:center;margin-bottom:32px;">
        <div class="how-label">Why Kwalify</div>
        <h2 class="how-title">Not Discover Weekly</h2>
      </div>
      <div class="features-grid">
        <div class="feature-card">
          <div class="feature-icon">🧠</div>
          <h3>Moment-aware scoring</h3>
          <p>Parses your scene into emotion, time, energy, and motion — then scores every liked track against all of it.</p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">🎲</div>
          <h3>Strict · Balanced · Chaotic</h3>
          <p>Choose how closely the playlist matches your vibe. Balanced ensures artist variety and tempo diversity.</p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">🔒</div>
          <h3>Your data, always yours</h3>
          <p>Only your Liked Songs are read. We never store your listening history or surface data outside your library.</p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">🎯</div>
          <h3>One prompt, done</h3>
          <p>Describe the moment, hit Generate. A shareable playlist is in Spotify in under 15 seconds.</p>
        </div>
      </div>
    </section>

    <section class="cta-section">
      <h2>Ready to hear it?</h2>
      <p>Connect Spotify and describe your first moment. Takes 10 seconds.</p>
      <a href="/api/auth/login" class="btn btn-green btn-lg">${spi()} Connect with Spotify — free</a>
    </section>

  </div>`;
}

// ── App page (logged in) ──────────────────────────────────────────────────────
const QUICK_MOMENTS = [
  "Driving somewhere you don't need to be",
  "Late night thinking about everything",
  "First warm day after winter",
  "Cleaning your room and finding old memories",
  "Walking home after a good night",
  "Empty streets at golden hour",
  "Rainy Sunday with nowhere to be",
];

const MOOD_BARS = [
  { label: "Energy",    value: 20, cls: "fill-blue",   id: "mb-energy" },
  { label: "Nostalgia", value: 85, cls: "fill-purple",  id: "mb-nostalgia" },
  { label: "Melancholy",value: 55, cls: "fill-indigo",  id: "mb-melancholy" },
  { label: "Movement",  value: 15, cls: "fill-teal",    id: "mb-movement" },
  { label: "Warmth",    value: 45, cls: "fill-amber",   id: "mb-warmth" },
];

function renderApp() {
  const cs = state.cacheStatus;
  const ls = state.librarySummary;
  const total = cs?.totalTracks || ls?.trackCount || 0;
  const lastSynced = cs?.lastSyncedAt ? timeAgo(cs.lastSyncedAt) : null;
  const span = ls?.oldestLikedYear && ls?.newestLikedYear
    ? `${ls.oldestLikedYear}–${ls.newestLikedYear}`
    : "—";

  const errorHtml = state.error
    ? `<div class="alert alert-error">${esc(state.error)}</div>`
    : "";

  // History items
  const histItems = state.history.slice(0, 5).map((h) => `
    <div class="phase-item">
      <div class="phase-quote">"${esc(h.vibe)}"</div>
      <div class="phase-meta">${fmtDate(h.createdAt || h.timestamp || "")}</div>
    </div>`).join("") || `
    <div class="phase-item"><div class="phase-quote">"driving through empty city streets while it rains"</div><div class="phase-meta">2 days ago</div></div>
    <div class="phase-item"><div class="phase-quote">"late night highway with nowhere to be"</div><div class="phase-meta">4 days ago</div></div>`;

  // Playlist items
  const plItems = state.playlists.length > 0
    ? state.playlists.slice(0, 5).map((p) => {
        const count = Array.isArray(p.tracks) ? p.tracks.length : (p.trackCount || 0);
        return `
        <div class="phase-item">
          <div>
            <div class="phase-quote" style="font-style:normal;font-weight:600">${esc(p.name)}</div>
            <div class="phase-meta">${count} tracks · ${fmtDate(p.createdAt)}</div>
          </div>
          <div class="phase-item-actions">
            ${p.spotifyUrl ? `<a href="${esc(p.spotifyUrl)}" target="_blank" rel="noopener" class="phase-open">${spi()}</a>` : ""}
            <button class="delete-btn" data-id="${p.id}" title="Delete">✕</button>
          </div>
        </div>`;
      }).join("")
    : `<div class="phase-item"><div class="phase-quote" style="font-style:normal">No playlists yet — generate your first vibe.</div></div>`;

  const moodBarsHtml = MOOD_BARS.map((b) => `
    <div class="mood-bar-row">
      <div class="mood-bar-labels">
        <span>${b.label}</span>
        <span class="mood-bar-level">${b.value > 70 ? "High" : b.value > 30 ? "Med" : "Low"}</span>
      </div>
      <div class="mood-track">
        <div class="mood-fill ${b.cls}" id="${b.id}" style="width:0%"></div>
      </div>
    </div>`).join("");

  root.innerHTML = `
  ${navHtml(state.user)}

  <div class="app-wrap">

    ${errorHtml}

    <div class="input-grid">

      <!-- Vibe input -->
      <div class="vibe-col">
        <div>
          <h1 class="vibe-heading">What's the moment?</h1>
          <p class="vibe-sub">Describe it — we'll build a playlist from songs you already love.</p>
        </div>

        <div class="vibe-input-wrap">
          <div class="vibe-glow"></div>
          <div class="vibe-inner">
            <textarea
              id="vibeInput"
              class="vibe-textarea"
              placeholder="e.g. empty petrol station at 2am"
              maxlength="140"
              autocomplete="off"
              rows="4"
            ></textarea>
            <div class="vibe-footer">
              <span class="vibe-hint">Enter ↵ to generate</span>
              <span class="vibe-count"><span id="charCount">0</span>/140</span>
            </div>
          </div>
        </div>

        <div class="controls-row">
          <div class="mode-group">
            <button class="mode-btn ${state.mode === "strict"   ? "active" : ""}" data-mode="strict">Strict</button>
            <button class="mode-btn ${state.mode === "balanced" ? "active" : ""}" data-mode="balanced">Balanced</button>
            <button class="mode-btn ${state.mode === "chaotic"  ? "active" : ""}" data-mode="chaotic">Chaotic</button>
          </div>
          <div class="length-row">
            <svg class="length-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <input type="range" class="length-slider" id="lengthSlider" min="20" max="60" step="5" value="${state.length}">
            <span class="length-val" id="lengthLabel">${state.length} tracks</span>
          </div>
        </div>

        <button id="generateBtn" class="gen-btn ${state.generating ? "loading" : ""}" ${state.generating ? "disabled" : ""}>
          ${state.generating
            ? `<span class="spinner spinner--sm"></span> Generating…`
            : `Generate playlist <span class="btn-arrow">→</span>`}
        </button>
      </div>

      <!-- Live mood interpreter -->
      <div class="mood-col">
        <div class="mood-panel">
          <div class="mood-glow" id="moodGlow"></div>
          <div class="mood-head">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            <span id="moodStatus">Awaiting input…</span>
          </div>
          <div class="mood-bars">${moodBarsHtml}</div>
          <div class="mood-tags-wrap">
            <div class="mood-tags-label">Scene Tags</div>
            <div class="mood-tags-row" id="moodTags">
              ${["Late night","Urban","Solitude","Still"].map((t, i) =>
                `<span class="mood-tag" style="opacity:0.2;transition:opacity 0.5s ${i * 0.1}s">${t}</span>`
              ).join("")}
            </div>
          </div>
          <div class="mood-style">
            <div class="mood-style-label">Predicted Style</div>
            <div class="mood-style-text" id="moodStyleText" style="opacity:0">"Slow, atmospheric, late-night focused"</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Generation progress / Result -->
    ${state.generating ? generatingHtml() : ""}
    ${state.lastResult ? resultHtml(state.lastResult) : ""}

    <!-- Quick moments -->
    <div class="quick-section">
      <div class="label">Quick Moments</div>
      <div class="chips-row hide-scrollbar" id="quickChips">
        ${QUICK_MOMENTS.map((m) => `<button class="quick-chip" data-vibe="${esc(m)}">${esc(m)}</button>`).join("")}
      </div>
    </div>

    <!-- Taste profile -->
    <div class="taste-strip">
      <button class="taste-toggle" id="tasteToggle">
        <div class="taste-toggle-left">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${"#1db954"}" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
          Your taste profile
        </div>
        <svg class="taste-chevron ${state.tasteOpen ? "open" : ""}" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="taste-body ${state.tasteOpen ? "open" : ""}" id="tasteBody">
        <div class="taste-grid">
          <div class="taste-cell">
            <span class="taste-cell-label">Dominant vibe</span>
            <span class="taste-cell-value">Nostalgic / High-energy</span>
          </div>
          <div class="taste-cell">
            <span class="taste-cell-label">Listening span</span>
            <span class="taste-cell-value">${span}</span>
          </div>
          <div class="taste-cell">
            <span class="taste-cell-label">Era gravity</span>
            <span class="taste-cell-value">Revisit most: 2020–2022</span>
          </div>
          <div class="taste-cell">
            <span class="taste-cell-label">Sync status</span>
            <span class="taste-cell-value">${total > 0 ? `${total.toLocaleString()} tracks${lastSynced ? ` · ${lastSynced}` : ""}` : "Not yet synced"}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Recent history & playlists -->
    <div class="recent-section">
      <div class="section-head">
        <h3 class="section-title">Recent activity</h3>
        <button id="syncBtn" class="section-action" ${cs?.isSyncing ? "disabled" : ""}>
          ${cs?.isSyncing ? "Syncing…" : total > 0 ? "Full sync" : "Sync library"}
        </button>
      </div>
      <div class="phases-grid">
        <div class="phase-group">
          <div class="phase-group-head phase-head-green">Recent moments</div>
          <div class="phase-items">${histItems}</div>
        </div>
        <div class="phase-group">
          <div class="phase-group-head phase-head-purple">Recent playlists</div>
          <div class="phase-items">${plItems}</div>
          ${state.playlists.length > 5 ? `
          <div style="padding:10px 16px;border-top:1px solid var(--border)">
            <a href="/gallery" style="font-size:13px;color:var(--muted);text-decoration:underline">
              View all ${state.playlists.length} playlists in Gallery →
            </a>
          </div>` : ""}
        </div>
      </div>
    </div>

  </div>

  <footer class="app-footer">
    <a href="/gallery" class="footer-link">Gallery →</a>
    <div class="footer-right">
      <span class="badge badge-muted">Beta</span>
      <a href="mailto:feedback@kwalify.net" class="footer-link">Send feedback</a>
    </div>
  </footer>`;

  wireAppEvents();
}

function generatingHtml() {
  return `
  <div class="generating-card">
    <span class="spinner spinner--purple"></span>
    <div>
      <div class="generating-title">Building your playlist…</div>
      <div class="generating-sub">Scoring your library against the moment. Takes about 10 seconds.</div>
    </div>
  </div>`;
}

function resultHtml(result) {
  const count = result.trackCount || (Array.isArray(result.tracks) ? result.tracks.length : 0);
  const name = esc(result.playlistName || result.name || "Playlist created");
  return `
  <div class="result-card">
    <div class="result-art">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
    </div>
    <div class="result-body">
      <div class="result-top">
        <span class="badge badge-green">Ready</span>
        <span class="result-meta">${count} tracks · ${state.mode} mode</span>
      </div>
      <h2 class="result-title">${name}</h2>
      <p class="result-insight">Curated from your liked songs to fit the moment.</p>
      <div class="result-vibes">
        <span class="vibe-dot vd-purple"></span><span>Nostalgic</span>
        <span class="vibe-dot vd-indigo"></span><span>Atmospheric</span>
        <span class="vibe-dot vd-blue"></span><span>Low-energy</span>
      </div>
      <div class="result-actions">
        ${result.spotifyPlaylistUrl ? `<a href="${esc(result.spotifyPlaylistUrl)}" target="_blank" rel="noopener" class="btn btn-green">${spi()} Open in Spotify</a>` : ""}
        ${result.savedPlaylistId ? `<a href="/p/${result.savedPlaylistId}" class="btn btn-ghost btn-sm">Share link</a>` : ""}
      </div>
    </div>
  </div>`;
}

// ── Event wiring ──────────────────────────────────────────────────────────────
function wireAppEvents() {
  document.getElementById("logoutBtn")?.addEventListener("click", logout);
  document.getElementById("syncBtn")?.addEventListener("click", triggerSync);
  document.getElementById("generateBtn")?.addEventListener("click", generate);

  const vibeInput = document.getElementById("vibeInput");
  const charCount = document.getElementById("charCount");
  let interpretTimer = null;

  vibeInput?.addEventListener("input", () => {
    const len = vibeInput.value.length;
    charCount.textContent = len;
    clearTimeout(interpretTimer);

    if (len > 5) {
      document.getElementById("moodGlow")?.classList.add("active");
      document.getElementById("moodStatus").textContent = "Reading the moment…";
      MOOD_BARS.forEach((b) => {
        const el = document.getElementById(b.id);
        if (el) el.style.width = b.value + "%";
      });
      document.querySelectorAll(".mood-tag").forEach((t) => { t.style.opacity = "1"; });
      const style = document.getElementById("moodStyleText");
      if (style) style.style.opacity = "1";
      interpretTimer = setTimeout(() => {
        document.getElementById("moodStatus").textContent = "Moment analyzed";
        document.getElementById("moodGlow")?.classList.remove("active");
      }, 1400);
    } else {
      document.getElementById("moodGlow")?.classList.remove("active");
      document.getElementById("moodStatus").textContent = "Awaiting input…";
      MOOD_BARS.forEach((b) => {
        const el = document.getElementById(b.id);
        if (el) el.style.width = "0%";
      });
      document.querySelectorAll(".mood-tag").forEach((t) => { t.style.opacity = "0.2"; });
      const style = document.getElementById("moodStyleText");
      if (style) style.style.opacity = "0";
    }
  });

  vibeInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); generate(); }
  });

  document.getElementById("lengthSlider")?.addEventListener("input", (e) => {
    state.length = Number(e.target.value);
    document.getElementById("lengthLabel").textContent = `${state.length} tracks`;
  });

  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.mode = btn.dataset.mode;
      document.querySelectorAll(".mode-btn").forEach((b) =>
        b.classList.toggle("active", b.dataset.mode === state.mode)
      );
    });
  });

  document.querySelectorAll(".quick-chip[data-vibe]").forEach((chip) => {
    chip.addEventListener("click", () => {
      vibeInput.value = chip.dataset.vibe;
      charCount.textContent = vibeInput.value.length;
      vibeInput.dispatchEvent(new Event("input"));
      vibeInput.focus();
    });
  });

  document.getElementById("tasteToggle")?.addEventListener("click", () => {
    state.tasteOpen = !state.tasteOpen;
    document.getElementById("tasteBody")?.classList.toggle("open", state.tasteOpen);
    document.querySelector(".taste-chevron")?.classList.toggle("open", state.tasteOpen);
  });

  document.querySelectorAll(".delete-btn[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => deletePlaylist(Number(btn.dataset.id)));
  });

  // Ctrl/Cmd+K to focus input
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      vibeInput?.focus();
      vibeInput?.select();
    }
  });
}

// ── Actions ───────────────────────────────────────────────────────────────────
async function logout() {
  await api("/auth/logout", { method: "POST" });
  Object.assign(state, {
    user: null, cacheStatus: null, librarySummary: null,
    playlists: [], history: [], lastResult: null, error: null,
  });
  renderLanding();
}

async function triggerSync() {
  const btn = document.getElementById("syncBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Syncing…"; }
  await api("/spotify/sync", { method: "POST", body: JSON.stringify({ full: true }) });
  setTimeout(pollStatus, 2000);
}

async function pollStatus() {
  const [csRes, lsRes] = await Promise.all([
    api("/spotify/cache-status"),
    api("/library/summary"),
  ]);
  if (csRes.ok) state.cacheStatus = csRes.data;
  if (lsRes.ok) state.librarySummary = lsRes.data;
  renderApp();
  if (state.cacheStatus?.isSyncing) setTimeout(pollStatus, 3000);
}

async function loadPlaylists() {
  const [plRes, histRes] = await Promise.all([
    api("/playlists"),
    api("/history"),
  ]);
  if (plRes.ok) state.playlists = plRes.data.playlists || [];
  if (histRes.ok) state.history = Array.isArray(histRes.data) ? histRes.data : [];
}

async function deletePlaylist(id) {
  if (!confirm("Delete this playlist?")) return;
  const r = await api(`/playlists/${id}`, { method: "DELETE" });
  if (r.ok) {
    state.playlists = state.playlists.filter((p) => p.id !== id);
    renderApp();
  }
}

async function generate() {
  const vibeInput = document.getElementById("vibeInput");
  const vibe = vibeInput?.value.trim();
  if (!vibe) { vibeInput?.focus(); return; }
  if (state.generating) return;

  state.generating = true;
  state.lastResult = null;
  state.error = null;
  renderApp();

  const savedVibe = vibe;

  try {
    const r = await api("/generate", {
      method: "POST",
      body: JSON.stringify({ vibe, mode: state.mode, length: state.length }),
    });

    if (r.status === 401) { window.location.href = "/api/auth/login"; return; }

    if (!r.ok) {
      state.error = r.data?.error || r.data?.message || "Generation failed. Please try again.";
    } else {
      state.lastResult = { ...r.data, savedPlaylistId: r.data.playlistId };
      await loadPlaylists();
    }
  } catch (e) {
    state.error = e.message || "Generation failed. Please try again.";
  } finally {
    state.generating = false;
    renderApp();
    const input = document.getElementById("vibeInput");
    if (input) {
      input.value = savedVibe;
      document.getElementById("charCount").textContent = savedVibe.length;
      input.dispatchEvent(new Event("input"));
    }
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  root.innerHTML = `<div class="loading-shell"><div class="spinner"></div><span>Loading…</span></div>`;

  const meRes = await api("/auth/me");

  if (meRes.status === 401 || !meRes.ok) {
    renderLanding();
    return;
  }

  state.user = meRes.data;

  const [csRes, lsRes, plRes, histRes] = await Promise.all([
    api("/spotify/cache-status"),
    api("/library/summary"),
    api("/playlists"),
    api("/history"),
  ]);

  if (csRes.ok) state.cacheStatus = csRes.data;
  if (lsRes.ok) state.librarySummary = lsRes.data;
  if (plRes.ok) state.playlists = plRes.data.playlists || [];
  if (histRes.ok) state.history = Array.isArray(histRes.data) ? histRes.data : [];

  renderApp();

  if (state.cacheStatus?.isSyncing) setTimeout(pollStatus, 3000);
}

boot();
