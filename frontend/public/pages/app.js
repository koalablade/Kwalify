// ── Kwalify App ──────────────────────────────────────────────────────────────
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

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  } catch { return ""; }
}

function spotifyIconSvg() {
  return `<span class="spotify-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="#1db954"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg></span>`;
}

// ── State ─────────────────────────────────────────────────────────────────────
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
  tasteExpanded: false,
};

// ── Landing page (not logged in) ──────────────────────────────────────────────
function renderLanding() {
  root.innerHTML = `
  <nav class="nav">
    <div class="nav-logo">
      <div class="nav-logo-badge">K</div>
      <span>Kwalify</span>
    </div>
    <div class="nav-right">
      <a href="/api/auth/login" class="btn btn-green btn-sm">${spotifyIconSvg()} Connect with Spotify</a>
    </div>
  </nav>

  <section class="landing-hero">
    <div class="landing-eyebrow">Moment-to-Music · From your liked songs</div>
    <h1>What's the moment?</h1>
    <p>Describe it — we'll build a playlist from songs you already love.</p>

    <div class="landing-input-wrap">
      <div class="landing-input-field">
        <span class="landing-input-placeholder">e.g. empty petrol station at 2am</span>
      </div>
      <div class="landing-prompts-scroll">
        <div class="landing-prompt-chip">"Driving somewhere you don't need to be"</div>
        <div class="landing-prompt-chip">"Late night thinking about everything"</div>
        <div class="landing-prompt-chip">"First warm day after winter"</div>
        <div class="landing-prompt-chip">"Walking home after a good night"</div>
      </div>
    </div>

    <a href="/api/auth/login" class="btn btn-green btn-lg landing-cta-btn">${spotifyIconSvg()} Get started — free</a>
    <p class="landing-trust">No credit card · Reads only your liked songs · Private playlists</p>
  </section>

  <section class="landing-how">
    <div class="landing-how-label">Not Discover Weekly</div>
    <h2 class="landing-how-title">Every track is already one you saved</h2>
    <p class="landing-how-sub">Kwalify doesn't recommend new music. It finds the right songs inside a library you spent years building — then arranges them into the exact moment you're in.</p>

    <div class="landing-features">
      <div class="landing-feature">
        <div class="landing-feature-icon">🧠</div>
        <h3>Moment-aware matching</h3>
        <p>Parses your scene into emotion, time, energy and motion — then scores every liked track against it.</p>
      </div>
      <div class="landing-feature">
        <div class="landing-feature-icon">🎲</div>
        <h3>Strict · Balanced · Chaotic</h3>
        <p>Control how closely tracks match your vibe. Balanced ensures artist variety and tempo diversity.</p>
      </div>
      <div class="landing-feature">
        <div class="landing-feature-icon">⚡</div>
        <h3>One prompt, done</h3>
        <p>Describe the moment, hit Generate. A private playlist appears in your Spotify in seconds.</p>
      </div>
      <div class="landing-feature">
        <div class="landing-feature-icon">🔒</div>
        <h3>Your library, your data</h3>
        <p>Only reads your liked songs. We never store your listening data or recommend outside your library.</p>
      </div>
    </div>
  </section>

  <section class="landing-cta-bottom">
    <h2>Ready to hear it?</h2>
    <p>Connect Spotify and describe your first moment. Takes 10 seconds.</p>
    <a href="/api/auth/login" class="btn btn-green btn-lg">${spotifyIconSvg()} Connect with Spotify — free</a>
  </section>
  `;
}

// ── Nav HTML ──────────────────────────────────────────────────────────────────
function navHtml(user) {
  const cs = state.cacheStatus;
  const totalTracks = cs?.totalTracks || 0;
  const isSyncing = cs?.isSyncing;
  const initials = (user?.displayName || "U").charAt(0).toUpperCase();
  const avatarHtml = user?.avatarUrl
    ? `<img src="${esc(user.avatarUrl)}" alt="">`
    : initials;

  const syncDot = isSyncing
    ? `<span class="nav-sync-dot nav-sync-dot--active"></span>`
    : `<span class="nav-sync-dot"></span>`;

  const syncLabel = totalTracks > 0
    ? `${totalTracks.toLocaleString()} synced`
    : isSyncing ? "Syncing…" : "Sync library";

  return `
  <nav class="nav">
    <div class="nav-logo">
      <div class="nav-logo-badge">K</div>
      <span>Kwalify</span>
    </div>
    <div class="nav-right">
      <a href="/gallery" class="nav-ghost-link">Gallery <span class="nav-arrow">→</span></a>
      <div class="nav-sync-pill">
        ${syncDot}
        <span>${syncLabel}</span>
      </div>
      <div class="nav-user-group">
        <div class="nav-avatar">${avatarHtml}</div>
        <button id="logoutBtn" class="nav-logout-btn" title="Log out">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        </button>
      </div>
    </div>
  </nav>`;
}

