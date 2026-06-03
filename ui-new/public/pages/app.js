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

function navHtml(user) {
  if (user) {
    const initials = (user.displayName || "U").charAt(0).toUpperCase();
    const avatarHtml = user.avatarUrl
      ? `<img src="${esc(user.avatarUrl)}" alt="">`
      : initials;
    return `
    <nav class="nav">
      <div class="nav-logo">
        <div class="nav-logo-badge">Y</div>
        <span>Kwalify</span>
      </div>
      <div class="nav-right">
        <div class="nav-user">
          <div class="nav-avatar">${avatarHtml}</div>
          <span>${esc(user.displayName || "")}</span>
        </div>
        <a href="/gallery" class="btn btn-ghost btn-sm">Gallery →</a>
        <button id="logoutBtn" class="btn btn-outline btn-sm">Log out</button>
      </div>
    </nav>`;
  }
  return `
  <nav class="nav">
    <div class="nav-logo">
      <div class="nav-logo-badge">Y</div>
      <span>Kwalify</span>
    </div>
    <div class="nav-right">
      <a href="/api/auth/login" class="btn btn-green btn-sm">${spotifyIconSvg()} Connect</a>
    </div>
  </nav>`;
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
};

// ── Landing page (not logged in) ──────────────────────────────────────────────
function renderLanding() {
  root.innerHTML = `
  ${navHtml(null)}
  <section class="landing-hero">
    <div class="badge-pill">
      <span class="badge-pill-dot"></span>
      Playlists from your liked songs
    </div>
    <h1>Vibe DJ</h1>
    <p>Type how you feel. A playlist from songs you already loved — not Discover Weekly.</p>
    <div class="landing-not-discover">
      <strong>Not Discover Weekly:</strong> Every track is already in your Spotify likes — we do not recommend new music you have not saved.
    </div>
    <div class="landing-prompts">
      <div class="landing-prompt">"Late-night drive home after seeing old friends"</div>
      <div class="landing-prompt">"Sunny evening working on an old car in the garage"</div>
      <div class="landing-prompt">"Nostalgic but not sad"</div>
    </div>
    <div class="landing-cta">
      <a href="/api/auth/login" class="btn btn-green btn-lg">${spotifyIconSvg()} Connect with Spotify — free</a>
    </div>
    <div class="landing-trust">No credit card · No data stored · Private playlists only</div>
  </section>

  <section class="section">
    <div class="section-label">How Kwalify works</div>
    <div class="features-grid">
      <div class="feature-card">
        <span class="feature-icon">🧠</span>
        <h3>Moment-aware matching</h3>
        <p>Parses your scene into location, time, mood, and motion — then matches tracks from your library.</p>
      </div>
      <div class="feature-card">
        <span class="feature-icon">🎵</span>
        <h3>Matches your library</h3>
        <p>Every liked song is matched on mood, energy, and listening history. Only songs you already love make the cut.</p>
      </div>
      <div class="feature-card">
        <span class="feature-icon">🎲</span>
        <h3>Strict, Balanced, Chaotic</h3>
        <p>Choose how closely tracks match your vibe. Balanced ensures artist variety and tempo diversity.</p>
      </div>
      <div class="feature-card">
        <span class="feature-icon">⚡</span>
        <h3>One click, done</h3>
        <p>Describe your mood, hit Generate. A private playlist appears in your Spotify in seconds.</p>
      </div>
    </div>
  </section>

  <section class="how-section">
    <h2>How it works</h2>
    <div class="steps-row">
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-title">Connect Spotify</div>
        <div class="step-desc">One-click OAuth — read-only access to your liked songs</div>
      </div>
      <div class="step-arrow">→</div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-title">Describe your vibe</div>
        <div class="step-desc">Type anything: "night drive alone" or hit a preset</div>
      </div>
      <div class="step-arrow">→</div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-title">AI scores tracks</div>
        <div class="step-desc">Energy, valence, tempo, acousticness — all matched locally</div>
      </div>
    </div>
    <div class="steps-row steps-row-bottom">
      <div class="step">
        <div class="step-num">4</div>
        <div class="step-title">Playlist created</div>
        <div class="step-desc">Opens in Spotify automatically — no manual steps</div>
      </div>
    </div>
  </section>

  <div class="stats-bar">
    <div class="stats-bar-inner">
      <div class="stat-item"><div class="stat-num">5</div><div class="stat-label">Audio dimensions scored</div></div>
      <div class="stat-item"><div class="stat-num">3</div><div class="stat-label">AI pipeline layers</div></div>
      <div class="stat-item"><div class="stat-num">10–100</div><div class="stat-label">Tracks per playlist</div></div>
      <div class="stat-item"><div class="stat-num">0</div><div class="stat-label">Data stored on server</div></div>
    </div>
  </div>

  <section class="cta-section">
    <h2>Ready to hear it?</h2>
    <p>Connect your Spotify and describe your first vibe. Takes 10 seconds.</p>
    <a href="/api/auth/login" class="btn btn-green btn-lg">${spotifyIconSvg()} Get started free</a>
  </section>
  `;
}

