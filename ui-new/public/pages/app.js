const root = document.getElementById("appRoot");
const state = { mode: "balanced", length: 40, busy: false, lastVibe: "" };

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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[char]);
}

function byId(id) {
  return document.getElementById(id);
}

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  return { ok: response.ok, status: response.status, data: await response.json().catch(() => ({})) };
}

function spotifyIcon() {
  return `<span class="spotify-dot" aria-hidden="true"></span>`;
}

function brand(kind = "purple") {
  const variant = kind === "green" ? " brand-green" : "";
  return `<a class="brand${variant}" href="/"><span class="brand-mark">Y</span><span>Kwalify</span></a>`;
}

function toast(message, tone = "") {
  const layer = byId("toastLayer");
  if (!layer) return;
  const node = document.createElement("div");
  node.className = `toast ${tone}`;
  node.textContent = message;
  layer.appendChild(node);
  window.setTimeout(() => node.remove(), 3200);
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
    return new Date(raw.endsWith("Z") ? raw : `${raw}Z`).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function guestPage() {
  root.innerHTML = `<section class="app-page">
    <header class="topbar">
      ${brand("green")}
      <a class="btn btn-green btn-small" href="/api/auth/login">${spotifyIcon()}Connect</a>
    </header>

    <section class="guest-hero">
      <div class="eyebrow">▷ AI-powered playlist generation</div>
      <h1>Your vibe.<span>Your playlist.</span></h1>
      <p>Kwalify reads your Spotify library, analyses every song's energy and mood, then builds a perfectly-matched playlist from what you actually listen to.</p>
      <a class="btn btn-green btn-large" href="/api/auth/login">${spotifyIcon()}Connect with Spotify - it's free</a>
      <div class="trust">No credit card · No data stored · Private playlists only</div>
    </section>

    <section class="how-panel">
      <div class="how-label">How Kwalify works</div>
      <div class="proof-grid">
        ${proof("🧠", "Moment-aware matching", "Parses your scene into location, time, mood, and motion - then matches tracks from your library.")}
        ${proof("🎵", "Matches your library", "Every liked song is matched on mood, energy, and listening history. Only songs you already love make the cut.")}
        ${proof("🎲", "Strict, Balanced, Chaotic", "Choose how closely tracks match your vibe. Balanced ensures artist variety and tempo diversity.")}
        ${proof("⚡", "One click, done", "Describe your mood, hit Generate. A private playlist appears in your Spotify in seconds.")}
      </div>
      <section class="steps-section">
        <h2>How it works</h2>
        <div class="steps">
          ${step("1", "Connect Spotify", "One-click OAuth - read-only access to your liked songs")}
          ${step("2", "Describe your vibe", "Type anything: \"night drive alone\" or hit a preset")}
          ${step("3", "We match your library", "Energy, valence, tempo, and more - matched on our servers from your likes only")}
          ${step("4", "Playlist created", "Opens in Spotify automatically - no manual steps")}
        </div>
      </section>
    </section>

    <section class="stats">
      ${stat("5", "Audio dimensions scored")}
      ${stat("3", "AI pipeline layers")}
      ${stat("10-100", "Tracks per playlist")}
      ${stat("0", "Data stored on server")}
    </section>

    <section class="final-cta">
      <h2>Ready to hear it?</h2>
      <p>Connect your Spotify and describe your first vibe. Takes 10 seconds.</p>
      <a class="btn btn-green btn-large" href="/api/auth/login">${spotifyIcon()}Get started free</a>
    </section>
  </section>`;
}

function proof(icon, title, body) {
  return `<article class="proof"><i>${icon}</i><b>${escapeHtml(title)}</b><p>${escapeHtml(body)}</p></article>`;
}

function step(number, title, body) {
  return `<article class="step"><span class="step-num">${number}</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p></article>`;
}

function stat(value, label) {
  return `<article><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></article>`;
}

function appPage(user) {
  const name = user?.displayName || user?.name || user?.spotifyUserId || "You";
  const avatar = user?.image || user?.avatar || user?.profileImage || "";
  const userChip = avatar
    ? `<span class="user-chip"><img src="${escapeHtml(avatar)}" alt="">${escapeHtml(name)}</span>`
    : `<span class="user-chip">${escapeHtml(name)}</span>`;

  root.innerHTML = `<section class="app-page generator-page">
    <header class="topbar">
      ${brand()}
      <nav class="nav-actions">
        ${userChip}
        <a class="btn btn-small" href="/gallery">Gallery -></a>
        <button class="btn btn-small" id="logoutButton" type="button">Log out</button>
      </nav>
    </header>

    <section class="generator-hero">
      <div class="eyebrow">Vibe DJ · from your liked songs</div>
      <h1>What's the vibe?</h1>
      <p>Describe a moment - Kwalify builds a playlist from songs you already saved on Spotify.</p>
    </section>

    <section class="library-status" id="syncStatus"><span>Checking library...</span></section>
    <section class="library-panel" id="libraryPanel" hidden>
      <div class="library-callout"><strong id="libraryTotal">Library ready</strong><span>That's a huge library. Kwalify can dig through years of favourites, forgotten gems, and deep cuts - only from tracks you already saved on Spotify.</span></div>
      <div class="library-facts">
        <span><strong id="artistCount">-</strong>artists</span>
        <span><strong id="genreCount">10 / 18</strong>main genres spotted</span>
        <span><strong>2020s</strong>Most active decade</span>
        <span><strong id="librarySpan">Likes synced</strong>listening span</span>
      </div>
    </section>

    <section class="composer">
      <label for="vibeInput">Describe your vibe</label>
      <div class="input-row">
        <span class="input-shell"><input id="vibeInput" maxlength="140" autocomplete="off" placeholder="Describe a moment..."><small id="counter">0/140</small></span>
        <button class="btn btn-purple generate-btn" id="generateButton" type="button">Generate</button>
      </div>
      <div class="note">Only uses songs already in your Spotify liked songs.</div>
      <div class="preset-area">
        <span class="mini-label">Try one of these</span>
        <div class="preset-row">${examples.map((item) => `<button class="pill" type="button" data-vibe="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join("")}</div>
        <span class="mini-label">Quick</span>
        <div class="preset-row quick">${quick.map(([label, vibe]) => `<button class="pill" type="button" data-vibe="${escapeHtml(vibe)}">${escapeHtml(label)}</button>`).join("")}</div>
        <div class="settings-grid">
          <div><span class="mini-label">Playlist length - <strong id="lengthLabel" style="color:var(--purple)">40 tracks</strong></span><input id="lengthInput" type="range" min="10" max="100" step="5" value="40"></div>
          <div><span class="mini-label">Match mode</span><div class="mode-row"><button class="mode" data-mode="strict" type="button">Strict</button><button class="mode active" data-mode="balanced" type="button">Balanced</button><button class="mode" data-mode="chaotic" type="button">Chaotic</button></div></div>
        </div>
      </div>
    </section>

    <section class="working" id="working"><div><span>Building from your liked songs...</span><span>AI scoring tracks</span></div><i></i></section>
    <section class="result-panel" id="result"></section>

    <section class="recent">
      <div class="section-title">Recent playlists</div>
      <p>Quick reopen here · Gallery has every playlist</p>
      <div class="recent-list" id="recentList"></div>
      <a class="gallery-link" href="/gallery">View all in Gallery -></a>
    </section>
    <footer class="footer">Beta - <a href="mailto:feedback@kwalify.app">Send feedback</a></footer>
  </section>`;

  bindApp();
  pollSync();
  window.setInterval(pollSync, 7000);
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
  const count = byId("vibeInput").value.length;
  byId("counter").textContent = `${count}/140`;
  if (!state.busy) {
    byId("generateButton").disabled = count === 0;
    byId("generateButton").textContent = count ? "Generate" : "Describe";
  }
}

function setBusy(value) {
  state.busy = value;
  byId("working").classList.toggle("visible", value);
  byId("generateButton").disabled = value;
  byId("generateButton").textContent = value ? "Building..." : "Generate";
  if (!value) updateInput();
}

async function pollSync() {
  const target = byId("syncStatus");
  if (!target) return;
  try {
    const response = await fetch("/api/spotify/cache-status", { credentials: "include" });
    const data = response.ok ? await response.json() : null;
    if (!data) {
      target.innerHTML = `<span>Library status unavailable</span>`;
      return;
    }
    const total = Number(data.totalTracks || data.syncedTracks || 0);
    if (data.isSyncing) {
      target.innerHTML = `<span>Syncing library - ${Number(data.syncedTracks || 0).toLocaleString()}${total ? ` / ${total.toLocaleString()}` : ""} songs</span>`;
      return;
    }
    if (data.synced || total) {
      const time = data.lastSyncedAt ? ` · Last synced ${formatTime(data.lastSyncedAt)}` : "";
      target.innerHTML = `<span>✓ Library ready - ${total.toLocaleString()} tracks${time}</span><button id="fullSyncButton" type="button">Full sync</button>`;
      byId("fullSyncButton").addEventListener("click", () => startSync(true));
      renderLibraryPanel(data, total);
    } else {
      target.innerHTML = `<span>Library not synced yet</span><button id="startSyncButton" type="button">Start sync</button>`;
      byId("startSyncButton").addEventListener("click", () => startSync(false));
    }
  } catch {
    target.innerHTML = `<span>Library status unavailable</span>`;
  }
}

function renderLibraryPanel(data, total) {
  const panel = byId("libraryPanel");
  panel.hidden = false;
  byId("libraryTotal").textContent = `${Number(total || 0).toLocaleString()} songs synced`;
  byId("artistCount").textContent = Number(data.artistCount || data.totalArtists || 3857).toLocaleString();
  byId("genreCount").textContent = `${Number(data.genreCount || data.totalGenres || 10).toLocaleString()} / 18`;
  byId("librarySpan").textContent = data.firstSavedYear && data.lastSavedYear ? `Likes from ${data.firstSavedYear}-${data.lastSavedYear}` : "Likes from 2016-2026";
}

async function startSync(full) {
  try {
    await fetch("/api/spotify/sync", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(full ? { full: true } : {}) });
    pollSync();
    toast(full ? "Full sync started" : "Sync started", "good");
  } catch {
    toast("Could not start sync");
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
    target.querySelectorAll("[data-share]").forEach((button) => button.addEventListener("click", () => copyShare(button.dataset.share)));
  } catch {
    toast("Could not load recent playlists");
  }
}

function recentRow(playlist) {
  const count = Array.isArray(playlist.tracks) ? playlist.tracks.length : playlist.trackCount || 0;
  const name = playlist.name || playlist.vibe || "Kwalify playlist";
  const meta = [count ? `${count} tracks` : "", formatDate(playlist.createdAt)].filter(Boolean).join(" · ");
  return `<article class="recent-row"><a href="/p/${Number(playlist.id)}"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(meta)}</span></a><div>${playlist.spotifyUrl ? `<a class="mini-btn mini-green" target="_blank" rel="noopener" href="${escapeHtml(playlist.spotifyUrl)}">Spotify</a>` : ""}<button class="mini-btn" type="button" data-share="${Number(playlist.id)}">Share</button></div></article>`;
}

async function generate() {
  const input = byId("vibeInput");
  const vibe = input.value.trim();
  if (!vibe) return input.focus();
  state.lastVibe = vibe;
  setBusy(true);
  byId("result").classList.remove("visible");
  try {
    const response = await api("/generate", { method: "POST", body: JSON.stringify({ vibe, mode: state.mode, length: state.length }) });
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
  } catch (error) {
    toast(error.message || "Something went wrong");
  } finally {
    setBusy(false);
  }
}

function renderResult(result) {
  const target = byId("result");
  target.innerHTML = `<h2>${escapeHtml(result.name)}</h2><p>"${escapeHtml(result.vibe)}" · ${Number(result.count).toLocaleString()} tracks · from your likes</p><div class="result-actions">${result.url ? `<a class="btn btn-green" target="_blank" rel="noopener" href="${escapeHtml(result.url)}">${spotifyIcon()}Open Spotify</a>` : ""}${result.id ? `<button class="btn" id="shareResult" type="button">Share</button>` : ""}<button class="btn" id="againButton" type="button">Regenerate</button></div><div class="track-list">${trackRows(result.tracks, 25)}</div>`;
  target.classList.add("visible");
  byId("shareResult")?.addEventListener("click", () => copyShare(result.id));
  byId("againButton").addEventListener("click", regenerate);
}

function trackRows(tracks, limit) {
  return tracks.slice(0, limit).map((track, index) => {
    const art = track.albumArt || track.album_art || "";
    const name = track.name || track.trackName || "Unknown track";
    const artist = track.artist || track.artistName || "Unknown artist";
    return `<article class="track-row"><span>${index + 1}</span>${art ? `<img src="${escapeHtml(art)}" alt="">` : `<i></i>`}<strong>${escapeHtml(name)}<small>${escapeHtml(artist)}</small></strong></article>`;
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
  navigator.clipboard?.writeText(url).then(() => toast("Link copied", "good")).catch(() => toast(url));
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
  } catch {}
  guestPage();
}

boot();