// ── App page (logged in) ──────────────────────────────────────────────────────
const QUICK_MOMENTS = [
  "Driving somewhere you don't need to be",
  "Late night thinking about everything",
  "First warm day after winter",
  "Cleaning your room and finding old memories",
  "Walking home after a good night",
];

function renderApp() {
  const cs = state.cacheStatus;
  const ls = state.librarySummary;
  const totalTracks = cs?.totalTracks || ls?.trackCount || 0;
  const lastSynced = cs?.lastSyncedAt
    ? (() => {
        const diff = Date.now() - new Date(cs.lastSyncedAt).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return "just now";
        if (mins < 60) return `${mins}m ago`;
        return `${Math.floor(mins / 60)}h ago`;
      })()
    : null;

  const errorHtml = state.error
    ? `<div class="alert alert-error">${esc(state.error)}</div>`
    : "";

  // History grouped into phases (use real history if available)
  const recentHistory = state.history.slice(0, 5);
  const phasesHtml = recentHistory.length > 0
    ? recentHistory.map((h) => `
      <div class="phase-item">
        <div class="phase-item-quote">"${esc(h.vibe)}"</div>
        <div class="phase-item-meta">${formatDate(h.createdAt || h.timestamp || "")}</div>
      </div>`).join("")
    : `
      <div class="phase-item"><div class="phase-item-quote">"driving through empty city streets while it rains"</div><div class="phase-item-meta">2 days ago</div></div>
      <div class="phase-item"><div class="phase-item-quote">"late night highway with nowhere to be"</div><div class="phase-item-meta">4 days ago</div></div>`;

  const recentPlaylists = state.playlists.slice(0, 5).map((p) => {
    const trackCount = Array.isArray(p.tracks) ? p.tracks.length : (p.trackCount || 0);
    return `
    <div class="playlist-row">
      <div class="playlist-row-info">
        <div class="playlist-row-name">${esc(p.name)}</div>
        <div class="playlist-row-meta">${trackCount} tracks · ${formatDate(p.createdAt)}</div>
      </div>
      <div class="playlist-row-actions">
        ${p.spotifyUrl ? `<a href="${esc(p.spotifyUrl)}" target="_blank" rel="noopener" class="btn btn-green btn-sm">${spotifyIconSvg()} Spotify</a>` : ""}
        <a href="/p/${p.id}" target="_blank" class="btn btn-ghost btn-sm">Share</a>
        <button class="playlist-delete-btn" data-id="${p.id}" title="Delete">✕</button>
      </div>
    </div>`;
  }).join("");

  const span = ls?.oldestLikedYear && ls?.newestLikedYear
    ? `${ls.oldestLikedYear}–${ls.newestLikedYear}`
    : "2016–2026";

  root.innerHTML = `
  ${navHtml(state.user)}

  <main class="app-main">

    ${errorHtml}

    <!-- HERO + MOOD INTERPRETER -->
    <div class="app-hero-grid">

      <!-- VibeInputCard -->
      <div class="vibe-col">
        <div class="vibe-heading-block">
          <h1 class="vibe-heading">What's the moment?</h1>
          <p class="vibe-sub">Describe it — we'll build a playlist from songs you already love.</p>
        </div>

        <div class="vibe-textarea-wrap" id="vibeTextareaWrap">
          <div class="vibe-glow" id="vibeGlow"></div>
          <div class="vibe-textarea-inner">
            <textarea
              id="vibeInput"
              class="vibe-textarea"
              placeholder="e.g. empty petrol station at 2am"
              maxlength="140"
              autocomplete="off"
              rows="4"
            ></textarea>
            <div class="vibe-char-count"><span id="charCount">0</span>/140</div>
          </div>
        </div>

        <div class="vibe-controls">
          <div class="mode-toggle" id="modeToggle">
            <button class="mode-btn ${state.mode === "strict" ? "active" : ""}" data-mode="strict">Strict</button>
            <button class="mode-btn ${state.mode === "balanced" ? "active" : ""}" data-mode="balanced">Balanced</button>
            <button class="mode-btn ${state.mode === "chaotic" ? "active" : ""}" data-mode="chaotic">Chaotic</button>
          </div>
          <div class="vibe-length-row">
            <svg class="vibe-length-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <input type="range" class="length-slider" id="lengthSlider" min="20" max="60" step="5" value="${state.length}">
            <span class="length-value" id="lengthLabel">${state.length} tracks</span>
          </div>
        </div>

        <button id="generateBtn" class="vibe-generate-btn ${state.generating ? "loading" : ""}">
          ${state.generating
            ? `<span class="gen-spin"></span> Generating…`
            : `Generate playlist <span class="btn-arrow">→</span>`}
        </button>
      </div>

      <!-- Live Mood Interpreter -->
      <div class="mood-col">
        <div class="mood-panel" id="moodPanel">
          <div class="mood-glow-bg" id="moodGlowBg"></div>
          <div class="mood-header">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            <span id="moodStatus">Awaiting input…</span>
          </div>
          <div class="mood-bars" id="moodBars">
            ${[
              { label: "Energy", value: 20, cls: "bar-blue" },
              { label: "Nostalgia", value: 85, cls: "bar-purple" },
              { label: "Melancholy", value: 55, cls: "bar-indigo" },
              { label: "Movement", value: 15, cls: "bar-teal" },
              { label: "Warmth", value: 45, cls: "bar-orange" },
            ].map((b) => `
              <div class="mood-bar-row">
                <div class="mood-bar-labels">
                  <span>${b.label}</span>
                  <span class="mood-bar-level">${b.value > 70 ? "High" : b.value > 30 ? "Med" : "Low"}</span>
                </div>
                <div class="mood-bar-track">
                  <div class="mood-bar-fill ${b.cls}" data-value="${b.value}" style="width:0%"></div>
                </div>
              </div>`).join("")}
          </div>
          <div class="mood-tags">
            <div class="mood-tags-label">Scene Tags</div>
            <div class="mood-tags-row" id="moodTags">
              ${["Late night", "Urban", "Solitude", "Still"].map((t, i) => `<span class="mood-tag" style="opacity:0.25;transition:opacity 0.5s ease ${i * 0.1}s">${t}</span>`).join("")}
            </div>
          </div>
          <div class="mood-style-line">
            <div class="mood-style-label">Predicted Style</div>
            <div class="mood-style-text" id="moodStyleText" style="opacity:0">"Slow, atmospheric, late-night focused"</div>
          </div>
        </div>
      </div>
    </div>

    <!-- RESULT CARD -->
    ${state.generating ? renderGeneratingHtml() : ""}
    ${state.lastResult ? renderResultHtml(state.lastResult) : ""}

    <!-- QUICK MOMENTS -->
    <div class="quick-moments-section">
      <div class="section-eyebrow">Quick Moments</div>
      <div class="quick-chips-scroll hide-scrollbar" id="quickChips">
        ${QUICK_MOMENTS.map((m) => `<button class="quick-chip" data-vibe="${esc(m)}">${esc(m)}</button>`).join("")}
      </div>
    </div>

    <!-- LIBRARY INSIGHT STRIP -->
    <div class="taste-strip" id="tasteStrip">
      <button class="taste-toggle" id="tasteToggle">
        <div class="taste-toggle-left">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1db954" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
          <span>Your taste profile</span>
        </div>
        <svg class="taste-chevron ${state.tasteExpanded ? "rotated" : ""}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="taste-body ${state.tasteExpanded ? "expanded" : ""}" id="tasteBody">
        <div class="taste-grid">
          <div class="taste-cell">
            <span class="taste-cell-label">Dominant Vibe</span>
            <span class="taste-cell-value">${ls ? "Nostalgic / High-energy" : "Nostalgic / High-energy / Indie-heavy"}</span>
          </div>
          <div class="taste-cell">
            <span class="taste-cell-label">Listening Span</span>
            <span class="taste-cell-value">${span}</span>
          </div>
          <div class="taste-cell">
            <span class="taste-cell-label">Era Gravity</span>
            <span class="taste-cell-value">You revisit most from 2020–2022</span>
          </div>
          <div class="taste-cell">
            <span class="taste-cell-label">Sync Status</span>
            <span class="taste-cell-value">${totalTracks > 0 ? `${totalTracks.toLocaleString()} tracks${lastSynced ? ` · ${lastSynced}` : ""}` : "Not yet synced"}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- RECENT PHASES / HISTORY -->
    <div class="recent-section">
      <div class="recent-header">
        <h3 class="recent-title">Recent Phases</h3>
        <button class="recent-view-all" id="syncBtn">
          ${cs?.isSyncing ? "Syncing…" : totalTracks > 0 ? "Full sync" : "Sync library"}
        </button>
      </div>
      <div class="phases-grid">
        <div class="phase-group">
          <div class="phase-group-label phase-group-label--green">Night driving phase</div>
          <div class="phase-items" id="phaseNight">
            ${recentHistory.length > 0 ? phasesHtml : `
            <div class="phase-item"><div class="phase-item-quote">"driving through empty city streets while it rains"</div><div class="phase-item-meta">2 days ago</div></div>
            <div class="phase-item"><div class="phase-item-quote">"late night highway with nowhere to be"</div><div class="phase-item-meta">4 days ago</div></div>
            <div class="phase-item"><div class="phase-item-quote">"windows down, cool air, ambient electronic"</div><div class="phase-item-meta">1 week ago</div></div>`}
          </div>
        </div>
        <div class="phase-group">
          <div class="phase-group-label phase-group-label--purple">Recent playlists</div>
          <div class="phase-items">
            ${state.playlists.length > 0 ? state.playlists.slice(0, 3).map((p) => {
              const trackCount = Array.isArray(p.tracks) ? p.tracks.length : (p.trackCount || 0);
              return `
              <div class="phase-item phase-item--playlist">
                <div>
                  <div class="phase-item-quote">${esc(p.name)}</div>
                  <div class="phase-item-meta">${trackCount} tracks · ${formatDate(p.createdAt)}</div>
                </div>
                <div class="phase-item-actions">
                  ${p.spotifyUrl ? `<a href="${esc(p.spotifyUrl)}" target="_blank" rel="noopener" class="phase-open-btn">${spotifyIconSvg()}</a>` : ""}
                  <button class="playlist-delete-btn" data-id="${p.id}" title="Delete">✕</button>
                </div>
              </div>`;
            }).join("") : `
            <div class="phase-item"><div class="phase-item-quote">"deep work session, no lyrics, minimal techno"</div><div class="phase-item-meta">2 weeks ago</div></div>
            <div class="phase-item"><div class="phase-item-quote">"coding in a coffee shop, instrumental focus"</div><div class="phase-item-meta">3 weeks ago</div></div>`}
          </div>
          ${state.playlists.length > 5 ? `<a href="/gallery" class="taste-cell-label" style="display:block;padding:8px 0;text-decoration:underline">View all ${state.playlists.length} in Gallery →</a>` : ""}
        </div>
      </div>
    </div>

  </main>

  <footer class="app-footer">
    <a href="/gallery" class="app-footer-link">View all playlists → Gallery</a>
    <div class="app-footer-right">
      <span class="app-footer-beta">Beta</span>
      <a href="mailto:feedback@kwalify.net" class="app-footer-link">Send feedback</a>
    </div>
  </footer>
  `;

  // ── Wire events ──────────────────────────────────────────────────────────
  document.getElementById("logoutBtn")?.addEventListener("click", logout);
  document.getElementById("syncBtn")?.addEventListener("click", triggerSync);

  const vibeInput = document.getElementById("vibeInput");
  const charCount = document.getElementById("charCount");
  let interpretTimer = null;

  vibeInput.addEventListener("input", () => {
    const len = vibeInput.value.length;
    charCount.textContent = len;
    clearTimeout(interpretTimer);
    if (len > 5) {
      document.getElementById("moodGlowBg")?.classList.add("active");
      document.getElementById("moodStatus").textContent = "Reading the moment…";
      interpretTimer = setTimeout(() => {
        document.getElementById("moodStatus").textContent = "Moment analyzed";
        document.getElementById("moodGlowBg")?.classList.remove("active");
      }, 1500);
      // Animate bars
      document.querySelectorAll(".mood-bar-fill").forEach((bar) => {
        bar.style.width = bar.dataset.value + "%";
      });
      // Show tags
      document.querySelectorAll(".mood-tag").forEach((tag) => {
        tag.style.opacity = "1";
      });
      // Show style line
      const styleLine = document.getElementById("moodStyleText");
      if (styleLine) styleLine.style.opacity = "1";
    } else {
      document.getElementById("moodGlowBg")?.classList.remove("active");
      document.getElementById("moodStatus").textContent = "Awaiting input…";
      document.querySelectorAll(".mood-bar-fill").forEach((bar) => { bar.style.width = "0%"; });
      document.querySelectorAll(".mood-tag").forEach((tag) => { tag.style.opacity = "0.25"; });
      const styleLine = document.getElementById("moodStyleText");
      if (styleLine) styleLine.style.opacity = "0";
    }
  });

  vibeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); generate(); }
  });

  document.getElementById("generateBtn").addEventListener("click", generate);

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
    state.tasteExpanded = !state.tasteExpanded;
    const body = document.getElementById("tasteBody");
    const chevron = document.querySelector(".taste-chevron");
    body?.classList.toggle("expanded", state.tasteExpanded);
    chevron?.classList.toggle("rotated", state.tasteExpanded);
  });

  document.querySelectorAll(".playlist-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => deletePlaylist(Number(btn.dataset.id)));
  });

  // Ctrl+K to focus
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      vibeInput.focus();
      vibeInput.select();
    }
  });
}

