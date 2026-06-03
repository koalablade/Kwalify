const root = document.getElementById("appRoot");
const state = {
  mode: "balanced",
  length: 40,
  busy: false,
  lastVibe: "",
  syncTimer: null,
};

const examples = [
  "late-night motorway drive",
  "sunny afternoon working on an old car",
  "songs that sound expensive",
  "end of summer but not sad",
  "music for wandering around London at midnight",
];

const quick = [
  ["Night Drive", "night drive alone on the motorway"],
  ["Gym", "gym songs with focus and drive"],
  ["Chill", "soft chill songs for a slow afternoon"],
  ["Focus", "deep focus without vocals"],
  ["Summer", "end of summer but not sad"],
];

const featureCards = [
  ["brain", "3-Layer Vibe AI", "Parses your scene into location, time, mood, and motion - then maps it to exact audio fingerprints."],
  ["note", "Scores your library", "Every liked song is scored against 5 audio dimensions. Only songs you already love make the cut."],
  ["dice", "Strict, Balanced, Chaotic", "Choose how closely tracks match your vibe. Balanced ensures artist variety and tempo diversity."],
  ["bolt", "One click, done", "Describe your mood, hit Generate. A private playlist appears in your Spotify in seconds."],
];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[char]);
}

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  return {
    ok: response.ok,
    status: response.status,
    data: await response.json().catch(() => ({})),
  };
}

function byId(id) {
  return document.getElementById(id);
}

function spotifyIcon() {
  return `<span class="spotify-dot" aria-hidden="true"></span>`;
}

function brand(kind = "purple") {
  const variant = kind === "green" ? " brand-green" : "";
  return `<a class="brand${variant}" href="/" aria-label="Kwalify home">
    <span class="brand-mark">Y</span>
    <span>Kwalify</span>
  </a>`;
}

function toast(message, tone = "") {
  const layer = byId("toastLayer");
  if (!layer) return;
  const node = document.createElement("div");
  node.className = `toast ${tone}`;
  node.textContent = message;
  layer.appendChild(node);
  window.setTimeout(() => node.remove(), 3300);
}

