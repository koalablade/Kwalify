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

function trackGenreLabel(track) {
  return track?.genrePrimary ||
    track?.genreFamily ||
    (Array.isArray(track?.genres) && track.genres.length ? track.genres[0] : null) ||
    (track?.scoringDebug?.genrePrimary && track.scoringDebug.genrePrimary !== "unknown" ? track.scoringDebug.genrePrimary : null) ||
    (Array.isArray(track?.clusterIds)
      ? track.clusterIds.find((cluster) => typeof cluster === "string" && cluster.startsWith("genre:"))?.replace("genre:", "")
      : null) ||
    "(missing)";
}

function finalGenreDistributionEntries(result) {
  const diagnosticDistribution =
    result?.finalGenreDistribution ||
    result?.generationAuditSnapshot?.finalGenreDistribution;
  if (diagnosticDistribution && typeof diagnosticDistribution === "object") {
    const entries = Object.entries(diagnosticDistribution)
      .filter(([genre, count]) => genre && typeof count === "number" && count > 0)
      .sort((a, b) => b[1] - a[1]);
    const knownEntries = entries.filter(([genre]) => genre !== "(missing)" && genre !== "unknown");
    if (knownEntries.length) return knownEntries.slice(0, 10);
    if (entries.length) return entries.slice(0, 10);
  }

  const genreCount = {};
  (result?.tracks || []).forEach((track) => {
    const genre = trackGenreLabel(track);
    genreCount[genre] = (genreCount[genre] || 0) + 1;
  });
  return Object.entries(genreCount).sort((a, b) => b[1] - a[1]).slice(0, 10);
}