function renderGeneratingHtml() {
  return `
  <div class="gen-progress-card">
    <div class="gen-spin-large"></div>
    <div>
      <div class="gen-progress-title">Building your playlist…</div>
      <div class="gen-progress-sub">Scoring your library against the moment. Takes about 10 seconds.</div>
    </div>
  </div>`;
}

function renderResultHtml(result) {
  const trackCount = result.trackCount || (Array.isArray(result.tracks) ? result.tracks.length : 0);
  const name = esc(result.playlistName || result.name || "Playlist created");
  return `
  <div class="result-card-new">
    <div class="result-card-art">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
    </div>
    <div class="result-card-body">
      <div class="result-card-badges">
        <span class="result-badge-ready">Ready</span>
        <span class="result-card-meta">${trackCount} tracks · ${state.mode} mode</span>
      </div>
      <h2 class="result-card-title">${name}</h2>
      <p class="result-card-insight">Leans into nostalgia, late-night reflection, and soft momentum.</p>
      <div class="result-card-vibes">
        <span class="result-vibe-dot result-vibe-dot--purple"></span><span>Nostalgic 70%</span>
        <span class="result-vibe-dot result-vibe-dot--indigo"></span><span>Atmospheric 60%</span>
        <span class="result-vibe-dot result-vibe-dot--blue"></span><span>Low-energy 80%</span>
      </div>
      <div class="result-card-actions">
        ${result.spotifyPlaylistUrl ? `<a href="${esc(result.spotifyPlaylistUrl)}" target="_blank" rel="noopener" class="btn btn-green">${spotifyIconSvg()} Open in Spotify</a>` : ""}
        ${result.savedPlaylistId ? `<a href="/p/${result.savedPlaylistId}" class="btn btn-ghost btn-sm">Share link</a>` : ""}
      </div>
    </div>
  </div>`;
}

