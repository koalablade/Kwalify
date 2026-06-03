const root = document.getElementById("appRoot");

const state = {
  user: null,
  lastVibe: "",
  lastPlaylistUrl: "",
  lastMode: "balanced",
  lastOutput: "",
  pollingTimer: null,
};

// ── Utils ─────────────────────────────────────────────────────────────────────

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return "";
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function stopPolling() {
  if (state.pollingTimer) { clearInterval(state.pollingTimer); state.pollingTimer = null; }
}

// ── Phase messages (quick win #10) ────────────────────────────────────────────

const PHASE_MESSAGES = {
  starting:        "Starting...",
  loading_library: "Digging through your library...",
  building_profile:"Building your taste profile...",
  scoring:         "Scoring your tracks...",
  composing:       "Shaping the emotional arc...",
  spotify:         "Creating your Spotify playlist...",
  saving:          "Saving...",
  done:            "Done.",
};

// ── Journey arc labels (quick win #8) ─────────────────────────────────────────

const ARC_LABELS = {
  default:      "intro → build → peak → reflection",
  flat:         "steady throughout",
  recovery:     "heavy start → gradual warmth",
  linear_rise:  "steady lift ↗",
  linear_fall:  "gentle wind-down ↘",
  slow_burn:    "slow deepening",
  peak_release: "build → release",
  wave:         "ebb and flow",
};

// ── Render: Form (quick wins #6, #7) ─────────────────────────────────────────

function renderForm(message = "") {
  const modes = [
    { id: "strict",   label: "Focused" },
    { id: "balanced", label: "Balanced" },
    { id: "chaotic",  label: "Exploratory" },
  ];

  root.innerHTML = `
    <section>
      <header class="site-header">
        <a href="/" class="site-logo">Kwalify</a>
        <nav>
          ${state.user ? `<a href="/gallery">Your playlists</a>` : ""}
          ${state.user ? `<button class="link-btn" id="logoutBtn">Log out</button>` : ""}
        </nav>
      </header>

      ${state.user ? `<p class="user-greeting">Hi ${escapeHtml(state.user.displayName || "there")} · ${escapeHtml(state.user.email || "")}</p>` : ""}

      <form id="generateForm">
        <div>
          <label for="vibeInput">What's your moment?</label>
          <textarea
            id="vibeInput"
            name="vibe"
            rows="3"
            placeholder="late night drive, nostalgic and focused… or try: forgotten favourites, deep cuts, take me back to 2018"
          >${escapeHtml(state.lastVibe)}</textarea>
        </div>

        <div class="mode-row">
          <span class="mode-label">Mode</span>
          <div class="mode-pills" role="group" aria-label="Generation mode">
            ${modes.map(({ id, label }) => `
              <button type="button" class="mode-pill${state.lastMode === id ? " active" : ""}" data-mode="${id}" aria-pressed="${state.lastMode === id}">
                ${label}
              </button>
            `).join("")}
          </div>
        </div>

        <div>
          <label for="playlistUrl">Reference playlist <span class="optional">(optional — Spotify URL)</span></label>
          <input
            id="playlistUrl"
            name="playlistUrl"
            type="url"
            autocomplete="off"
            placeholder="https://open.spotify.com/playlist/…"
            value="${escapeHtml(state.lastPlaylistUrl)}"
          >
        </div>

        ${state.user
          ? `<button type="submit" class="primary-btn" id="generateBtn">Generate →</button>`
          : `<a href="/api/auth/login" class="primary-btn" style="text-align:center">Connect Spotify to start →</a>`
        }
      </form>

      ${message ? `<p class="form-error" role="alert">${escapeHtml(message)}</p>` : ""}
    </section>`;

  // Mode pill toggle
  root.querySelectorAll(".mode-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.lastMode = btn.dataset.mode;
      root.querySelectorAll(".mode-pill").forEach((b) => {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-pressed", String(b === btn));
      });
    });
  });

  document.getElementById("generateForm")?.addEventListener("submit", generate);
  document.getElementById("logoutBtn")?.addEventListener("click", logout);
}

