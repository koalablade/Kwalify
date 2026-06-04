// ── Kwalify · Single app entry point ─────────────────────────────────────────
const root = document.getElementById("appRoot");

// ── Theme bootstrap (runs before any render) ──────────────────────────────────
(function initTheme() {
  const saved = localStorage.getItem("kwalify-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = saved || (prefersDark ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
})();

// ── Helpers ───────────────────────────────────────────────────────────────────
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

// ── Reactive mood analyzer ────────────────────────────────────────────────────
function analyzeMoodFromText(text) {
  const t = text.toLowerCase();

  const energyPos = ['pump', 'intense', 'fast', 'driving fast', 'gym', 'party', 'hype', 'loud', 'metal', 'rave', 'dance', 'sprint', 'adrenaline', 'electric', 'fire', 'rage', 'rush', 'beat', 'bass', 'festival', 'crowd', 'power', 'speed', 'running', 'workout', 'club'];
  const energyNeg = ['sleep', 'calm', 'quiet', 'still', 'slow', 'haze', 'foggy', 'drift', 'twilight', 'soft', 'gentle', 'lull', 'rest', 'meditat', 'float', 'silence', 'serene', 'peaceful', 'lazy', 'ambient', 'hazy', 'muted'];

  const nostalgiaPos = ['old', 'classic', 'remember', 'childhood', 'past', 'back in', 'used to', 'miss', 'memories', 'nostalg', '80s', '90s', '2000s', '00s', 'retro', 'vintage', 'throwback', 'long ago', 'grew up', 'school days', 'young', 'simpler times', 'those days', 'back then', 'years ago'];

  const melancholyPos = ['sad', 'alone', 'lonely', 'miss', 'cry', 'empty', 'hollow', 'lost', 'grief', 'heartbreak', 'goodbye', 'ending', 'melanchol', 'grey', 'rain', 'somber', 'heavy', 'broken', 'hurt', 'pain', 'fog', 'dusk', 'ache', 'longing', 'distant', 'bittersweet', 'wistful', 'numb', 'dark'];

  const movementPos = ['drive', 'driving', 'walk', 'walking', 'road', 'highway', 'journey', 'wander', 'cruise', 'commute', 'train ride', 'bus', 'flight', 'moving', 'roam', 'miles', 'leaving', 'departure', 'going', 'pedal', 'cycling', 'run'];
  const movementNeg = ['still', 'sitting', 'stay', 'bedroom', 'room', 'bed', 'couch', 'window', 'waiting', 'seated', 'parked', 'static', 'stuck'];

  const warmthPos = ['warm', 'sunshine', 'summer', 'golden', 'cozy', 'comfort', 'love', 'together', 'friends', 'happy', 'joy', 'bright', 'glow', 'fireplace', 'home', 'family', 'afternoon', 'spring', 'laughter', 'beach', 'sunset', 'golden hour', 'sunlit'];
  const warmthNeg = ['cold', 'winter', 'ice', 'freeze', 'dark', 'shadow', 'grey', 'alone', 'empty', 'frost', 'bleak', 'harsh', 'midnight', 'desolate'];

  function scoreKeywords(pos, neg = []) {
    const posHits = pos.filter(w => t.includes(w)).length;
    const negHits = neg.filter(w => t.includes(w)).length;
    const base = 0.38 + (posHits * 0.14) - (negHits * 0.11);
    return Math.round(Math.max(5, Math.min(95, base * 100)));
  }

  const energy = scoreKeywords(energyPos, energyNeg);
  const nostalgia = scoreKeywords(nostalgiaPos);
  const melancholy = scoreKeywords(melancholyPos);
  const movement = scoreKeywords(movementPos, movementNeg);
  const warmth = scoreKeywords(warmthPos, warmthNeg);

  const tagMap = {
    "Late night": ["night", "midnight", "2am", "3am", "4am", "late", "after midnight", "insomnia", "1am", "dark hour"],
    "Urban": ["city", "street", "urban", "downtown", "metro", "subway", "building", "neon", "alley", "concrete", "skyscraper"],
    "Solitude": ["alone", "solo", "solitude", "lone", "myself", "quiet", "just me", "no one around", "by myself"],
    "Moving": ["drive", "driving", "walk", "highway", "road", "journey", "commute", "wander", "on the move"],
    "Nostalgic": ["remember", "memory", "past", "old", "miss", "used to", "childhood", "back when", "nostalg"],
    "Melancholic": ["sad", "melanchol", "cry", "heartbreak", "grief", "empty", "hollow", "broken", "numb"],
    "Euphoric": ["happy", "joy", "bliss", "ecstasy", "thrilled", "wonderful", "amazing", "elation"],
    "Rainy": ["rain", "storm", "grey", "cloudy", "wet", "drizzle", "downpour"],
    "Warm": ["warm", "golden", "sun", "summer", "bright", "sunshine", "cozy", "golden hour"],
    "Still": ["still", "quiet", "silent", "calm", "serene", "peaceful", "haze", "drift"],
  };

  const tags = Object.entries(tagMap)
    .filter(([, words]) => words.some(w => t.includes(w)))
    .map(([tag]) => tag)
    .slice(0, 5);

  let style = "Balanced, atmospheric";
  if (energy > 65 && movement > 55) style = "Fast-paced, driving, high momentum";
  else if (energy < 35 && melancholy > 50) style = "Slow, introspective, emotionally deep";
  else if (nostalgia > 55 && warmth > 50) style = "Warm, nostalgic, memory-soaked";
  else if (energy > 65) style = "High-energy, intense, forward-moving";
  else if (warmth > 62 && energy > 45) style = "Bright, feel-good, uplifting";
  else if (melancholy > 58) style = "Melancholic, cinematic, emotionally heavy";
  else if (energy < 30) style = "Soft, ambient, drifting";
  else if (movement > 60) style = "Road trip, rhythmic, open road";
  else if (nostalgia > 55) style = "Nostalgic, reminiscent, bittersweet";
  else style = "Layered, multi-dimensional, mood-focused";

  return {
    energy,
    nostalgia,
    melancholy,
    movement,
    warmth,
    tags: tags.length > 0 ? tags : ["Ambient"],
    style: `"${style}"`,
  };
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
  noLibraryMode: false,
  generating: false,
  lastResult: null,
  error: null,
  tasteOpen: false,
  profileOpen: false,
  showDebug: false,
};

function getTheme() {
  return document.documentElement.getAttribute("data-theme") || "dark";
}

function toggleTheme() {
  const next = getTheme() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("kwalify-theme", next);
  const icon = document.getElementById("themeIcon");
  if (icon) icon.textContent = next === "dark" ? "☀️" : "🌙";
}

// ── Nav ───────────────────────────────────────────────────────────────────────
function navHtml(user) {
  const cs = state.cacheStatus;
  const syncing = cs?.isSyncing;
  const total = cs?.totalTracks || 0;
  const syncLabel = syncing ? "Syncing…" : total > 0 ? `${total.toLocaleString()} synced` : "Sync";
  const initials = (user?.displayName || "U").charAt(0).toUpperCase();
  const avatar = user?.avatarUrl
    ? `<img src="${esc(user.avatarUrl)}" alt="">`
    : initials;
  const isDark = getTheme() === "dark";

  return `
  <nav class="nav">
    <div class="nav-logo">
      <div class="nav-logo-mark">K</div>
      <span>Kwalify</span>
    </div>
    <div class="nav-right">
      <a href="/gallery" class="nav-link">Gallery <span class="nav-link-arrow">→</span></a>
      <div class="nav-sync-chip" id="syncChip" style="cursor:pointer" title="Delta sync (new likes only)">
        <span class="sync-dot ${syncing ? "sync-dot--live" : ""}"></span>
        <span>${syncLabel}</span>
      </div>
      <div class="nav-profile-wrap" id="profileWrap">
        <button class="nav-avatar-btn" id="profileBtn" title="Account">
          <div class="nav-avatar">${avatar}</div>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:var(--muted-2)"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="profile-dropdown ${state.profileOpen ? "open" : ""}" id="profileDropdown">
          <div class="profile-dropdown-header">
            <span class="profile-dropdown-name">${esc(user?.displayName || "")}</span>
          </div>
          <button class="profile-dropdown-item" id="themeToggleBtn">
            <span id="themeIcon">${isDark ? "☀️" : "🌙"}</span>
            <span>${isDark ? "Light mode" : "Dark mode"}</span>
          </button>
          <a href="/gallery" class="profile-dropdown-item">
            <span>🎵</span>
            <span>My playlists</span>
          </a>
          <div class="profile-dropdown-divider"></div>
          <button class="profile-dropdown-item profile-dropdown-logout" id="logoutBtn">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            <span>Log out</span>
          </button>
        </div>
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

const MOOD_BAR_DEFS = [
  { label: "Energy",    cls: "fill-blue",   id: "mb-energy",    key: "energy" },
  { label: "Nostalgia", cls: "fill-purple",  id: "mb-nostalgia", key: "nostalgia" },
  { label: "Melancholy",cls: "fill-indigo",  id: "mb-melancholy",key: "melancholy" },
  { label: "Movement",  cls: "fill-teal",    id: "mb-movement",  key: "movement" },
  { label: "Warmth",    cls: "fill-amber",   id: "mb-warmth",    key: "warmth" },
];

function moodLevelLabel(v) {
  return v > 70 ? "High" : v > 30 ? "Med" : "Low";
}

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

  // Unified activity feed
  const feedItems = buildActivityFeed();

  const moodBarsHtml = MOOD_BAR_DEFS.map((b) => `
    <div class="mood-bar-row">
      <div class="mood-bar-labels">
        <span>${b.label}</span>
        <span class="mood-bar-level" id="${b.id}-label">—</span>
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

        <div class="no-library-row">
          <label class="no-library-toggle" title="Generate using only vibe keywords — skips your personal library">
            <div class="toggle-switch ${state.noLibraryMode ? "on" : ""}" id="noLibraryToggle"></div>
            <div class="no-library-text">
              <span class="no-library-label">No Library Mode</span>
              <span class="no-library-sub">AI-only · ignores your liked songs</span>
            </div>
          </label>
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
          <!-- Server-detected scene panel (appears after server responds) -->
          <div class="mood-scene-panel" id="moodScenePanel" style="display:none">
            <div class="mood-scene-divider"></div>
            <div class="mood-scene-row">
              <div class="mood-scene-label">Detected Scene</div>
              <div class="mood-scene-name" id="moodSceneName"></div>
              <div class="mood-scene-badges" id="moodSceneBadges"></div>
            </div>
            <div class="mood-alts-row" id="moodAltsRow" style="display:none">
              <div class="mood-alts-label">Also matches</div>
              <div class="mood-alts" id="moodAlts"></div>
            </div>
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

    <!-- Unified Activity Feed -->
    <div class="recent-section">
      <div class="section-head">
        <h3 class="section-title">Activity</h3>
        <div style="display:flex;gap:8px;align-items:center">
          <button id="deltaSyncBtn" class="section-action" ${cs?.isSyncing ? "disabled" : ""} title="Fetch only new liked songs since last sync">
            ${cs?.isSyncing ? "Syncing…" : "↻ Sync new"}
          </button>
          <button id="fullSyncBtn" class="section-action" ${cs?.isSyncing ? "disabled" : ""} title="Re-sync your entire library from scratch">
            Full sync
          </button>
          <a href="/gallery" class="section-action">All playlists →</a>
        </div>
      </div>
      <div class="activity-feed">
        ${feedItems}
      </div>
    </div>

  </div>

  <footer class="app-footer">
    <a href="/gallery" class="footer-link">Gallery →</a>
    <div class="footer-right">
      <span class="badge badge-muted">Beta</span>
      <a href="mailto:feedback@kwalify.net" class="footer-link">Send feedback</a>
    </div>
  </footer>

  <!-- Feedback floating button -->
  <a
    href="https://docs.google.com/forms/d/1dRFIgqcbNGXXHYHZqaRQ3BhFHqsFmENdmLRCs_YtWhE/edit"
    target="_blank"
    rel="noopener"
    class="feedback-fab"
    title="Send feedback"
  >💬</a>`;

  wireAppEvents();
}

function buildActivityFeed() {
  // Merge recent history + recent playlists into a single chronological feed
  const items = [];

  // History items (moments)
  const histItems = state.history.slice(0, 5).map(h => ({
    type: "moment",
    label: h.vibe,
    date: h.createdAt || h.timestamp || "",
    extra: null,
  }));

  // Playlist items
  const plItems = state.playlists.slice(0, 6).map(p => ({
    type: "playlist",
    label: p.name,
    date: p.createdAt || "",
    count: Array.isArray(p.tracks) ? p.tracks.length : (p.trackCount || 0),
    spotifyUrl: p.spotifyUrl,
    id: p.id,
  }));

  // Interleave both, sorted by date descending
  const all = [...histItems, ...plItems]
    .filter(i => i.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (all.length === 0) {
    // Default placeholders
    return `
    <div class="activity-item">
      <span class="activity-dot activity-dot--green"></span>
      <div class="activity-body">
        <div class="activity-label" style="font-style:italic">"driving through empty city streets"</div>
        <div class="activity-meta">Example · 2 days ago</div>
      </div>
    </div>
    <div class="activity-item">
      <span class="activity-dot activity-dot--purple"></span>
      <div class="activity-body">
        <div class="activity-label">Late Night Highway</div>
        <div class="activity-meta">Example playlist · 4 days ago</div>
      </div>
    </div>`;
  }

  return all.slice(0, 10).map(item => {
    if (item.type === "moment") {
      return `
      <div class="activity-item">
        <span class="activity-dot activity-dot--green"></span>
        <div class="activity-body">
          <div class="activity-label" style="font-style:italic">"${esc(item.label)}"</div>
          <div class="activity-meta">Moment · ${fmtDate(item.date)}</div>
        </div>
      </div>`;
    } else {
      return `
      <div class="activity-item">
        <span class="activity-dot activity-dot--purple"></span>
        <div class="activity-body">
          <div class="activity-label">${esc(item.label)}</div>
          <div class="activity-meta">${item.count} tracks · ${fmtDate(item.date)}</div>
        </div>
        <div class="activity-actions">
          ${item.spotifyUrl ? `<a href="${esc(item.spotifyUrl)}" target="_blank" rel="noopener" class="phase-open">${spi()}</a>` : ""}
          <button class="delete-btn" data-id="${item.id}" title="Delete">✕</button>
        </div>
      </div>`;
    }
  }).join("");
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
  const debug = new URLSearchParams(window.location.search).has("debug");

  // ── Dynamic vibe tags from scoring response ────────────────────────────────
  const DOT_COLORS = ["vd-purple", "vd-indigo", "vd-blue", "vd-green", "vd-orange"];
  const vibeTags = (() => {
    const tags = [];
    const diag = result.scoringDiagnostics;
    const sem = diag?.semanticResolution;
    if (sem?.sceneId) tags.push(sem.sceneId.replace(/_/g, " "));
    const dominant = diag?.dominantGenres || result.libraryIntelligence?.dominantGenres || [];
    dominant.slice(0, 2).forEach(g => tags.push(g));
    const traits = result.sonicTraits || [];
    traits.slice(0, 2).forEach(t => tags.push(t));
    if (!tags.length) tags.push("Curated", "Personal", "Atmospheric");
    return tags.slice(0, 4);
  })();
  const vibeDotsHtml = vibeTags.map((t, i) =>
    `<span class="vibe-dot ${DOT_COLORS[i % DOT_COLORS.length]}"></span><span>${esc(t)}</span>`
  ).join("\n");

  // ── Admin Debug Panel ──────────────────────────────────────────────────────
  const debugHtml = buildDebugPanel(result);

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
        ${vibeDotsHtml}
      </div>
      <div class="result-actions">
        ${result.spotifyPlaylistUrl ? `<a href="${esc(result.spotifyPlaylistUrl)}" target="_blank" rel="noopener" class="btn btn-green">${spi()} Open in Spotify</a>` : ""}
        ${result.savedPlaylistId ? `<a href="/p/${result.savedPlaylistId}" class="btn btn-ghost btn-sm">Share link</a>` : ""}
      </div>
    </div>
  </div>
  ${debugHtml}`;
}

// ── Admin Debug Panel ─────────────────────────────────────────────────────────
function buildDebugPanel(result) {
  const dbg = result._debug;
  if (!dbg) return "";

  const diag = dbg.scoringDiagnostics || {};
  const sem = dbg.semanticScene || diag.semanticResolution || null;
  const pool = dbg.poolInfo || {};
  const topScored = (diag.topScored || []).slice(0, 20);
  const domGenres = diag.dominantGenres || [];
  const exclusionReasons = diag.exclusionReasons || {};
  const ecoDebug = dbg.ecosystemDebug || {};
  const genreAudit = dbg.genreAudit || {};
  const open = state.showDebug;

  // ── Scene card ────────────────────────────────────────────────────────────
  const confPct = sem ? Math.round((sem.confidence || 0) * 100) : 0;
  const confColor = confPct >= 80 ? "#1db954" : confPct >= 55 ? "#f59e0b" : "#ef4444";
  const lockActive = confPct >= 55;

  const sceneHtml = `
    <div class="dp-card">
      <div class="dp-card-title">🎯 Detected Scene</div>
      ${sem ? `
        <div class="dp-scene-name">${esc(sem.sceneId || "—").replace(/_/g," ")}</div>
        <div class="dp-scene-meta">
          <span class="dp-badge" style="background:${confColor}20;color:${confColor};border-color:${confColor}40">
            ${confPct}% confidence
          </span>
          <span class="dp-badge ${lockActive ? "dp-badge--green" : "dp-badge--muted"}">
            Ecosystem lock ${lockActive ? "active ✓" : "inactive"}
          </span>
          ${dbg.noLibraryMode ? '<span class="dp-badge dp-badge--purple">No Library Mode</span>' : ""}
        </div>
      ` : `<div class="dp-none">No scene matched — using generic mood scoring</div>`}
    </div>`;

  // ── Scoring weights card ──────────────────────────────────────────────────
  const weights = dbg.noLibraryMode
    ? { Semantic: 55, Emotion: 20, Scene: 15, Aesthetic: 10, Library: 0, Genre: 0 }
    : { Semantic: 40, Emotion: 20, Scene: 15, Aesthetic: 10, Library: 10, Genre: 5 };

  const weightBars = Object.entries(weights).map(([k, v]) => `
    <div class="dp-weight-row">
      <span class="dp-weight-label">${k}</span>
      <div class="dp-weight-bar-wrap">
        <div class="dp-weight-bar" style="width:${v * 1.8}%;background:${v >= 40 ? "#7c3aed" : v >= 20 ? "#1d4ed8" : v >= 10 ? "#0e7490" : "#374151"}"></div>
      </div>
      <span class="dp-weight-pct">${v}%</span>
    </div>`).join("");

  const weightsHtml = `
    <div class="dp-card">
      <div class="dp-card-title">⚖️ Scoring Weights</div>
      <div class="dp-weights">${weightBars}</div>
    </div>`;

  // ── Pool breakdown card ───────────────────────────────────────────────────
  const libSize = pool.librarySize || 0;
  const hybridSize = pool.hybridPoolSize || 0;
  const filteredOut = libSize - hybridSize;
  const filteredPct = libSize > 0 ? Math.round((filteredOut / libSize) * 100) : 0;
  const topExclusions = Object.entries(exclusionReasons)
    .sort((a, b) => b[1] - a[1]).slice(0, 5);

  const poolHtml = `
    <div class="dp-card">
      <div class="dp-card-title">🗂️ Candidate Pool</div>
      <div class="dp-pool-grid">
        <div class="dp-pool-stat">
          <div class="dp-pool-num">${libSize.toLocaleString()}</div>
          <div class="dp-pool-lbl">Library tracks</div>
        </div>
        <div class="dp-pool-arrow">→</div>
        <div class="dp-pool-stat">
          <div class="dp-pool-num" style="color:#1db954">${hybridSize.toLocaleString()}</div>
          <div class="dp-pool-lbl">After pre-filter</div>
        </div>
        <div class="dp-pool-arrow">→</div>
        <div class="dp-pool-stat">
          <div class="dp-pool-num" style="color:#f59e0b">${filteredOut.toLocaleString()}</div>
          <div class="dp-pool-lbl">Removed (${filteredPct}%)</div>
        </div>
      </div>
      ${pool.poolCapped ? '<div class="dp-note">⚡ Pool was capped — anti-genre tracks pre-filtered before scoring</div>' : ""}
      ${topExclusions.length ? `
        <div class="dp-sub-title">Exclusion reasons</div>
        <div class="dp-exclusions">
          ${topExclusions.map(([reason, count]) =>
            `<div class="dp-excl-row"><span>${esc(reason)}</span><span class="dp-excl-count">${count}</span></div>`
          ).join("")}
        </div>
      ` : ""}
    </div>`;

  // ── Dominant genres card ──────────────────────────────────────────────────
  const genreColors = {
    country:"#d97706",folk:"#16a34a",indie:"#7c3aed",rock:"#dc2626",
    electronic:"#0891b2",pop:"#db2777",jazz:"#9333ea",soul:"#ea580c",
    rnb:"#0284c7",hip_hop:"#16a34a",blues:"#2563eb",metal:"#6b7280",
    classical:"#b45309",reggae:"#15803d",latin:"#c2410c",
  };

  const genreBubbles = domGenres.slice(0, 8).map(g =>
    `<span class="dp-genre-chip" style="background:${(genreColors[g]||"#4b5563")}20;color:${genreColors[g]||"#9ca3af"};border-color:${(genreColors[g]||"#4b5563")}40">${esc(g)}</span>`
  ).join("");

  const genresHtml = `
    <div class="dp-card">
      <div class="dp-card-title">🎵 Dominant Genres in Library</div>
      <div class="dp-genre-chips">${genreBubbles || '<span class="dp-none">No data</span>'}</div>
    </div>`;

  // ── Top scored tracks table ───────────────────────────────────────────────
  const bar = (v) => {
    const pct = Math.round((v || 0) * 100);
    const col = pct >= 70 ? "#1db954" : pct >= 40 ? "#f59e0b" : "#ef4444";
    return `<div class="dp-score-bar-wrap" title="${pct}%"><div class="dp-score-bar" style="width:${pct}%;background:${col}"></div><span>${pct}</span></div>`;
  };

  const trackRows = topScored.map((t, i) => `
    <tr class="dp-track-row ${i % 2 === 0 ? "dp-row-even" : ""}">
      <td class="dp-track-num">${i + 1}</td>
      <td class="dp-track-id">${esc(t.trackId || "").slice(-8)}</td>
      <td class="dp-track-genre">
        <span class="dp-genre-pill" style="background:${(genreColors[t.genrePrimary]||"#4b5563")}20;color:${genreColors[t.genrePrimary]||"#9ca3af"}">${esc(t.genrePrimary||"?")}</span>
      </td>
      <td>${bar(t.finalScore)}</td>
      <td>${bar(t.sceneScore)}</td>
      <td>${bar(t.emotionMatch)}</td>
      <td>${bar(t.libraryFitScore)}</td>
    </tr>`).join("");

  const topTracksHtml = `
    <div class="dp-card dp-card--wide">
      <div class="dp-card-title">📊 Top Scored Tracks (pre-compose)</div>
      <div class="dp-table-wrap">
        <table class="dp-table">
          <thead>
            <tr>
              <th>#</th><th>Track ID</th><th>Genre</th>
              <th>Final</th><th>Scene</th><th>Emotion</th><th>Library</th>
            </tr>
          </thead>
          <tbody>${trackRows || '<tr><td colspan="7" style="text-align:center;opacity:0.5">No data</td></tr>'}</tbody>
        </table>
      </div>
      <div class="dp-table-legend">Each bar = 0–100. Final score drives track selection.</div>
    </div>`;

  // ── Playlist genre composition ────────────────────────────────────────────
  const finalTracks = result.tracks || [];
  const genreCount = {};
  finalTracks.forEach(t => {
    const g = t.genrePrimary || "unknown";
    genreCount[g] = (genreCount[g] || 0) + 1;
  });
  const total = finalTracks.length || 1;
  const genreDist = Object.entries(genreCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const compositionHtml = `
    <div class="dp-card">
      <div class="dp-card-title">🎼 Final Playlist Genre Composition</div>
      ${genreDist.length ? `
        <div class="dp-composition">
          ${genreDist.map(([g, n]) => {
            const pct = Math.round((n / total) * 100);
            const col = genreColors[g] || "#4b5563";
            return `
            <div class="dp-comp-row">
              <span class="dp-comp-genre" style="color:${col}">${esc(g)}</span>
              <div class="dp-comp-bar-wrap">
                <div class="dp-comp-bar" style="width:${pct}%;background:${col}"></div>
              </div>
              <span class="dp-comp-pct">${n} track${n !== 1 ? "s" : ""} · ${pct}%</span>
            </div>`;
          }).join("")}
        </div>
        ${sem && lockActive ? `
          <div class="dp-note dp-note--${genreDist[0] && sem.sceneId && genreDist[0][0] !== "unknown" ? "green" : "amber"}">
            Ecosystem target: ≥${Math.round((ecoDebug?.ecosystemFloor || 0.70) * 100)}% from scene genres
          </div>
        ` : ""}
      ` : '<div class="dp-none">Tracks without genre data</div>'}
    </div>`;

  return `
  <div class="dp-toggle-row">
    <button class="dp-toggle-btn" id="debugToggleBtn">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>
      ${open ? "Hide" : "Show"} Debug Info
      <svg class="dp-chevron ${open ? "open" : ""}" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <span class="dp-admin-badge">Admin Only</span>
  </div>
  ${open ? `
  <div class="dp-panel">
    <div class="dp-header">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>
      <span>Scoring Diagnostics</span>
      <span class="dp-model-tag">${esc(diag.scoringModel || dbg.scoringWeights || "—")}</span>
    </div>
    <div class="dp-grid">
      ${sceneHtml}
      ${weightsHtml}
      ${poolHtml}
      ${genresHtml}
    </div>
    ${topTracksHtml}
    ${compositionHtml}
  </div>
  ` : ""}`;
}

// ── Mood panel updater (reactive) ─────────────────────────────────────────────
let _moodPreviewTimer = null;

function updateMoodPanel(text) {
  if (text.length <= 3) {
    document.getElementById("moodGlow")?.classList.remove("active");
    document.getElementById("moodStatus").textContent = "Awaiting input…";
    MOOD_BAR_DEFS.forEach((b) => {
      const el = document.getElementById(b.id);
      const lb = document.getElementById(`${b.id}-label`);
      if (el) el.style.width = "0%";
      if (lb) lb.textContent = "—";
    });
    document.querySelectorAll(".mood-tag").forEach((t) => { t.style.opacity = "0.2"; });
    const style = document.getElementById("moodStyleText");
    if (style) { style.style.opacity = "0"; }
    // Hide scene panel when input is cleared
    const scenePanel = document.getElementById("moodScenePanel");
    if (scenePanel) scenePanel.style.display = "none";
    clearTimeout(_moodPreviewTimer);
    return;
  }

  document.getElementById("moodGlow")?.classList.add("active");
  document.getElementById("moodStatus").textContent = "Reading the moment…";

  // Instant client-side mood bars (no network round-trip)
  const mood = analyzeMoodFromText(text);

  MOOD_BAR_DEFS.forEach((b) => {
    const val = mood[b.key];
    const el = document.getElementById(b.id);
    const lb = document.getElementById(`${b.id}-label`);
    if (el) el.style.width = val + "%";
    if (lb) lb.textContent = moodLevelLabel(val);
  });

  const tagsEl = document.getElementById("moodTags");
  if (tagsEl) {
    tagsEl.innerHTML = mood.tags.map((tag, i) =>
      `<span class="mood-tag" style="opacity:1;transition:opacity 0.4s ${i * 0.07}s">${esc(tag)}</span>`
    ).join("");
  }

  const styleEl = document.getElementById("moodStyleText");
  if (styleEl) {
    styleEl.textContent = mood.style;
    styleEl.style.opacity = "1";
  }

  // Debounced server-side scene detection (400ms after user stops typing)
  clearTimeout(_moodPreviewTimer);
  _moodPreviewTimer = setTimeout(() => fetchScenePreview(text), 400);
}

async function fetchScenePreview(text) {
  try {
    const r = await api(`/generate/preview?vibe=${encodeURIComponent(text)}`);
    if (r.ok && r.data) {
      updateMoodPanelFromServer(r.data);
    }
  } catch (_) {
    // Silently ignore preview errors — client-side mood bars remain
  }
}

function updateMoodPanelFromServer(data) {
  const scenePanel = document.getElementById("moodScenePanel");
  const sceneName = document.getElementById("moodSceneName");
  const sceneBadges = document.getElementById("moodSceneBadges");
  const altsRow = document.getElementById("moodAltsRow");
  const altsEl = document.getElementById("moodAlts");

  if (!scenePanel) return;

  if (!data.scene) {
    // No scene detected — show generic status
    document.getElementById("moodStatus").textContent = "Moment analyzed";
    document.getElementById("moodGlow")?.classList.remove("active");
    scenePanel.style.display = "none";
    return;
  }

  const confPct = Math.round((data.scene.confidence ?? 0) * 100);
  const confColor = confPct >= 80 ? "#1db954" : confPct >= 60 ? "#f59e0b" : "#a78bfa";

  // Update status line with scene name
  const statusEl = document.getElementById("moodStatus");
  if (statusEl) statusEl.textContent = data.scene.label || data.scene.id;

  // Scene name (formatted)
  if (sceneName) {
    sceneName.textContent = data.scene.label || data.scene.id.replace(/_/g, " ");
  }

  // Badges: confidence + era (if detected)
  if (sceneBadges) {
    let badgesHtml = `<span class="mood-scene-badge" style="background:${confColor}18;color:${confColor};border:1px solid ${confColor}30">${confPct}% match</span>`;
    if (data.era?.decade) {
      badgesHtml += `<span class="mood-scene-badge mood-scene-badge--era">${data.era.decade}</span>`;
    }
    if (data.scene.primaryGenres?.length) {
      badgesHtml += data.scene.primaryGenres.slice(0, 2).map((g) =>
        `<span class="mood-scene-badge mood-scene-badge--genre">${esc(g)}</span>`
      ).join("");
    }
    sceneBadges.innerHTML = badgesHtml;
  }

  // Alternative scenes
  if (altsRow && altsEl && data.alternatives?.length) {
    altsEl.innerHTML = data.alternatives.map((alt) => {
      const altConf = Math.round((alt.confidence ?? 0) * 100);
      return `<span class="mood-alt-chip" title="${altConf}% match">${esc(alt.label || alt.id.replace(/_/g," "))}</span>`;
    }).join("");
    altsRow.style.display = "block";
  } else if (altsRow) {
    altsRow.style.display = "none";
  }

  // Show the panel
  scenePanel.style.display = "block";
  document.getElementById("moodGlow")?.classList.remove("active");
}

// ── Event wiring ──────────────────────────────────────────────────────────────
function wireAppEvents() {
  // Profile dropdown
  document.getElementById("profileBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    state.profileOpen = !state.profileOpen;
    document.getElementById("profileDropdown")?.classList.toggle("open", state.profileOpen);
  });
  document.addEventListener("click", (e) => {
    if (!document.getElementById("profileWrap")?.contains(e.target)) {
      state.profileOpen = false;
      document.getElementById("profileDropdown")?.classList.remove("open");
    }
  });

  document.getElementById("logoutBtn")?.addEventListener("click", logout);
  document.getElementById("themeToggleBtn")?.addEventListener("click", toggleTheme);

  // Sync buttons
  document.getElementById("syncChip")?.addEventListener("click", () => triggerSync(false));
  document.getElementById("deltaSyncBtn")?.addEventListener("click", () => triggerSync(false));
  document.getElementById("fullSyncBtn")?.addEventListener("click", () => triggerSync(true));

  document.getElementById("generateBtn")?.addEventListener("click", generate);

  // No-library mode toggle
  document.getElementById("noLibraryToggle")?.addEventListener("click", () => {
    state.noLibraryMode = !state.noLibraryMode;
    document.getElementById("noLibraryToggle")?.classList.toggle("on", state.noLibraryMode);
  });

  const vibeInput = document.getElementById("vibeInput");
  const charCount = document.getElementById("charCount");
  let interpretTimer = null;

  vibeInput?.addEventListener("input", () => {
    const text = vibeInput.value;
    charCount.textContent = text.length;
    clearTimeout(interpretTimer);
    updateMoodPanel(text);
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
      updateMoodPanel(vibeInput.value);
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

  document.getElementById("debugToggleBtn")?.addEventListener("click", () => {
    state.showDebug = !state.showDebug;
    const panel = document.querySelector(".dp-panel");
    const btn = document.getElementById("debugToggleBtn");
    const chevron = btn?.querySelector(".dp-chevron");
    const label = btn?.childNodes;
    if (state.showDebug) {
      if (btn) btn.innerHTML = btn.innerHTML.replace("Show", "Hide");
      chevron?.classList.add("open");
      if (!panel) {
        const wrap = btn?.closest(".dp-toggle-row")?.parentElement;
        if (wrap) {
          const existing = wrap.querySelector(".dp-panel");
          if (!existing && state.lastResult) {
            const tmp = document.createElement("div");
            tmp.innerHTML = buildDebugPanel(state.lastResult);
            const newPanel = tmp.querySelector(".dp-panel");
            if (newPanel) wrap.appendChild(newPanel);
          }
        }
      }
      document.querySelector(".dp-panel")?.style.setProperty("display", "block");
    } else {
      if (btn) btn.innerHTML = btn.innerHTML.replace("Hide", "Show");
      chevron?.classList.remove("open");
      document.querySelector(".dp-panel")?.style.setProperty("display", "none");
    }
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

async function triggerSync(full = false) {
  const btn = full
    ? document.getElementById("fullSyncBtn")
    : document.getElementById("deltaSyncBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Syncing…"; }
  await api("/spotify/sync", { method: "POST", body: JSON.stringify({ full }) });
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
    const r = await api("/generate?debug=1", {
      method: "POST",
      body: JSON.stringify({
        vibe,
        mode: state.mode,
        length: state.length,
        noLibraryMode: state.noLibraryMode,
      }),
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
      updateMoodPanel(savedVibe);
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