// ── Actions ───────────────────────────────────────────────────────────────────
async function logout() {
  await api("/auth/logout", { method: "POST" });
  state.user = null;
  state.cacheStatus = null;
  state.librarySummary = null;
  state.playlists = [];
  state.history = [];
  state.lastResult = null;
  renderLanding();
}

async function triggerSync() {
  const btn = document.getElementById("syncBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Syncing…"; }
  await api("/spotify/sync", { method: "POST", body: JSON.stringify({ full: true }) });
  setTimeout(refreshStatus, 2000);
}

async function refreshStatus() {
  const [csRes, lsRes] = await Promise.all([
    api("/spotify/cache-status"),
    api("/library/summary"),
  ]);
  if (csRes.ok) state.cacheStatus = csRes.data;
  if (lsRes.ok) state.librarySummary = lsRes.data;
  renderApp();
  if (state.cacheStatus?.isSyncing) {
    setTimeout(refreshStatus, 3000);
  }
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

  state.generating = true;
  state.lastResult = null;
  state.error = null;
  renderApp();

  const savedVibe = vibe;

  try {
    const r = await api("/generate", {
      method: "POST",
      body: JSON.stringify({
        vibe,
        mode: state.mode,
        length: state.length,
      }),
    });

    if (r.status === 401) { window.location.href = "/api/auth/login"; return; }

    if (!r.ok) {
      state.error = r.data?.error || r.data?.message || "Generation failed.";
    } else {
      state.lastResult = {
        ...r.data,
        savedPlaylistId: r.data.playlistId,
      };
      await loadPlaylists();
    }
  } catch (e) {
    state.error = e.message || "Generation failed.";
  } finally {
    state.generating = false;
    renderApp();
    const newInput = document.getElementById("vibeInput");
    if (newInput) {
      newInput.value = savedVibe;
      document.getElementById("charCount").textContent = savedVibe.length;
    }
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  root.innerHTML = `<div class="loading-state"><div class="gen-spinner"></div><span>Loading…</span></div>`;

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

  if (state.cacheStatus?.isSyncing) {
    setTimeout(refreshStatus, 3000);
  }
}

boot();