// ── Render: Loading (quick win #10) ───────────────────────────────────────────

function renderLoading() {
  root.innerHTML = `
    <section>
      <header class="site-header">
        <a href="/" class="site-logo">Kwalify</a>
      </header>
      <div class="loading-state">
        <div class="loading-dots"><span></span><span></span><span></span></div>
        <p class="phase-message" id="phaseMsg">Starting...</p>
      </div>
    </section>`;

  state.pollingTimer = setInterval(async () => {
    try {
      const resp = await api("/generate/status");
      if (!resp.ok) return;
      const phase = resp.data?.phase ?? "";
      const msg = PHASE_MESSAGES[phase];
      if (msg) {
        const el = document.getElementById("phaseMsg");
        if (el) el.textContent = msg;
      }
    } catch { /* ignore */ }
  }, 1500);
}

// ── Render: Emotion bars (quick win #4) ───────────────────────────────────────

function renderEmotionBars(ep) {
  if (!ep || typeof ep.energy !== "number") return "";
  const bars = [
    { label: "Energy",    value: ep.energy },
    { label: "Mood",      value: ep.valence },
    { label: "Nostalgia", value: ep.nostalgia },
    { label: "Calm",      value: ep.calm },
  ].filter((b) => typeof b.value === "number");
  if (!bars.length) return "";

  return `<div class="emotion-bars">${bars.map(({ label, value }) => `
    <div class="emotion-bar-row">
      <span class="emotion-bar-label">${label}</span>
      <div class="emotion-bar-track">
        <div class="emotion-bar-fill" style="width:${Math.round(value * 100)}%"></div>
      </div>
      <span class="emotion-bar-pct">${Math.round(value * 100)}%</span>
    </div>`).join("")}
  </div>`;
}

// ── Render: Single track card (quick win #2) ───────────────────────────────────

function renderTrackCard(track, index) {
  const name   = escapeHtml(track.name   || track.trackName  || "Unknown track");
  const artist = escapeHtml(track.artist || track.artistName || "Unknown artist");
  const reasons = Array.isArray(track.whyReasons) ? track.whyReasons : [];

  return `
    <div class="track-card">
      <div class="track-number">${index + 1}</div>
      <div class="track-body">
        <div class="track-title">${name}</div>
        <div class="track-artist">${artist}</div>
        ${reasons.length ? `
          <ul class="track-reasons">
            ${reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}
          </ul>` : ""}
      </div>
    </div>`;
}

// ── Render: Result (quick wins #1–5, #8, #9) ──────────────────────────────────