function backendDistributionEntries(result, field) {
  const diagnosticDistribution =
    result?.[field] ||
    result?.generationAuditSnapshot?.[field];
  if (!diagnosticDistribution || typeof diagnosticDistribution !== "object") return [];
  return Object.entries(diagnosticDistribution)
    .filter(([label, count]) => label && typeof count === "number" && count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
}

async function api(path, opts = {}) {
  const r = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}

const feedbackSessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
let generationStatusTimer = null;

function feedbackTrackPayload(track) {
  return {
    trackId: track?.trackId || track?.id,
    trackName: track?.trackName || track?.name || null,
    artistName: track?.artistName || track?.artist || null,
    albumName: track?.albumName || track?.album || null,
    genrePrimary: track?.genrePrimary || null,
    genreFamily: track?.genreFamily || null,
    genres: Array.isArray(track?.genres) ? track.genres : null,
    energy: typeof track?.energy === "number" ? track.energy : null,
  };
}

async function sendFeedbackEvent(track, action, playlistId = null, context = {}) {
  const payloadTrack = feedbackTrackPayload(track);
  if (!payloadTrack.trackId) return;
  await api("/feedback/track", {
    method: "POST",
    body: JSON.stringify({
      trackId: payloadTrack.trackId,
      action,
      playlistId: playlistId ? String(playlistId) : "",
      context,
      track: payloadTrack,
    }),
  });
}

async function sendImplicitFeedback(track, playDuration, skipped, eventType = null) {
  const payloadTrack = feedbackTrackPayload(track);
  if (!payloadTrack.trackId) return;
  await api("/feedback/implicit", {
    method: "POST",
    body: JSON.stringify({
      ...payloadTrack,
      playDuration,
      skipped,
      eventType,
      sessionId: feedbackSessionId,
    }),
  });
}

async function replacePlaylistTrack(playlistId, track, context = {}) {
  const payloadTrack = feedbackTrackPayload(track);
  if (!playlistId || !payloadTrack.trackId) return null;
  const result = await api(`/playlists/${playlistId}/replace-track`, {
    method: "POST",
    body: JSON.stringify({
      trackId: payloadTrack.trackId,
      vibe: context.vibe || "",
    }),
  });
  return result.ok ? result.data.replacement : null;
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
  generationProgress: null,
  lastResult: null,
  error: null,
  tasteOpen: false,
  profileOpen: false,
  showDebug: false,
  showExplain: false,
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
          <label class="no-library-toggle" title="Use Spotify-wide search for clear genre prompts, with your library only as fallback">
            <div class="toggle-switch ${state.noLibraryMode ? "on" : ""}" id="noLibraryToggle"></div>
            <div class="no-library-text">
              <span class="no-library-label">No Library Mode</span>
              <span class="no-library-sub">Spotify-wide genre search · library fallback</span>
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

const GENERATION_STAGES = ["Scanning library", "Finding matches", "Ranking tracks", "Building flow", "Finalising playlist"];
const GENERATION_BUILD_LABELS = ["Scanning library", "Matching vibe", "Ranking tracks", "Building flow", "Finalising playlist"];
const GENERATION_PHASES = ["starting", "loading_library", "building_profile", "scoring", "composing", "spotify", "saving"];
const GENERATION_PHASE_COPY = {
  "Scanning library": ["Scanning library", "Checking every eligible liked song before narrowing the pool."],
  "Finding matches": ["Finding matches", "Collecting tracks that fit the prompt and your taste."],
  "Ranking tracks": ["Ranking tracks", "Scoring candidates against genre, energy, era, and mood."],
  "Building flow": ["Building flow", "Sequencing the first tracks while smoothing the playlist arc."],
  "Finalising playlist": ["Finalising playlist", "Saving the playlist and adding the final track order."],
};

function generationProgressInfo() {
  const phase = state.generationProgress?.phase || "starting";
  const stage = state.generationProgress?.stage || null;
  const copy = GENERATION_PHASE_COPY[stage] || GENERATION_PHASE_COPY[GENERATION_STAGES[Math.max(0, GENERATION_PHASES.indexOf(phase) - 1)] || "Scanning library"];
  const index = typeof state.generationProgress?.stageIndex === "number"
    ? state.generationProgress.stageIndex
    : Math.max(0, Math.min(GENERATION_STAGES.length - 1, GENERATION_PHASES.indexOf(phase) - 1));
  const count = state.generationProgress?.stageCount || GENERATION_STAGES.length;
  const pct = Math.max(10, Math.min(96, Math.round(((index + 1) / count) * 100)));
  return { title: copy[0], sub: copy[1], pct, index, count };
}

function generatingHtml() {
  const progress = generationProgressInfo();
  const buildBarHtml = `
      <div class="dj-build-bar" aria-label="Playlist generation progress">
        ${GENERATION_BUILD_LABELS.map((label, i) => {
          const stateClass = i < progress.index ? "done" : i === progress.index ? "active" : "pending";
          const icon = i < progress.index ? "✓" : i === progress.index ? "▶" : "•";
          return `<div class="dj-build-step ${stateClass}">
            <span class="dj-build-icon">${icon}</span>
            <span class="dj-build-label">${esc(label)}</span>
          </div>`;
        }).join("")}
      </div>`;
  const partialTracks = Array.isArray(state.generationProgress?.partialTracks)
    ? state.generationProgress.partialTracks
    : [];
  const partialHtml = partialTracks.length ? `
      <div class="generating-partials">
        <div class="generating-partials-head">Previewing ${partialTracks.length} track${partialTracks.length === 1 ? "" : "s"}</div>
        ${partialTracks.map((track, i) => `
          <div class="generating-track">
            <span class="generating-track-num">${i + 1}</span>
            <div class="generating-track-art">${track.albumArt ? `<img src="${esc(track.albumArt)}" alt="" loading="lazy">` : ""}</div>
            <div class="generating-track-meta">
              <div class="generating-track-name">${esc(track.trackName || "Unknown track")}</div>
              <div class="generating-track-artist">${esc(track.artistName || "Unknown artist")}</div>
            </div>
          </div>
        `).join("")}
      </div>` : "";
  return `
  <div class="generating-card">
    <span class="spinner spinner--purple"></span>
    <div class="generating-body">
      <div class="generating-title">${esc(progress.title)}</div>
      <div class="generating-sub">${esc(progress.sub)}</div>
      ${buildBarHtml}
      <div class="generating-progress" aria-hidden="true">
        <div class="generating-progress-fill" style="width:${progress.pct}%"></div>
      </div>
      ${partialHtml}
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

  const hasExplain = !!(result.v3Diagnostics?.playlistExplanation);
  const tabsHtml = hasExplain ? `
  <div class="result-view-tabs">
    <button class="result-tab-btn ${!state.showExplain ? "active" : ""}" id="tabPlaylist">
      <i class="tab-icon">🎵</i>Playlist
    </button>
    <button class="result-tab-btn ${state.showExplain ? "active" : ""}" id="tabExplain">
      <i class="tab-icon">🧠</i>Explain This Playlist
    </button>
  </div>` : "";

  const explainContent = (hasExplain && state.showExplain)
    ? renderPlaylistExplanation(result.v3Diagnostics.playlistExplanation)
    : "";
  const tracks = Array.isArray(result.tracks) ? result.tracks : [];
  const playlistId = result.savedPlaylistId || result.playlistId || "";
  const tracksHtml = tracks.length ? `
  <div class="tracks-list" id="resultTracksList">
    ${tracks.map((t, i) => {
      const title = t.trackName || t.name || "Unknown track";
      const artist = t.artistName || t.artist || "Unknown artist";
      const art = t.albumArt || t.album_art;
      const why = Array.isArray(t.whyReasons) && t.whyReasons.length
        ? ` title="Why this song: ${esc(t.whyReasons.slice(0, 3).join(", "))}"`
        : "";
      return `
      <div class="track-row" data-track-index="${i}"${why}>
        <span class="track-num">${i + 1}</span>
        <div class="track-art">${art ? `<img src="${esc(art)}" alt="" loading="lazy">` : ""}</div>
        <div class="track-info">
          <div class="track-name">${esc(title)}</div>
          <div class="track-artist">${esc(artist)}</div>
        </div>
        <div class="track-actions">
          <button class="section-action feedback-track-btn" data-action="skip" data-track-index="${i}" data-playlist-id="${playlistId}" title="Skip this track" aria-label="Skip this track">⏭</button>
          <button class="section-action feedback-track-btn" data-action="remove" data-track-index="${i}" data-playlist-id="${playlistId}" title="Remove from future playlists" aria-label="Remove from future playlists">−</button>
          <button class="section-action feedback-track-btn" data-action="replace" data-track-index="${i}" data-playlist-id="${playlistId}" title="Replace with a nearby track" aria-label="Replace with a nearby track">↻</button>
          <button class="section-action feedback-track-btn" data-action="like" data-track-index="${i}" data-playlist-id="${playlistId}" title="Like this track" aria-label="Like this track">♥</button>
          <button class="section-action feedback-track-btn" data-action="dislike" data-track-index="${i}" data-playlist-id="${playlistId}" title="Thumbs down" aria-label="Thumbs down">↓</button>
          <button class="section-action feedback-track-btn undo-feedback-btn" data-action="undo" data-track-index="${i}" data-playlist-id="${playlistId}" title="Undo last feedback" aria-label="Undo last feedback" style="display:none">Undo</button>
        </div>
      </div>`;
    }).join("")}
  </div>` : "";

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
        ${playlistId ? `<a href="/p/${playlistId}" class="btn btn-ghost btn-sm">Share link</a>` : ""}
      </div>
      ${tabsHtml}
    </div>
  </div>
  ${explainContent}
  ${!state.showExplain ? tracksHtml : ""}
  ${!state.showExplain ? debugHtml : ""}`;
}

// ── Explain This Playlist ─────────────────────────────────────────────────────
function renderPlaylistExplanation(expl) {
  if (!expl) return `<div class="explain-card" style="text-align:center;color:var(--muted);padding:32px">No explanation data — regenerate with debug mode enabled.</div>`;

  const intent   = expl.intentSummary    || {};
  const laneList = expl.laneDetails      || [];
  const clusters = expl.clusterMap       || {};
  const div      = expl.diversityReport  || {};
  const sel      = expl.selectionSummary || {};

  const LANE_COLORS = { core:"#7c3aed", emotional:"#db2777", motion:"#0891b2", contrast:"#d97706", discovery:"#16a34a", fallback:"#6b7280", ambient:"#0e7490", high_energy:"#dc2626", low_energy:"#2563eb" };
  const laneColor = (id) => LANE_COLORS[id] || LANE_COLORS[id?.split("_")[0]] || "#6b7280";

  // ── 1. Intent ──────────────────────────────────────────────────────────────
  const evec     = intent.emotionVector || {};
  const evecKeys = ["energy","valence","calm","nostalgia","tension"];
  const evecColors = { energy:"#f59e0b", valence:"#1db954", calm:"#38bdf8", nostalgia:"#a78bfa", tension:"#f87171" };
  const eraVec   = intent.eraVector || {};
  const topEras  = Object.entries(eraVec).sort((a,b) => b[1]-a[1]).slice(0,4);
  const sceneMap = intent.sceneInfluenceMap || {};
  const topScenes = Object.entries(sceneMap).filter(([,v]) => v > 0.05).slice(0,3);

  const intentHtml = `
  <div class="explain-card">
    <div class="explain-card-title">🧠 Intent — What the system understood</div>
    <div class="explain-intent-primary">${esc(String(intent.primaryIntent || "unknown")).replace(/_/g," ")}</div>
    ${(intent.secondaryIntents||[]).length ? `<div class="explain-secondary-tags">${(intent.secondaryIntents||[]).slice(0,6).map(s=>`<span class="explain-tag">${esc(String(s).replace(/_/g," "))}</span>`).join("")}</div>` : ""}
    <div class="explain-emotion-grid">
      ${evecKeys.map(k => {
        const v = evec[k] ?? 0;
        const pct = Math.round(v*100);
        const col = evecColors[k] || "#a78bfa";
        return `<div class="explain-emotion-item">
          <span class="explain-emotion-label">${k}</span>
          <div class="explain-emotion-bar-wrap"><div class="explain-emotion-bar" style="width:${pct}%;background:${col}"></div></div>
          <span class="explain-emotion-val">${pct}%</span>
        </div>`;
      }).join("")}
    </div>
    ${topEras.length ? `<div style="margin-top:10px;font-size:0.7rem;color:var(--muted)">Era focus: ${topEras.map(([e,c])=>`<span style="color:var(--text)">${esc(e)}</span> (${c})`).join(", ")}</div>` : ""}
    ${topScenes.length ? `<div style="margin-top:6px;font-size:0.7rem;color:var(--muted)">Scene signals: ${topScenes.map(([s,v])=>`<span style="color:#c4b5fd">${esc(s.replace(/_/g," "))}</span> ${Math.round(v*100)}%`).join(", ")}</div>` : ""}
    <div style="margin-top:8px;font-size:0.66rem;color:var(--muted-2)">Routing: <span style="color:${intent.activePath==="adaptive"?"#4ade80":"#f59e0b"}">${esc(String(intent.activePath||"adaptive").replace(/_/g," "))}</span></div>
  </div>`;

  // ── 2. Lane distribution ───────────────────────────────────────────────────
  const laneSorted = [...laneList].sort((a,b) => b.pctContribution - a.pctContribution);
  const laneHtml = `
  <div class="explain-card">
    <div class="explain-card-title">🎛️ Lane Distribution — How tracks were routed</div>
    <div class="explain-lane-list">
      ${laneSorted.map(l => {
        const col = laneColor(l.laneId);
        const pct = l.pctContribution || 0;
        return `<div class="explain-lane-row">
          <span class="explain-lane-label" title="${esc(l.laneId)}">${esc((l.label||l.laneId||"").replace(/_/g," "))}</span>
          <div class="explain-lane-bar-wrap"><div class="explain-lane-bar" style="width:${pct}%;background:${col}"></div></div>
          <span class="explain-lane-pct">${pct}%</span>
          <span class="explain-lane-count">${l.selectedCount||0} / ${l.scoredCount||0}</span>
        </div>`;
      }).join("")}
    </div>
    <div style="margin-top:8px;font-size:0.66rem;color:var(--muted-2)">Format: selected / scored candidates per lane</div>
  </div>`;

  // ── 3. Cluster map ─────────────────────────────────────────────────────────
  const clusterEntries = Object.entries(clusters)
    .filter(([,v]) => (v.trackCount || 0) > 0 || (v.weightContribution || 0) > 0)
    .sort((a,b) => (b[1].weightContribution||0) - (a[1].weightContribution||0))
    .slice(0,8);

  const clusterHtml = clusterEntries.length ? `
  <div class="explain-card">
    <div class="explain-card-title">🧬 Cluster Map — Why tracks grouped together</div>
    <div class="explain-cluster-grid">
      ${clusterEntries.map(([cid, cv]) => {
        const label = cid.replace(/^genre:|^era:|^energy:/,"").replace(/_/g," ");
        const wpct  = Math.round((cv.weightContribution||0)*100);
        return `<div class="explain-cluster-row">
          <span class="explain-cluster-id">${esc(label)}</span>
          <span class="explain-cluster-genres">${cv.genres && cv.genres.length ? cv.genres.slice(0,3).map(g=>esc(g.replace(/_/g," "))).join(", ") : cid.split(":")[0]}</span>
          <span class="explain-cluster-tracks">${cv.trackCount||0} tracks</span>
          <span class="explain-cluster-weight" title="cluster weight contribution">${wpct}%</span>
        </div>`;
      }).join("")}
    </div>
  </div>` : "";

  // ── 4. Diversity layer ─────────────────────────────────────────────────────
  const entropyRows = [
    { name:"Genre variety",  val: div.genreEntropy||0,  count: div.genreCount||0,  unit:"genres",  col:"#7c3aed" },
    { name:"Artist spread",  val: div.artistEntropy||0, count: div.artistCount||0, unit:"artists", col:"#0891b2" },
    { name:"Era spread",     val: div.eraEntropy||0,    count: div.eraCount||0,    unit:"eras",    col:"#d97706" },
    { name:"Diversity pressure", val: div.diversityPressure||0, count: null, unit:null, col:"#f87171" },
  ];
  const entropyNote = (v) => v >= 0.75 ? "high — broad selection" : v >= 0.45 ? "moderate" : "low — intentionally concentrated";

  const diversityHtml = `
  <div class="explain-card">
    <div class="explain-card-title">🌐 Diversity Layer — Spread enforcement</div>
    <div class="explain-entropy-list">
      ${entropyRows.map(r => {
        const pct = Math.round(r.val*100);
        return `<div class="explain-entropy-row">
          <div class="explain-entropy-header">
            <span class="explain-entropy-name">${esc(r.name)}${r.count !== null ? ` <span style="color:var(--muted-2)">(${r.count} ${r.unit})</span>` : ""}</span>
            <span class="explain-entropy-val">${pct}%</span>
          </div>
          <div class="explain-entropy-bar-wrap"><div class="explain-entropy-bar" style="width:${pct}%;background:${r.col}"></div></div>
          <span class="explain-entropy-note">${entropyNote(r.val)}</span>
        </div>`;
      }).join("")}
    </div>
    ${div.dominantGenre ? `<div style="margin-top:8px;font-size:0.7rem;color:var(--muted)">Dominant genre: <strong style="color:var(--text)">${esc(div.dominantGenre.replace(/_/g," "))}</strong>${div.dominantEra?` · Era: <strong style="color:var(--text)">${esc(div.dominantEra)}</strong>`:""}</div>` : ""}
  </div>`;

  const quality = v3.playlistQuality || result.generationAuditSnapshot?.playlistQuality || {};
  const repair = v3.explicitIntentRepair || result.generationAuditSnapshot?.explicitIntentRepair || {};
  const cache = result.cacheDiagnostics || result.generationAuditSnapshot?.cacheDiagnostics || {};
  const qPct = (value) => typeof value === "number" ? `${Math.round(value * 100)}%` : "—";
  const qualityHtml = `
  <div class="explain-card">
    <div class="explain-card-title">✅ Playlist Quality Report</div>
    <div class="dp-pool-grid">
      <div class="dp-pool-stat"><div class="dp-pool-num">${qPct(quality.genrePurity)}</div><div class="dp-pool-lbl">Genre purity</div></div>
      <div class="dp-pool-stat"><div class="dp-pool-num">${qPct(quality.promptAlignment)}</div><div class="dp-pool-lbl">Prompt fit</div></div>
      <div class="dp-pool-stat"><div class="dp-pool-num">${repair.repairedCount ?? 0}</div><div class="dp-pool-lbl">Final repairs</div></div>
    </div>
    <div style="margin-top:8px;font-size:0.72rem;color:var(--muted)">
      Cache: <strong style="color:var(--text)">${esc(cache.status || "fresh")}</strong>
      ${repair.active ? ` · repair reasons: <strong style="color:var(--text)">${esc(Object.entries(repair.repairReasons || {}).map(([k,v]) => `${k}:${v}`).join(", ") || "intent")}</strong>` : ""}
    </div>
  </div>`;

  // ── 5. Selection summary ───────────────────────────────────────────────────
  const selRate = sel.selectionRate ?? (sel.totalCandidates > 0 ? Math.round(sel.selected/sel.totalCandidates*100) : 0);
  const rejReasons = (sel.topRejectionReasons||[]).map(r => r.replace(/_/g," "));

  const selHtml = `
  <div class="explain-card">
    <div class="explain-card-title">🔥 Selection Summary — What got in, what didn't</div>
    <div class="explain-sel-stats">
      <div class="explain-sel-stat">
        <div class="explain-sel-num">${sel.totalCandidates||0}</div>
        <div class="explain-sel-lbl">Evaluated</div>
      </div>
      <div class="explain-sel-stat">
        <div class="explain-sel-num" style="color:#4ade80">${sel.selected||0}</div>
        <div class="explain-sel-lbl">Selected</div>
      </div>
      <div class="explain-sel-stat">
        <div class="explain-sel-num" style="color:#f87171">${sel.rejected||0}</div>
        <div class="explain-sel-lbl">Rejected</div>
      </div>
    </div>
    <div style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;font-size:0.7rem;margin-bottom:4px">
        <span style="color:var(--muted)">Selection rate</span>
        <span style="color:${selRate>=50?"#4ade80":"#f59e0b"}">${selRate}%</span>
      </div>
      <div style="height:6px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${selRate}%;background:${selRate>=50?"#1db954":"#f59e0b"};border-radius:3px;transition:width 0.6s"></div>
      </div>
    </div>
    ${rejReasons.length ? `
    <div style="font-size:0.7rem;color:var(--muted);margin-bottom:6px;font-weight:600">Top rejection reasons</div>
    <div class="explain-rejection-list">
      ${rejReasons.map(r=>`<div class="explain-rejection-item"><span class="explain-rejection-dot"></span>${esc(r)}</div>`).join("")}
    </div>` : ""}
  </div>`;

  return `<div class="explain-panel">${intentHtml}${laneHtml}${clusterHtml}${diversityHtml}${selHtml}</div>`;
}

// ── Admin Debug Panel ─────────────────────────────────────────────────────────
// ── Unified debug panel — V3.1 primary, V11 labeled as pre-processing ─────────
function buildUnifiedDebugPanel(result, dbg) {
  const v3  = dbg.v3  || {};
  const v11 = dbg.v11 || {};
  const sys = dbg.systemDiagnostics || {};
  const pool = dbg.poolInfo || {};

  const genreColors = {
    country:"#d97706",folk:"#16a34a",indie:"#7c3aed",rock:"#dc2626",
    electronic:"#0891b2",pop:"#db2777",jazz:"#9333ea",soul:"#ea580c",
    rnb:"#0284c7",hip_hop:"#16a34a",blues:"#2563eb",metal:"#6b7280",
    classical:"#b45309",reggae:"#15803d",latin:"#c2410c",
  };
  const laneColors = { core:"#7c3aed", emotional:"#db2777", motion:"#0891b2", contrast:"#d97706", discovery:"#16a34a", fallback:"#6b7280" };
  const bar = (v) => {
    const pct = Math.round((v || 0) * 100);
    const col = pct >= 70 ? "#1db954" : pct >= 40 ? "#f59e0b" : "#ef4444";
    return `<div class="dp-score-bar-wrap" title="${pct}%"><div class="dp-score-bar" style="width:${pct}%;background:${col}"></div><span>${pct}</span></div>`;
  };

  // ── System health ─────────────────────────────────────────────────────────
  const sysHtml = `
    <div class="dp-card" style="border-color:#334155">
      <div class="dp-card-title" style="color:#94a3b8">⚙️ Pipeline Architecture</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        <span class="dp-badge" style="background:#7c3aed20;color:#a78bfa;border-color:#7c3aed40">Active: ${esc(dbg.activePipeline || "v3.1_unified_routing")}</span>
        <span class="dp-badge" style="background:#0284c720;color:#38bdf8;border-color:#0284c740">V11 → ${esc(sys.v11UsedFor || "candidateGeneration")}</span>
        <span class="dp-badge" style="background:#16a34a20;color:#4ade80;border-color:#16a34a40">V3.1 → ${esc(sys.v3UsedFor || "finalSelection")}</span>
        ${sys.debugPanelAligned ? '<span class="dp-badge" style="background:#16a34a20;color:#4ade80;border-color:#16a34a40">Panel Aligned ✓</span>' : ""}
      </div>
    </div>`;

  // ── V3.1 Intent decomposition ─────────────────────────────────────────────
  const intent = v3.intentDecomposition || {};
  const sceneMap = Object.entries(intent.sceneInfluenceMap || {}).slice(0, 6);
  const ctxAnchors = Object.entries(intent.contextAnchors || {}).slice(0, 4);
  const intentHtml = `
    <div class="dp-card">
      <div class="dp-card-title">🧠 V3.1 Intent Decomposition</div>
      <div style="margin-bottom:8px;font-size:13px">
        <span style="opacity:0.6">Primary vibe: </span><strong>${esc(intent.primary || "—")}</strong>
      </div>
      ${sceneMap.length ? `
        <div class="dp-sub-title">Scene Influence Map</div>
        ${sceneMap.map(([scene, weight]) => {
          const pct = Math.round((weight || 0) * 100);
          return `<div class="dp-weight-row">
            <span class="dp-weight-label">${esc(scene).replace(/_/g," ")}</span>
            <div class="dp-weight-bar-wrap"><div class="dp-weight-bar" style="width:${Math.min(100,pct*1.5)}%;background:#7c3aed"></div></div>
            <span class="dp-weight-pct">${pct}%</span>
          </div>`;
        }).join("")}
      ` : ""}
      ${ctxAnchors.length ? `
        <div class="dp-sub-title" style="margin-top:8px">Context Anchors</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          ${ctxAnchors.map(([k,v]) => `<span class="dp-badge">${esc(k)}: ${esc(String(v))}</span>`).join("")}
        </div>
      ` : ""}
    </div>`;

  // ── V3.1 Global diversity ─────────────────────────────────────────────────
  const gd = (v3.globalDiversityMetrics || {}).postInterleave || {};
  const diversityHtml = `
    <div class="dp-card">
      <div class="dp-card-title">🌈 V3.1 Global Diversity (Post-Interleave)</div>
      <div class="dp-pool-grid" style="grid-template-columns:repeat(3,1fr);gap:8px">
        <div class="dp-pool-stat"><div class="dp-pool-num">${Math.round((gd.genreConcentration||0)*100)}%</div><div class="dp-pool-lbl">Genre conc.</div></div>
        <div class="dp-pool-stat"><div class="dp-pool-num">${Math.round((gd.eraConcentration||0)*100)}%</div><div class="dp-pool-lbl">Era conc.</div></div>
        <div class="dp-pool-stat"><div class="dp-pool-num">${Math.round((gd.artistRepeatIndex||0)*100)}%</div><div class="dp-pool-lbl">Artist repeat</div></div>
      </div>
      <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
        ${gd.driftState ? `<span class="dp-badge">Drift: ${esc(gd.driftState)}</span>` : ""}
        ${gd.explorationPressure != null ? `<span class="dp-badge">Exploration: ${Math.round((gd.explorationPressure||0)*100)}%</span>` : ""}
        ${gd.dominantGenre ? `<span class="dp-badge">Top genre: ${esc(gd.dominantGenre)}</span>` : ""}
        ${gd.dominantEra   ? `<span class="dp-badge">Top era: ${esc(gd.dominantEra)}</span>` : ""}
      </div>
    </div>`;

  // ── V3.1 Lane architecture ────────────────────────────────────────────────
  const lanes = v3.lanes || [];
  const lanesHtml = `
    <div class="dp-card dp-card--wide">
      <div class="dp-card-title">🛣️ V3.1 Lane Architecture <span style="font-weight:400;font-size:11px;opacity:0.6">(these lanes make the final selection)</span></div>
      <div class="dp-table-wrap">
        <table class="dp-table">
          <thead><tr><th>Lane</th><th>Type</th><th>Weight</th><th>Scored</th><th>→ Selected</th><th>Genre clusters</th><th>Era clusters</th></tr></thead>
          <tbody>
            ${lanes.map(l => {
              const col = laneColors[l.type] || "#4b5563";
              const spread = l.clusterSpread || {};
              const ratio = l.scoredCount > 0 ? Math.round((l.selectedCount / l.scoredCount) * 100) : 0;
              return `<tr>
                <td><span class="dp-genre-pill" style="background:${col}20;color:${col}">${esc(l.laneId)}</span></td>
                <td style="opacity:0.7;font-size:11px">${esc(l.type)}</td>
                <td><strong>${Math.round((l.weight||0)*100)}%</strong></td>
                <td>${l.scoredCount}</td>
                <td>${l.selectedCount} <span style="opacity:0.5;font-size:11px">(${ratio}%)</span></td>
                <td>${spread.genreClusters ?? "—"}</td>
                <td>${spread.eraClusters ?? "—"}</td>
              </tr>`;
            }).join("") || '<tr><td colspan="7" style="text-align:center;opacity:0.5">No lane data</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;

  // ── V3.1 Final decision trace ─────────────────────────────────────────────
  const trace = (v3.finalDecisionTrace || []).slice(0, 40);
  const traceHtml = `
    <div class="dp-card dp-card--wide">
      <div class="dp-card-title">✅ V3.1 Final Decision Trace <span style="font-weight:400;font-size:11px;opacity:0.6">(why each track was selected or rejected per lane)</span></div>
      <div class="dp-table-wrap">
        <table class="dp-table">
          <thead><tr><th>#</th><th>Track</th><th>Lane</th><th>Raw Score</th><th>Div. Penalty</th><th>Cluster</th><th>Status</th></tr></thead>
          <tbody>
            ${trace.map((t, i) => {
              const penPct   = Math.round((t.diversityPenalty || 0) * 100);
              const rawPct   = Math.round((t.rawLaneScore || 0) * 100);
              const laneKey  = (t.enteredLane || "").split("_")[0];
              const laneCol  = laneColors[laneKey] || "#4b5563";
              const selColor = t.selected ? "#1db954" : "#9ca3af";
              const selLabel = t.selected ? "✓ Selected" : "✗ " + esc(t.rejectionReason || "rejected");
              const clusterLabel = (t.clusterId || "—").replace(/^(genre|era|energy|mood):/, "");
              return `<tr class="${i % 2 === 0 ? "dp-row-even" : ""}">
                <td class="dp-track-num">${i + 1}</td>
                <td class="dp-track-id">${esc(t.trackId || "").slice(-8)}</td>
                <td><span class="dp-genre-pill" style="background:${laneCol}20;color:${laneCol}">${esc(t.enteredLane || "—")}</span></td>
                <td>${bar(t.rawLaneScore)}</td>
                <td style="color:${penPct > 20 ? "#ef4444" : penPct > 5 ? "#f59e0b" : "#6b7280"}">${penPct > 0 ? "-" + penPct + "%" : "—"}</td>
                <td style="font-size:11px;opacity:0.7">${esc(clusterLabel)}</td>
                <td><span style="color:${selColor};font-size:11px;font-weight:600">${selLabel}</span></td>
              </tr>`;
            }).join("") || '<tr><td colspan="7" style="text-align:center;opacity:0.5">No trace — regenerate with ?debug=1</td></tr>'}
          </tbody>
        </table>
      </div>
      <div class="dp-table-legend">Raw Score = pre-penalty lane affinity. Penalty from rolling diversity window. Rejection = cluster entropy constraint.</div>
    </div>`;

  // ── V11 section ───────────────────────────────────────────────────────────
  const v11SectionHeader = `
    <div style="margin:20px 0 10px;padding:8px 12px;background:rgba(0,0,0,0.2);border:1px solid #292524;border-radius:6px;font-size:11px;color:#78716c;letter-spacing:0.06em;text-transform:uppercase;display:flex;align-items:center;gap:8px">
      🔧 V11 Pre-Processing Layer — Candidate generation only · not the decision layer
    </div>`;

  const sem = v11.semanticResolution || {};
  const confPct   = Math.round((sem.confidence || 0) * 100);
  const confColor = confPct >= 80 ? "#1db954" : confPct >= 55 ? "#f59e0b" : "#ef4444";
  const v11SceneHtml = `
    <div class="dp-card">
      <div class="dp-card-title">🔍 V11 Pre-Scene Signal <span style="font-weight:400;font-size:11px;opacity:0.5">(was "Detected Scene")</span></div>
      ${sem.sceneId ? `
        <div class="dp-scene-name">${esc(sem.sceneId).replace(/_/g," ")}</div>
        <div class="dp-scene-meta">
          <span class="dp-badge" style="background:${confColor}20;color:${confColor};border-color:${confColor}40">${confPct}% confidence</span>
          ${sem.fallback ? '<span class="dp-badge dp-badge--muted">Fallback</span>' : ""}
        </div>
      ` : `<div class="dp-none">${sem.fallback ? "No scene — V11 fallback active" : "No scene matched"}</div>`}
      <div style="margin-top:8px;font-size:11px;opacity:0.45">V11 uses this to weight candidates. V3.1 uses its own intent decomposition above.</div>
    </div>`;

  const libSize   = pool.librarySize   || 0;
  const hybSize   = pool.hybridPoolSize || 0;
  const removed   = libSize - hybSize;
  const removePct = libSize > 0 ? Math.round((removed / libSize) * 100) : 0;
  const topExcl   = Object.entries(v11.exclusionReasons || {}).sort((a,b) => b[1]-a[1]).slice(0, 5);
  const v11PoolHtml = `
    <div class="dp-card">
      <div class="dp-card-title">🗂️ V11 Filtered Pool <span style="font-weight:400;font-size:11px;opacity:0.5">(was "Candidate Pool")</span></div>
      <div class="dp-pool-grid">
        <div class="dp-pool-stat"><div class="dp-pool-num">${libSize.toLocaleString()}</div><div class="dp-pool-lbl">Library tracks</div></div>
        <div class="dp-pool-arrow">→</div>
        <div class="dp-pool-stat"><div class="dp-pool-num" style="color:#1db954">${hybSize.toLocaleString()}</div><div class="dp-pool-lbl">After V11 filter</div></div>
        <div class="dp-pool-arrow">→</div>
        <div class="dp-pool-stat"><div class="dp-pool-num" style="color:#f59e0b">${removed.toLocaleString()}</div><div class="dp-pool-lbl">Removed (${removePct}%)</div></div>
      </div>
      ${topExcl.length ? `
        <div class="dp-sub-title">Exclusion reasons</div>
        <div class="dp-exclusions">
          ${topExcl.map(([r,n]) => `<div class="dp-excl-row"><span>${esc(r)}</span><span class="dp-excl-count">${n}</span></div>`).join("")}
        </div>
      ` : ""}
    </div>`;

  const topCands = (v11.topRankedCandidates || []).slice(0, 15);
  const v11CandidatesHtml = `
    <div class="dp-card dp-card--wide">
      <div class="dp-card-title">📋 V11 Ranked Candidates <span style="font-weight:400;font-size:11px;opacity:0.5">(was "Top Scored Tracks") — V3.1 selects from this pool using lane architecture, not V11 rank</span></div>
      <div class="dp-table-wrap">
        <table class="dp-table">
          <thead><tr><th>#</th><th>Track</th><th>Genre</th><th>V11 Final</th><th>V11 Scene</th><th>V11 Emotion</th><th>V11 Library</th></tr></thead>
          <tbody>
            ${topCands.map((t, i) => `
              <tr class="${i % 2 === 0 ? "dp-row-even" : ""}">
                <td class="dp-track-num">${i + 1}</td>
                <td class="dp-track-id">${esc(t.trackId || "").slice(-8)}</td>
                <td><span class="dp-genre-pill" style="background:${(genreColors[t.genrePrimary]||"#4b5563")}20;color:${genreColors[t.genrePrimary]||"#9ca3af"}">${esc(t.genrePrimary||"?")}</span></td>
                <td>${bar(t.finalScore)}</td>
                <td>${bar(t.sceneScore)}</td>
                <td>${bar(t.emotionMatch)}</td>
                <td>${bar(t.libraryFitScore)}</td>
              </tr>`).join("") || '<tr><td colspan="7" style="text-align:center;opacity:0.5">No data</td></tr>'}
          </tbody>
        </table>
      </div>
      <div class="dp-table-legend">These V11 scores order the pool V3.1 receives — they do not determine final selection. See Decision Trace above.</div>
    </div>`;

  // ── Final playlist genre composition ──────────────────────────────────────
  const finalTracks = result.tracks || [];
  const total = finalTracks.length || 1;
  const genreDist = finalGenreDistributionEntries(result);
  const compositionHtml = `
    <div class="dp-card">
      <div class="dp-card-title">🎼 Final Playlist Genre Composition</div>
      ${genreDist.length ? `
        <div class="dp-composition">
          ${genreDist.map(([g,n]) => {
            const pct = Math.round((n / total) * 100);
            const col = genreColors[g] || "#4b5563";
            return `<div class="dp-comp-row">
              <span class="dp-comp-genre" style="color:${col}">${esc(g)}</span>
              <div class="dp-comp-bar-wrap"><div class="dp-comp-bar" style="width:${pct}%;background:${col}"></div></div>
              <span class="dp-comp-pct">${n} track${n !== 1 ? "s" : ""} · ${pct}%</span>
            </div>`;
          }).join("")}
        </div>
      ` : '<div class="dp-none">No genre data</div>'}
    </div>`;
  const distributionCard = (title, entries) => `
    <div class="dp-card">
      <div class="dp-card-title">${esc(title)}</div>
      ${entries.length ? `
        <div class="dp-composition">
          ${entries.map(([label, count]) => {
            const pct = Math.round((count / total) * 100);
            return `<div class="dp-comp-row">
              <span class="dp-comp-genre">${esc(label)}</span>
              <div class="dp-comp-bar-wrap"><div class="dp-comp-bar" style="width:${pct}%;background:#4b5563"></div></div>
              <span class="dp-comp-pct">${count} · ${pct}%</span>
            </div>`;
          }).join("")}
        </div>
      ` : '<div class="dp-none">No backend data</div>'}
    </div>`;
  const backendDistributionsHtml = `
    <div class="dp-grid">
      ${distributionCard("Final Era Distribution", backendDistributionEntries(result, "finalEraDistribution"))}
      ${distributionCard("Final Mood Distribution", backendDistributionEntries(result, "finalMoodDistribution"))}
      ${distributionCard("Final Energy Distribution", backendDistributionEntries(result, "finalEnergyDistribution"))}
    </div>`;

  return `
  <div class="dp-panel">
    <div class="dp-header">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>
      <span>Scoring Diagnostics</span>
      <span class="dp-model-tag">V3.1 Unified Routing</span>
    </div>
    <div class="dp-grid">
      ${sysHtml}
      ${intentHtml}
      ${diversityHtml}
      ${qualityHtml}
    </div>
    ${lanesHtml}
    ${traceHtml}
    ${v11SectionHeader}
    <div class="dp-grid">
      ${v11SceneHtml}
      ${v11PoolHtml}
    </div>
    ${v11CandidatesHtml}
    ${compositionHtml}
    ${backendDistributionsHtml}
  </div>`;
}

// ── Legacy debug panel (V11-only response shape) ──────────────────────────────
function buildDebugPanel(result) {
  // Dispatch to unified panel if new debug object is present
  if (result.debug?.activePipeline) {
    const open = state.showDebug;
    return `
    <div class="dp-toggle-row">
      <button class="dp-toggle-btn" id="debugToggleBtn">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>
        ${open ? "Hide" : "Show"} Debug Info
        <svg class="dp-chevron ${open ? "open" : ""}" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <span class="dp-admin-badge">Admin Only</span>
    </div>
    ${open ? buildUnifiedDebugPanel(result, result.debug) : ""}`;
  }

  // Synthesize unified panel from v3Diagnostics (always present, no ?debug=1 needed)
  if (result.v3Diagnostics?.intentDecomposition) {
    const vd = result.v3Diagnostics;
    const synthesized = {
      activePipeline: vd.pipelineVersion || "v3.1_unified_routing",
      v3: {
        ...vd,
        finalDecisionTrace: vd.selectionTrace || [],
        globalDiversityMetrics: {
          postInterleave: {
            genreConcentration: vd.genreConcentration,
            explorationPressure: vd.explorationPressure,
            dominantGenre: vd.dominantGenre,
            dominantEra: vd.dominantEra,
          },
        },
      },
      v11: {
        role: "candidateGeneration",
        semanticResolution: null,
        candidatePool: { librarySize: 0, hybridPoolSize: 0, poolCapped: false },
        topRankedCandidates: [],
        exclusionReasons: {},
        dominantGenres: (result.libraryIntelligence || {}).dominantGenres || [],
        candidateWeights: "semantic:0.40_emotion:0.20_scene:0.15_aesthetic:0.10_library:0.10_genre:0.05",
      },
      systemDiagnostics: {
        v11UsedFor: "candidateGeneration",
        v3UsedFor: "finalSelection",
        debugPanelAligned: true,
      },
      poolInfo: {},
    };
    const open = state.showDebug;
    return `
    <div class="dp-toggle-row">
      <button class="dp-toggle-btn" id="debugToggleBtn">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>
        ${open ? "Hide" : "Show"} Debug Info
        <svg class="dp-chevron ${open ? "open" : ""}" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <span class="dp-admin-badge">Admin Only</span>
    </div>
    ${open ? buildUnifiedDebugPanel(result, synthesized) : ""}`;
  }

  const dbg = result.v3Diagnostics ?? result._debug;
  if (!dbg) return "";

  const diag = dbg.scoringDiagnostics || {};
  const sem = dbg.semanticScene || diag.semanticResolution || null;
  const pool = dbg.poolInfo || {};
  const topScored = (diag.topScored || []).slice(0, 20);
  const domGenres = diag.dominantGenres || [];
  const exclusionReasons = diag.exclusionReasons || {};
  const ecoDebug = dbg.ecosystemDebug || {};
  const open = state.showDebug;

  const confPct = sem ? Math.round((sem.confidence || 0) * 100) : 0;
  const confColor = confPct >= 80 ? "#1db954" : confPct >= 55 ? "#f59e0b" : "#ef4444";
  const lockActive = confPct >= 55;

  const sceneHtml = `
    <div class="dp-card">
      <div class="dp-card-title">🎯 Detected Scene</div>
      ${sem ? `
        <div class="dp-scene-name">${esc(sem.sceneId || "—").replace(/_/g," ")}</div>
        <div class="dp-scene-meta">
          <span class="dp-badge" style="background:${confColor}20;color:${confColor};border-color:${confColor}40">${confPct}% confidence</span>
          <span class="dp-badge ${lockActive ? "dp-badge--green" : "dp-badge--muted"}">Ecosystem lock ${lockActive ? "active ✓" : "inactive"}</span>
          ${dbg.noLibraryMode ? '<span class="dp-badge dp-badge--purple">No Library Mode</span>' : ""}
        </div>
      ` : `<div class="dp-none">No scene matched — using generic mood scoring</div>`}
    </div>`;

  const weights = dbg.noLibraryMode
    ? { Semantic: 55, Emotion: 20, Scene: 15, Aesthetic: 10, Library: 0, Genre: 0 }
    : { Semantic: 40, Emotion: 20, Scene: 15, Aesthetic: 10, Library: 10, Genre: 5 };
  const weightBars = Object.entries(weights).map(([k, v]) => `
    <div class="dp-weight-row">
      <span class="dp-weight-label">${k}</span>
      <div class="dp-weight-bar-wrap"><div class="dp-weight-bar" style="width:${v * 1.8}%;background:${v >= 40 ? "#7c3aed" : v >= 20 ? "#1d4ed8" : v >= 10 ? "#0e7490" : "#374151"}"></div></div>
      <span class="dp-weight-pct">${v}%</span>
    </div>`).join("");
  const weightsHtml = `
    <div class="dp-card">
      <div class="dp-card-title">⚖️ Scoring Weights</div>
      <div class="dp-weights">${weightBars}</div>
    </div>`;

  const libSize = pool.librarySize || 0;
  const hybridSize = pool.hybridPoolSize || 0;
  const filteredOut = libSize - hybridSize;
  const filteredPct = libSize > 0 ? Math.round((filteredOut / libSize) * 100) : 0;
  const topExclusions = Object.entries(exclusionReasons).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const poolHtml = `
    <div class="dp-card">
      <div class="dp-card-title">🗂️ Candidate Pool</div>
      <div class="dp-pool-grid">
        <div class="dp-pool-stat"><div class="dp-pool-num">${libSize.toLocaleString()}</div><div class="dp-pool-lbl">Library tracks</div></div>
        <div class="dp-pool-arrow">→</div>
        <div class="dp-pool-stat"><div class="dp-pool-num" style="color:#1db954">${hybridSize.toLocaleString()}</div><div class="dp-pool-lbl">After pre-filter</div></div>
        <div class="dp-pool-arrow">→</div>
        <div class="dp-pool-stat"><div class="dp-pool-num" style="color:#f59e0b">${filteredOut.toLocaleString()}</div><div class="dp-pool-lbl">Removed (${filteredPct}%)</div></div>
      </div>
      ${pool.poolCapped ? '<div class="dp-note">⚡ Pool was capped</div>' : ""}
      ${topExclusions.length ? `
        <div class="dp-sub-title">Exclusion reasons</div>
        <div class="dp-exclusions">
          ${topExclusions.map(([reason, count]) => `<div class="dp-excl-row"><span>${esc(reason)}</span><span class="dp-excl-count">${count}</span></div>`).join("")}
        </div>
      ` : ""}
    </div>`;

  const genreColors = { country:"#d97706",folk:"#16a34a",indie:"#7c3aed",rock:"#dc2626",electronic:"#0891b2",pop:"#db2777",jazz:"#9333ea",soul:"#ea580c",rnb:"#0284c7",hip_hop:"#16a34a",blues:"#2563eb",metal:"#6b7280",classical:"#b45309",reggae:"#15803d",latin:"#c2410c" };
  const genreBubbles = domGenres.slice(0, 8).map(g =>
    `<span class="dp-genre-chip" style="background:${(genreColors[g]||"#4b5563")}20;color:${genreColors[g]||"#9ca3af"};border-color:${(genreColors[g]||"#4b5563")}40">${esc(g)}</span>`
  ).join("");
  const genresHtml = `
    <div class="dp-card">
      <div class="dp-card-title">🎵 Dominant Genres in Library</div>
      <div class="dp-genre-chips">${genreBubbles || '<span class="dp-none">No data</span>'}</div>
    </div>`;

  const bar = (v) => { const pct = Math.round((v || 0) * 100); const col = pct >= 70 ? "#1db954" : pct >= 40 ? "#f59e0b" : "#ef4444"; return `<div class="dp-score-bar-wrap" title="${pct}%"><div class="dp-score-bar" style="width:${pct}%;background:${col}"></div><span>${pct}</span></div>`; };
  const trackRows = topScored.map((t, i) => `
    <tr class="dp-track-row ${i % 2 === 0 ? "dp-row-even" : ""}">
      <td class="dp-track-num">${i + 1}</td>
      <td class="dp-track-id">${esc(t.trackId || "").slice(-8)}</td>
      <td class="dp-track-genre"><span class="dp-genre-pill" style="background:${(genreColors[t.genrePrimary]||"#4b5563")}20;color:${genreColors[t.genrePrimary]||"#9ca3af"}">${esc(t.genrePrimary||"?")}</span></td>
      <td>${bar(t.finalScore)}</td><td>${bar(t.sceneScore)}</td><td>${bar(t.emotionMatch)}</td><td>${bar(t.libraryFitScore)}</td>
    </tr>`).join("");
  const topTracksHtml = `
    <div class="dp-card dp-card--wide">
      <div class="dp-card-title">📊 Top Scored Tracks (pre-compose)</div>
      <div class="dp-table-wrap">
        <table class="dp-table">
          <thead><tr><th>#</th><th>Track ID</th><th>Genre</th><th>Final</th><th>Scene</th><th>Emotion</th><th>Library</th></tr></thead>
          <tbody>${trackRows || '<tr><td colspan="7" style="text-align:center;opacity:0.5">No data</td></tr>'}</tbody>
        </table>
      </div>
      <div class="dp-table-legend">Each bar = 0–100. Final score drives track selection.</div>
    </div>`;

  const finalTracks = result.tracks || [];
  const total = finalTracks.length || 1;
  const genreDist = finalGenreDistributionEntries(result);
  const compositionHtml = `
    <div class="dp-card">
      <div class="dp-card-title">🎼 Final Playlist Genre Composition</div>
      ${genreDist.length ? `
        <div class="dp-composition">
          ${genreDist.map(([g, n]) => {
            const pct = Math.round((n / total) * 100);
            const col = genreColors[g] || "#4b5563";
            return `<div class="dp-comp-row">
              <span class="dp-comp-genre" style="color:${col}">${esc(g)}</span>
              <div class="dp-comp-bar-wrap"><div class="dp-comp-bar" style="width:${pct}%;background:${col}"></div></div>
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
  const distributionCard = (title, entries) => `
    <div class="dp-card">
      <div class="dp-card-title">${esc(title)}</div>
      ${entries.length ? `
        <div class="dp-composition">
          ${entries.map(([label, count]) => {
            const pct = Math.round((count / total) * 100);
            return `<div class="dp-comp-row">
              <span class="dp-comp-genre">${esc(label)}</span>
              <div class="dp-comp-bar-wrap"><div class="dp-comp-bar" style="width:${pct}%;background:#4b5563"></div></div>
              <span class="dp-comp-pct">${count} · ${pct}%</span>
            </div>`;
          }).join("")}
        </div>
      ` : '<div class="dp-none">No backend data</div>'}
    </div>`;
  const backendDistributionsHtml = `
    <div class="dp-grid">
      ${distributionCard("Final Era Distribution", backendDistributionEntries(result, "finalEraDistribution"))}
      ${distributionCard("Final Mood Distribution", backendDistributionEntries(result, "finalMoodDistribution"))}
      ${distributionCard("Final Energy Distribution", backendDistributionEntries(result, "finalEnergyDistribution"))}
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
    ${backendDistributionsHtml}
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

  document.querySelectorAll(".feedback-track-btn[data-track-index]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const index = Number(btn.dataset.trackIndex);
      const action = btn.dataset.action;
      const track = state.lastResult?.tracks?.[index];
      if (!track || !action) return;
      btn.disabled = true;
      const originalText = btn.textContent;
      btn.textContent = action === "like" ? "♥" : action === "replace" ? "…" : action === "undo" ? "Undo" : "✓";
      const context = { vibe: document.getElementById("vibeInput")?.value || state.lastResult?.vibe || "" };
      try {
        if (action === "undo") {
          await sendFeedbackEvent(track, "undo", btn.dataset.playlistId || null, context);
          btn.closest(".track-row")?.style.setProperty("opacity", "1");
          btn.style.display = "none";
          btn.disabled = false;
          return;
        }
        if (action === "replace") {
          const replacement = await replacePlaylistTrack(btn.dataset.playlistId || null, track, context);
          if (replacement && state.lastResult?.tracks) {
            state.lastResult.tracks[index] = replacement;
            renderApp();
          }
          return;
        }
        await sendFeedbackEvent(track, action, btn.dataset.playlistId || null, context);
        if (action === "skip") await sendImplicitFeedback(track, 0, true, "skip");
        if (action === "like") await sendImplicitFeedback(track, track.durationMs || 0, false, "manual_save");
        if (action === "remove" || action === "dislike") {
          const row = btn.closest(".track-row");
          row?.style.setProperty("opacity", "0.45");
          const undo = row?.querySelector(".undo-feedback-btn");
          if (undo) undo.style.display = "inline-flex";
        }
      } catch (_) {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });
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

  // ── Explain This Playlist tab toggle ──────────────────────────────────────
  document.addEventListener("click", (e) => {
    const tabPl = e.target.id === "tabPlaylist" || e.target.closest("#tabPlaylist");
    const tabEx = e.target.id === "tabExplain"  || e.target.closest("#tabExplain");
    if (tabPl && state.showExplain) {
      state.showExplain = false;
      renderApp();
    } else if (tabEx && !state.showExplain) {
      state.showExplain = true;
      renderApp();
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

function stopGenerationStatusPolling() {
  if (generationStatusTimer) {
    clearTimeout(generationStatusTimer);
    generationStatusTimer = null;
  }
}

function startGenerationStatusPolling() {
  stopGenerationStatusPolling();
  const tick = async () => {
    if (!state.generating) return;
    try {
      const r = await api("/generate/status");
      if (r.ok && r.data?.active) {
        state.generationProgress = {
          phase: r.data.phase || "starting",
          stage: r.data.stage || null,
          stageIndex: typeof r.data.stageIndex === "number" ? r.data.stageIndex : 0,
          stageCount: typeof r.data.stageCount === "number" ? r.data.stageCount : GENERATION_STAGES.length,
          requestId: r.data.requestId || null,
          partialTracks: Array.isArray(r.data.partialTracks) ? r.data.partialTracks : [],
        };
        renderApp();
      }
    } catch {
      // Progress is best-effort; the generate request still owns success/failure.
    } finally {
      if (state.generating) generationStatusTimer = setTimeout(tick, 1200);
    }
  };
  generationStatusTimer = setTimeout(tick, 350);
}

async function generate() {
  const vibeInput = document.getElementById("vibeInput");
  const vibe = vibeInput?.value.trim();
  if (!vibe) { vibeInput?.focus(); return; }
  if (state.generating) return;

  state.generating = true;
  state.generationProgress = { phase: "starting", stage: "Scanning library", stageIndex: 0, stageCount: GENERATION_STAGES.length, requestId: null, partialTracks: [] };
  state.lastResult = null;
  state.error = null;
  state.showExplain = false;
  renderApp();
  startGenerationStatusPolling();

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
    stopGenerationStatusPolling();
    state.generating = false;
    state.generationProgress = null;
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