// ── App page (logged in) ──────────────────────────────────────────────────────
const PRESETS = [
  { label: "🌙 Night Drive", value: "late-night motorway drive" },
  { label: "💪 Gym", value: "high energy gym workout" },
  { label: "☁️ Chill", value: "relaxed chill afternoon" },
  { label: "🧠 Focus", value: "deep focus work session" },
  { label: "🌞 Summer", value: "sunny summer vibes" },
];

const EXAMPLE_VIBES = [
  "late-night motorway drive",
  "sunny afternoon working on an old car",
  "songs that sound expensive",
  "end of summer but not sad",
  "music for wandering around London at midnight",
];

function renderApp() {
  const cs = state.cacheStatus;
  const ls = state.librarySummary;
  const isSyncing = cs?.isSyncing;
  const totalTracks = cs?.totalTracks || 0;
  const lastSynced = cs?.lastSyncedAt
    ? new Date(cs.lastSyncedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : null;

  // Library status bar
  let libraryStatusHtml = "";
  if (!cs || totalTracks === 0) {
    libraryStatusHtml = `
    <div class="library-status library-status-syncing" id="libraryStatus">
      <div class="library-status-left">
        <span class="library-status-check">⏳</span>
        <span class="library-status-text">Library syncing…</span>
      </div>
      <button class="btn btn-outline btn-sm" id="syncBtn">Sync</button>
    </div>`;
  } else if (isSyncing) {
    const pct = cs.syncTotal ? Math.round((cs.syncProgress / cs.syncTotal) * 100) : 0;
    libraryStatusHtml = `
    <div class="library-status library-status-syncing" id="libraryStatus">
      <div class="library-status-left">
        <span class="library-status-check">🔄</span>
        <span class="library-status-text">Syncing… ${cs.syncProgress || 0} / ${cs.syncTotal || "?"} tracks</span>
      </div>
    </div>
    <div class="sync-progress-bar-wrap"><div class="sync-progress-bar-fill" style="width:${pct}%"></div></div>`;
  } else {
    libraryStatusHtml = `
    <div class="library-status" id="libraryStatus">
      <div class="library-status-left">
        <span class="library-status-check">✓</span>
        <span class="library-status-text">Library ready — ${totalTracks.toLocaleString()} tracks${lastSynced ? ` · Last synced ${lastSynced}` : ""}</span>
      </div>
      <button class="btn btn-outline btn-sm" id="syncBtn">Full sync</button>
    </div>`;
  }

  // Stats card
  let statsCardHtml = "";
  if (ls && ls.trackCount > 0) {
    const span = ls.oldestLikedYear && ls.newestLikedYear
      ? `${ls.oldestLikedYear}–${ls.newestLikedYear}`
      : "—";
    statsCardHtml = `
    <div class="stats-card">
      <div class="stats-card-headline">${ls.trackCount.toLocaleString()} songs synced</div>
      <div class="stats-card-sub">That's a huge library. Kwalify can dig through years of favourites, forgotten gems, and deep cuts — only from tracks you already saved on Spotify.</div>
      <div class="stats-card-label">Your Library</div>
      <div class="stats-card-grid">
        <div>
          <div class="stats-card-item-num">${(ls.artistCount || 0).toLocaleString()}</div>
          <div class="stats-card-item-name">artists</div>
          ${ls.topDecade ? `<div class="stats-card-item-desc">Most active decade: ${ls.topDecade}</div>` : ""}
          <div class="stats-card-item-desc">when you saved most likes</div>
        </div>
        <div>
          <div class="stats-card-item-num">${ls.genreFamilyCount || 0} / 18</div>
          <div class="stats-card-item-name">main genres spotted</div>
          ${span !== "—" ? `<div class="stats-card-item-desc">Likes from ${span}</div>` : ""}
          <div class="stats-card-item-desc">listening span</div>
        </div>
      </div>
      <div class="stats-card-note">Broad categories from your library (pop, rock, soul, etc.) — not Spotify's thousands of micro-genres.</div>
    </div>`;
  }

  // Recent moods from history
  const moodItems = state.history
    .slice(0, 6)
    .map((h) => `<div class="mood-item" data-vibe="${esc(h.vibe)}">"${esc(h.vibe)}"</div>`)
    .join("");

  // Recent playlists
  const playlistItems = state.playlists
    .slice(0, 5)
    .map((p) => {
      const trackCount = Array.isArray(p.tracks) ? p.tracks.length : 0;
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
    })
    .join("");

  const errorHtml = state.error
    ? `<div class="alert alert-error">${esc(state.error)}</div>`
    : "";

  root.innerHTML = `
  ${navHtml(state.user)}
  <div class="app-wrap">
    <div class="app-hero">
      <div class="app-hero-badge"><span class="app-hero-badge-dot"></span>VIBE DJ · FROM YOUR LIKED SONGS</div>
      <h1>What's the vibe?</h1>
      <p>Describe a moment — Kwalify builds a playlist from songs you already saved on Spotify.</p>
    </div>

    ${libraryStatusHtml}
    ${statsCardHtml}

    ${errorHtml}

    <div class="vibe-card" id="vibeCard">
      <div class="vibe-form-label">Describe your vibe</div>
      <div class="vibe-input-row">
        <input
          id="vibeInput"
          class="vibe-input"
          type="text"
          placeholder="Describe a moment — not a genre..."
          maxlength="140"
          autocomplete="off"
        >
        <button id="generateBtn" class="btn btn-purple"
          style="padding:12px 20px; border-radius:10px; flex-shrink:0;">
          ▷ Generate
        </button>
      </div>
      <div class="vibe-input-meta"><span id="charCount">0</span>/140</div>
      <div class="vibe-hint">Only uses songs already in your Spotify liked songs.</div>

      <div class="vibe-form-label" style="margin-top:4px;">Sound like this playlist <span style="font-weight:400;color:rgba(255,255,255,0.3)">(optional tool)</span></div>
      <input id="refPlaylistInput" class="ref-playlist-input" type="url" placeholder="Paste a public Spotify playlist link to bias the vibe…">
      <div class="vibe-hint" style="margin-top:-8px;margin-bottom:12px;">Biases matching only — generates a new playlist on your Spotify, not this one.</div>

      <div class="chips-label">Try one of these</div>
      <div class="chips-row" id="exampleChips">
        ${EXAMPLE_VIBES.map((v) => `<div class="chip" data-vibe="${esc(v)}">${esc(v)}</div>`).join("")}
      </div>

      <div class="chips-label">Quick</div>
      <div class="chips-row" id="presetChips">
        ${PRESETS.map((p) => `<div class="chip" data-vibe="${esc(p.value)}">${esc(p.label)}</div>`).join("")}
      </div>

      <div class="settings-row">
        <div class="setting-group">
          <div class="setting-label">Match mode</div>
          <div class="mode-buttons">
            <button class="mode-btn ${state.mode === "strict" ? "active" : ""}" data-mode="strict">Strict</button>
            <button class="mode-btn ${state.mode === "balanced" ? "active" : ""}" data-mode="balanced">Balanced</button>
            <button class="mode-btn ${state.mode === "chaotic" ? "active" : ""}" data-mode="chaotic">Chaotic</button>
          </div>
        </div>
        <div class="setting-group">
          <div class="setting-label">Playlist length — <span class="length-value" id="lengthLabel">${state.length} TRACKS</span></div>
          <input type="range" class="length-slider" id="lengthSlider" min="10" max="100" step="5" value="${state.length}">
        </div>
      </div>
      <div class="keyboard-hints">
        <span><kbd>Enter</kbd> generate</span>
        <span><kbd>Ctrl K</kbd> focus</span>
      </div>
    </div>

    ${state.generating ? renderGeneratingHtml() : ""}
    ${state.lastResult ? renderResultHtml(state.lastResult) : ""}

    ${state.history.length > 0 ? `
    <div class="section-hdr-row" style="margin-top:8px;">
      <div class="section-hdr">Your recent moods</div>
    </div>
    <div class="moods-list">${moodItems}</div>
    ` : ""}

    <div class="section-hdr-row">
      <div class="section-hdr">Recent Playlists</div>
      <a href="/gallery" class="section-hdr-link">Quick reopen here · <strong>Gallery</strong> has every playlist</a>
    </div>
    ${playlistItems ? `<div class="playlists-list">${playlistItems}</div>` : `<div style="font-size:13px;color:rgba(255,255,255,0.3);padding:12px 0;">No playlists yet — generate your first vibe above.</div>`}
    ${state.playlists.length > 5 ? `<div class="gallery-link"><a href="/gallery">View all ${state.playlists.length} in Gallery →</a></div>` : ""}

    <div class="beta-bar">Beta — <a href="mailto:feedback@kwalify.net">Send feedback</a></div>
  </div>
  `;

  // Wire events
  document.getElementById("logoutBtn")?.addEventListener("click", logout);
  document.getElementById("syncBtn")?.addEventListener("click", triggerSync);

  const vibeInput = document.getElementById("vibeInput");
  const charCount = document.getElementById("charCount");
  vibeInput.addEventListener("input", () => {
    charCount.textContent = vibeInput.value.length;
  });
  vibeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); generate(); }
  });

  document.getElementById("generateBtn").addEventListener("click", generate);

  document.getElementById("lengthSlider")?.addEventListener("input", (e) => {
    state.length = Number(e.target.value);
    document.getElementById("lengthLabel").textContent = `${state.length} TRACKS`;
  });

  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.mode = btn.dataset.mode;
      document.querySelectorAll(".mode-btn").forEach((b) => b.classList.toggle("active", b.dataset.mode === state.mode));
    });
  });

  document.querySelectorAll(".chip[data-vibe]").forEach((chip) => {
    chip.addEventListener("click", () => {
      vibeInput.value = chip.dataset.vibe;
      charCount.textContent = vibeInput.value.length;
      vibeInput.focus();
    });
  });

  document.querySelectorAll(".mood-item[data-vibe]").forEach((item) => {
    item.addEventListener("click", () => {
      vibeInput.value = item.dataset.vibe;
      charCount.textContent = vibeInput.value.length;
      vibeInput.focus();
      document.getElementById("vibeCard")?.scrollIntoView({ behavior: "smooth" });
    });
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
  <div class="gen-progress">
    <div class="gen-spinner"></div>
    <div class="gen-progress-title">Generating your playlist…</div>
    <div class="gen-progress-sub">Scoring your library against the vibe. Takes about 10 seconds.</div>
  </div>`;
}

function renderResultHtml(result) {
  const trackCount = result.trackCount || (Array.isArray(result.tracks) ? result.tracks.length : 0);
  return `
  <div class="result-card">
    <div class="result-card-title">✓ ${esc(result.playlistName || result.name || "Playlist created")}</div>
    <div class="result-card-meta">${trackCount} tracks generated</div>
    <div class="result-actions">
      ${result.spotifyPlaylistUrl ? `<a href="${esc(result.spotifyPlaylistUrl)}" target="_blank" rel="noopener" class="btn btn-green">${spotifyIconSvg()} Open in Spotify</a>` : ""}
      ${result.savedPlaylistId ? `<a href="/p/${result.savedPlaylistId}" class="btn btn-ghost btn-sm">Share link</a>` : ""}
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

  const refInput = document.getElementById("refPlaylistInput");
  const referencePlaylist = refInput?.value.trim() || undefined;

  state.generating = true;
  state.lastResult = null;
  state.error = null;
  renderApp();

  try {
    const r = await api("/generate", {
      method: "POST",
      body: JSON.stringify({
        vibe,
        mode: state.mode,
        length: state.length,
        ...(referencePlaylist ? { referencePlaylist } : {}),
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
      // Refresh playlists list
      await loadPlaylists();
    }
  } catch (e) {
    state.error = e.message || "Generation failed.";
  } finally {
    state.generating = false;
    renderApp();
    // Restore vibe value
    const newInput = document.getElementById("vibeInput");
    if (newInput) newInput.value = vibe;
    const charCount = document.getElementById("charCount");
    if (charCount) charCount.textContent = vibe.length;
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

  // Load all data in parallel
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

  // Poll if syncing
  if (state.cacheStatus?.isSyncing) {
    setTimeout(refreshStatus, 3000);
  }
}

boot();