function renderResult(data) {
  stopPolling();

  const tracks       = Array.isArray(data.tracks) ? data.tracks : [];
  const ep           = data.emotionProfile ?? {};
  const narrative    = data.explanation?.narrative || data.momentUnderstanding?.summary || "";
  const arc          = data.journeyArc || data.explanation?.journeyArc || "";
  const arcLabel     = data.explanation?.emotionalArc || ARC_LABELS[arc] || "";
  const spotifyUrl   = data.spotifyPlaylistUrl || "";
  const warning      = data.referencePlaylistWarning || "";
  const syncHint     = data.librarySyncHint || "";
  const playlistId   = data.playlistId;
  const shareUrl     = playlistId ? `/p/${playlistId}` : "";

  // Quick win #5: duration + artist count
  const totalMs      = data.stats?.totalDurationMs || tracks.reduce((s, t) => s + (t.durationMs || 0), 0);
  const artistCount  = data.stats?.artistCount || new Set(tracks.map((t) => t.artist || t.artistName)).size;

  // Plain-text list for clipboard
  const lines = [data.playlistName || data.name || "Kwalify playlist"];
  if (spotifyUrl) lines.push(spotifyUrl);
  tracks.forEach((t, i) => {
    const n = t.name || t.trackName || "Unknown";
    const a = t.artist || t.artistName || "";
    lines.push(`${i + 1}. ${n}${a ? ` - ${a}` : ""}`);
  });
  state.lastOutput = lines.join("\n");

  root.innerHTML = `
    <section>
      <header class="site-header">
        <a href="/" class="site-logo">Kwalify</a>
        <nav>
          ${state.user ? `<a href="/gallery">Your playlists</a>` : ""}
        </nav>
      </header>

      ${warning  ? `<div class="notice notice-warn">${escapeHtml(warning)}</div>`   : ""}
      ${syncHint ? `<div class="notice notice-info">${escapeHtml(syncHint)}</div>` : ""}

      <h1>${escapeHtml(data.playlistName || data.name || "Your Playlist")}</h1>

      ${narrative ? `<p class="narrative">${escapeHtml(narrative)}</p>` : ""}

      <div class="playlist-meta">
        ${formatDuration(totalMs) ? `<span>${escapeHtml(formatDuration(totalMs))}</span>` : ""}
        ${artistCount ? `<span>${artistCount} artists</span>` : ""}
        <span>${tracks.length} tracks</span>
        ${arcLabel ? `<span class="arc-badge">${escapeHtml(arcLabel)}</span>` : ""}
      </div>

      ${renderEmotionBars(ep)}

      <div class="result-actions">
        ${spotifyUrl ? `<a href="${escapeHtml(spotifyUrl)}" target="_blank" rel="noopener" class="primary-btn spotify-btn">Open in Spotify ↗</a>` : ""}
        <button type="button" id="copyBtn">Copy list</button>
        <button type="button" id="againBtn">Generate again</button>
        ${shareUrl ? `<a href="${escapeHtml(shareUrl)}" class="link-btn">Share →</a>` : ""}
      </div>

      <div class="track-list">
        ${tracks.map((t, i) => renderTrackCard(t, i)).join("")}
      </div>
    </section>`;

  document.getElementById("copyBtn")?.addEventListener("click", () => {
    navigator.clipboard?.writeText(state.lastOutput).catch(() => {});
    const btn = document.getElementById("copyBtn");
    if (btn) { btn.textContent = "Copied!"; setTimeout(() => { btn.textContent = "Copy list"; }, 2000); }
  });
  document.getElementById("againBtn")?.addEventListener("click", () => renderForm());
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function generate(event) {
  event.preventDefault();
  const form = event.currentTarget;

  const vibeRaw    = String(form.querySelector("#vibeInput")?.value  || "").trim();
  const playlistUrl = String(form.querySelector("#playlistUrl")?.value || "").trim();
  const vibe       = vibeRaw || (playlistUrl ? "balanced playlist based on a Spotify reference playlist" : "balanced");

  state.lastVibe        = vibeRaw;
  state.lastPlaylistUrl = playlistUrl;

  renderLoading();

  try {
    const body = {
      vibe,
      mode:   state.lastMode,
      length: 25,
      ...(playlistUrl ? { referencePlaylist: playlistUrl } : {}),
    };

    const resp = await api("/generate", { method: "POST", body: JSON.stringify(body) });

    if (resp.status === 401) { window.location.href = "/api/auth/login"; return; }
    if (!resp.ok || resp.data.error) throw new Error(resp.data.error || "Generation failed");

    renderResult(resp.data);
  } catch (err) {
    stopPolling();
    renderForm(err.message || "Generation failed. Please try again.");
  }
}

async function logout() {
  await api("/auth/logout", { method: "POST" }).catch(() => {});
  state.user = null;
  renderForm();
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function boot() {
  try {
    const resp = await api("/auth/me");
    if (resp.ok) state.user = resp.data;
  } catch { /* Spotify not configured or offline */ }
  renderForm();
}

boot();