function formatDate(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function formatTime(value) {
  if (!value) return "";
  try {
    const raw = String(value);
    return new Date(raw.endsWith("Z") ? raw : `${raw}Z`).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function guestPage() {
  root.innerHTML = `<section class="page page-wide">
    <header class="topbar">
      ${brand("green")}
      <a class="button button-green button-small" href="/api/auth/login">${spotifyIcon()}Connect</a>
    </header>

    <section class="guest-hero">
      <div class="hero-pill">${spotifyIcon()} AI-powered playlist generation</div>
      <h1>Your vibe.<span>Your playlist.</span></h1>
      <p>Kwalify reads your Spotify library, analyses every song's energy and mood, then builds a perfectly-matched playlist from what you actually listen to.</p>
      <a class="button button-green button-large" href="/api/auth/login">${spotifyIcon()}Connect with Spotify - it's free</a>
      <div class="trust-line">No credit card · No data stored · Private playlists only</div>
    </section>

    <section class="feature-grid">
      ${featureCards.map(([icon, title, body]) => `<article class="feature-card">
        <span class="feature-icon ${icon}"></span>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(body)}</p>
      </article>`).join("")}
    </section>

    <section class="steps-section">
      <h2>How it works</h2>
      <div class="steps">
        ${step("1", "Connect Spotify", "One-click OAuth - read-only access to your liked songs")}
        ${step("2", "Describe your vibe", "Type anything: \"night drive alone\" or hit a preset")}
        ${step("3", "AI scores tracks", "Energy, valence, tempo, acousticness - all matched locally")}
        ${step("4", "Playlist created", "Opens in Spotify automatically - no manual steps")}
      </div>
    </section>

    <section class="stats-strip" aria-label="Kwalify stats">
      ${stat("5", "Audio dimensions scored")}
      ${stat("3", "AI pipeline layers")}
      ${stat("10-100", "Tracks per playlist")}
      ${stat("0", "Data stored on server")}
    </section>

    <section class="final-cta">
      <h2>Ready to hear it?</h2>
      <p>Connect your Spotify and describe your first vibe. Takes 10 seconds.</p>
      <a class="button button-green button-large" href="/api/auth/login">${spotifyIcon()}Get started free</a>
    </section>
  </section>`;
}

function step(number, title, body) {
  return `<article class="step">
    <span>${number}</span>
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(body)}</p>
  </article>`;
}

function stat(number, label) {
  return `<article><strong>${escapeHtml(number)}</strong><span>${escapeHtml(label)}</span></article>`;
}

function appPage(user) {
  const name = user?.displayName || user?.name || user?.spotifyUserId || "You";
  const avatar = user?.image || user?.avatar || user?.profileImage || "";
  const userChip = avatar
    ? `<span class="user-chip"><img src="${escapeHtml(avatar)}" alt="">${escapeHtml(name)}</span>`
    : `<span class="user-chip">${escapeHtml(name)}</span>`;

  root.innerHTML = `<section class="page page-app">
    <header class="topbar">
      ${brand()}
      <nav class="nav-actions" aria-label="Account">
        ${userChip}
        <a class="button button-dark button-small" href="/gallery">Gallery</a>
        <button class="button button-dark button-small" type="button" id="logoutButton">Log out</button>
      </nav>
    </header>

    <section class="generator-hero">
      <div class="hero-pill">Vibe DJ · from your liked songs</div>
      <h1>What's the vibe?</h1>
      <p>Describe your mood, scene, or moment - the AI scores your entire library and builds the perfect playlist.</p>
      <div class="library-pill" id="syncStatus">Checking library...</div>
    </section>

    <section class="compose-panel" aria-label="Playlist generator">
      <label for="vibeInput">Describe your vibe</label>
      <div class="input-row">
        <span class="input-shell">
          <input id="vibeInput" maxlength="140" autocomplete="off" placeholder="Late-night drive, rainy window, slow focus...">
          <span id="counter">0/140</span>
        </span>
        <button class="button button-purple generate-button" type="button" id="generateButton">Generate</button>
      </div>
      <p class="input-note">Spotify liked songs only - not new recommendations</p>

      <div class="preset-block">
        <span>Example vibes</span>
        <div>${examples.map((item) => `<button class="pill" type="button" data-vibe="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join("")}</div>
      </div>

      <details class="settings" open>
        <summary>Settings</summary>
        <div class="settings-body">
          <div>
            <span class="setting-label">Playlist length - <strong id="lengthLabel">40 tracks</strong></span>
            <input id="lengthInput" type="range" min="10" max="100" step="5" value="40">
          </div>
          <div>
            <span class="setting-label">Match mode</span>
            <div class="mode-row">
              <button type="button" class="mode-button" data-mode="strict">Strict</button>
              <button type="button" class="mode-button active" data-mode="balanced">Balanced</button>
              <button type="button" class="mode-button" data-mode="chaotic">Chaotic</button>
            </div>
          </div>
        </div>
      </details>
    </section>

    <section class="working" id="working">
      <div><span>Building from your liked songs...</span><span>AI scoring tracks</span></div>
      <i></i>
    </section>
    <section class="result-panel" id="result"></section>

    <section class="recent-section">
      <div class="section-title">Recent playlists</div>
      <p>Quick reopen here · Gallery has every playlist</p>
      <div class="recent-list" id="recentList"></div>
      <a class="gallery-link" href="/gallery">View all in Gallery -></a>
    </section>

    <footer class="footer">Beta - <a href="mailto:feedback@kwalify.app">Send feedback</a></footer>
  </section>`;

  bindApp();
  pollSync();
  state.syncTimer = window.setInterval(pollSync, 7000);
  loadRecent();
}

function bindApp() {
  byId("vibeInput").addEventListener("input", updateInput);
  byId("generateButton").addEventListener("click", generate);
  byId("logoutButton").addEventListener("click", logout);
  byId("lengthInput").addEventListener("input", () => {
    state.length = Number(byId("lengthInput").value) || 40;
    byId("lengthLabel").textContent = `${state.length} tracks`;
  });

  document.querySelectorAll("[data-vibe]").forEach((button) => {
    button.addEventListener("click", () => {
      byId("vibeInput").value = button.dataset.vibe || "";
      updateInput();
      byId("vibeInput").focus();
    });
  });

  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode || "balanced";
      document.querySelectorAll("[data-mode]").forEach((item) => item.classList.toggle("active", item === button));
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && document.activeElement === byId("vibeInput")) {
      event.preventDefault();
      generate();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      byId("vibeInput").focus();
    }
  });

  updateInput();
}

function updateInput() {
  const input = byId("vibeInput");
  const button = byId("generateButton");
  const count = input.value.length;
  byId("counter").textContent = `${count}/140`;
  if (!state.busy) {
    button.disabled = count === 0;
    button.textContent = count ? "Generate" : "Describe";
  }
}

function setBusy(value) {
  state.busy = value;
  byId("working").classList.toggle("visible", value);
  byId("generateButton").disabled = value;
  byId("generateButton").textContent = value ? "Building..." : "Generate";
  if (!value) updateInput();
}

async function pollSync(fromClick = false) {
  const target = byId("syncStatus");
  if (!target) return;

  try {
    const response = await fetch("/api/spotify/cache-status", { credentials: "include" });
    const data = response.ok ? await response.json() : null;
    if (!data) {
      target.textContent = "Library status unavailable";
      return;
    }

    const total = Number(data.totalTracks || data.syncedTracks || 0);
    if (data.isSyncing) {
      target.textContent = `Syncing library - ${Number(data.syncedTracks || 0).toLocaleString()}${total ? ` / ${total.toLocaleString()}` : ""} songs`;
      return;
    }

    if (data.synced || total) {
      const time = data.lastSyncedAt ? ` · Last synced ${formatTime(data.lastSyncedAt)}` : "";
      target.innerHTML = `<span>Library ready - ${total.toLocaleString()} songs${time}</span><button type="button" id="fullSyncButton">Full sync</button>`;
      byId("fullSyncButton").addEventListener("click", () => startSync(true));
    } else {
      target.innerHTML = `<span>Library not synced yet</span><button type="button" id="startSyncButton">Start sync</button>`;
      byId("startSyncButton").addEventListener("click", () => startSync(false));
    }

    if (fromClick) toast("Library cache checked", "good");
  } catch {
    target.textContent = "Library status unavailable";
  }
}

async function startSync(full) {
  try {
    await fetch("/api/spotify/sync", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(full ? { full: true } : {}),
    });
    pollSync();
    toast(full ? "Full sync started" : "Sync started", "good");
  } catch {
    toast("Could not start sync", "bad");
  }
}

async function loadRecent() {
  const target = byId("recentList");
  if (!target) return;

  try {
    const response = await api("/playlists");
    if (!response.ok) return;
    const playlists = Array.isArray(response.data.playlists) ? response.data.playlists : [];
    target.innerHTML = playlists.slice(0, 5).map(recentRow).join("");
    target.querySelectorAll("[data-share]").forEach((button) => {
      button.addEventListener("click", () => copyShare(button.dataset.share));
    });
  } catch {
    toast("Could not load recent playlists", "bad");
  }
}

function recentRow(playlist) {
  const count = Array.isArray(playlist.tracks) ? playlist.tracks.length : playlist.trackCount || 0;
  const name = playlist.name || playlist.vibe || "Kwalify playlist";
  const meta = [count ? `${count} tracks` : "", formatDate(playlist.createdAt)].filter(Boolean).join(" · ");
  return `<article class="recent-row">
    <a href="/p/${Number(playlist.id)}">
      <strong>${escapeHtml(name)}</strong>
      <span>${escapeHtml(meta)}</span>
    </a>
    <span>
      ${playlist.spotifyUrl ? `<a class="mini-button green" target="_blank" rel="noopener" href="${escapeHtml(playlist.spotifyUrl)}">Spotify</a>` : ""}
      <button class="mini-button" type="button" data-share="${Number(playlist.id)}">Share</button>
    </span>
  </article>`;
}

async function generate() {
  const input = byId("vibeInput");
  const vibe = input.value.trim();
  if (!vibe) {
    input.focus();
    return;
  }

  state.lastVibe = vibe;
  setBusy(true);
  byId("result").classList.remove("visible");

  try {
    const response = await api("/generate", {
      method: "POST",
      body: JSON.stringify({ vibe, mode: state.mode, length: state.length }),
    });

    if (response.status === 401) {
      window.location.href = "/api/auth/login";
      return;
    }
    if (!response.ok || response.data.error) throw new Error(response.data.error || "Generation failed");

    const tracks = Array.isArray(response.data.tracks) ? response.data.tracks : [];
    if (!tracks.length) throw new Error("No tracks returned");

    renderResult({
      id: response.data.playlistId,
      name: response.data.playlistName || response.data.name || "Kwalify playlist",
      vibe,
      tracks,
      count: response.data.count || response.data.totalTracks || tracks.length,
      url: response.data.spotifyPlaylistUrl || response.data.playlistUrl || "",
    });

    input.value = "";
    updateInput();
    loadRecent();
    toast("Playlist created", "good");
  } catch (error) {
    toast(error.message || "Something went wrong", "bad");
  } finally {
    setBusy(false);
  }
}

function renderResult(result) {
  const target = byId("result");
  target.innerHTML = `<h2>${escapeHtml(result.name)}</h2>
    <p>"${escapeHtml(result.vibe)}" · ${Number(result.count).toLocaleString()} tracks · from your likes</p>
    <div class="result-actions">
      ${result.url ? `<a class="button button-green" target="_blank" rel="noopener" href="${escapeHtml(result.url)}">${spotifyIcon()}Open Spotify</a>` : ""}
      ${result.id ? `<button class="button button-dark" type="button" id="shareResult">Share</button>` : ""}
      <button class="button button-dark" type="button" id="againButton">Regenerate</button>
    </div>
    <div class="track-list">${trackRows(result.tracks, 25)}</div>`;
  target.classList.add("visible");
  byId("shareResult")?.addEventListener("click", () => copyShare(result.id));
  byId("againButton").addEventListener("click", regenerate);
}

function trackRows(tracks, limit) {
  return tracks.slice(0, limit).map((track, index) => {
    const art = track.albumArt || track.album_art || "";
    const name = track.name || track.trackName || "Unknown track";
    const artist = track.artist || track.artistName || "Unknown artist";
    return `<article class="track-row">
      <span>${index + 1}</span>
      ${art ? `<img src="${escapeHtml(art)}" alt="">` : `<i></i>`}
      <strong>${escapeHtml(name)}<small>${escapeHtml(artist)}</small></strong>
    </article>`;
  }).join("");
}

function regenerate() {
  if (!state.lastVibe) return;
  byId("vibeInput").value = state.lastVibe;
  updateInput();
  generate();
}

function copyShare(id) {
  const url = `${window.location.origin}/p/${id}`;
  navigator.clipboard?.writeText(url)
    .then(() => toast("Link copied", "good"))
    .catch(() => toast(url));
}

async function logout() {
  try {
    await api("/auth/logout", { method: "POST" });
  } finally {
    window.location.reload();
  }
}

async function boot() {
  try {
    const response = await api("/auth/me");
    if (response.ok) {
      appPage(response.data.user || response.data);
      return;
    }
  } catch {
    // Guest page is the fallback when auth state cannot be read.
  }
  guestPage();
}

boot();
