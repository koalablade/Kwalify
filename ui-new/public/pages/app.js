import { api } from "../components/api.js";
import { byId, escapeHtml, formatDate, formatTime, songRows, toast } from "../components/dom.js";

const root = byId("root");

const state = {
  mode: "balanced",
  length: 40,
  busy: false,
  lastVibe: "",
  pollTimer: null,
};

const exampleVibes = [
  "late-night motorway drive",
  "sunny afternoon working on an old car",
  "songs that sound expensive",
  "end of summer but not sad",
  "music for wandering around London at midnight",
];

const quickVibes = [
  ["Night Drive", "night drive alone on the motorway"],
  ["Gym", "gym songs with focus and drive"],
  ["Chill", "soft chill songs for a slow afternoon"],
  ["Focus", "deep focus without vocals"],
  ["Summer", "end of summer but not sad"],
];

function brand(kind = "purple") {
  const green = kind === "green" ? " kw-brand-green" : "";
  return `<a class="kw-brand${green}" href="/">
    <span class="kw-mark">Y</span>
    <span>K<em>walify</em></span>
  </a>`;
}

function spotifyIcon() {
  return `<span class="kw-spotify" aria-hidden="true"></span>`;
}

function guestView() {
  root.innerHTML = `<div class="kw-wrap">
    <header class="kw-top">
      ${brand("green")}
      <a class="kw-btn kw-btn-green" href="/api/auth/login">${spotifyIcon()}Connect</a>
    </header>

    <section class="kw-hero kw-guest-hero">
      <h1 class="kw-title">Vibe DJ</h1>
      <p class="kw-subtitle">Type how you feel. A playlist from songs you already loved - not Discover Weekly.</p>
      <div class="kw-login-stack">
        <a class="kw-btn kw-btn-green" href="/api/auth/login">${spotifyIcon()}Connect with Spotify - free</a>
        <div class="kw-trust">Private playlists &middot; Your likes only</div>
      </div>
    </section>

    <section class="kw-plain-note" aria-label="How Kwalify works">
      Describe a moment. Kwalify scores your liked songs and creates a private playlist in Spotify.
    </section>
  </div>`;
}

function appView(user) {
  const name = user?.displayName || user?.name || user?.spotifyUserId || "You";
  const avatar = user?.image || user?.avatar || user?.profileImage || "";
  const userChip = avatar
    ? `<span class="kw-btn kw-btn-quiet"><img src="${escapeHtml(avatar)}" alt="" style="width:24px;height:24px;border-radius:50%;object-fit:cover">${escapeHtml(name)}</span>`
    : `<span class="kw-btn kw-btn-quiet">${escapeHtml(name)}</span>`;

  root.innerHTML = `<div class="kw-wrap kw-wrap-narrow">
    <header class="kw-top">
      ${brand("purple")}
      <nav class="kw-actions" aria-label="Account actions">
        ${userChip}
        <button class="kw-btn kw-btn-quiet" type="button" id="cacheButton">Cache</button>
        <a class="kw-btn kw-btn-quiet" href="/gallery">Gallery -></a>
        <button class="kw-btn kw-btn-quiet" type="button" id="logoutButton">Log out</button>
      </nav>
    </header>

    <section class="kw-hero">
      <div class="kw-eyebrow">Vibe DJ &middot; from your liked songs</div>
      <h1 class="kw-title">What's the vibe?</h1>
      <p class="kw-subtitle">Describe a moment - Kwalify builds a playlist from songs you already saved on Spotify.</p>
    </section>

    <section class="kw-status" id="syncStatus">Checking library...</section>

    <section class="kw-compose" aria-label="Generate playlist">
      <label class="kw-label" for="vibeInput">Describe your vibe</label>
      <div class="kw-compose-main">
        <span class="kw-input-shell">
          <input class="kw-input" id="vibeInput" maxlength="140" autocomplete="off" placeholder="Describe a moment...">
          <span class="kw-counter" id="vibeCounter">0/140</span>
        </span>
        <button class="kw-btn kw-btn-purple" type="button" id="generateButton">Describe</button>
      </div>
      <div class="kw-note">Only uses songs already in your Spotify liked songs.</div>

      <label class="kw-label" for="referenceInput">Sound like the playlist</label>
      <input class="kw-input" id="referenceInput" autocomplete="off" placeholder="Paste a public Spotify playlist link to act as the sonic direction...">

      <div class="kw-divider"></div>

      <div class="kw-presets">
        <span class="kw-mini-label">Try one of these</span>
        ${exampleVibes.map((vibe) => `<button class="kw-pill" type="button" data-vibe="${escapeHtml(vibe)}">${escapeHtml(vibe)}</button>`).join("")}
      </div>
      <div class="kw-presets">
        <span class="kw-mini-label">Quick</span>
        ${quickVibes.map(([label, vibe]) => `<button class="kw-pill" type="button" data-vibe="${escapeHtml(vibe)}">${escapeHtml(label)}</button>`).join("")}
      </div>

      <div class="kw-settings">
        <div>
          <div class="kw-label">Playlist length - <strong id="lengthText" style="color:var(--purple)">40 tracks</strong></div>
          <input class="kw-range" id="lengthInput" type="range" min="10" max="100" step="5" value="40">
        </div>
        <div>
          <div class="kw-label">Match mode</div>
          <div class="kw-mode-set">
            <button class="kw-mode" type="button" data-mode="strict">Strict</button>
            <button class="kw-mode is-picked" type="button" data-mode="balanced">Balanced</button>
            <button class="kw-mode" type="button" data-mode="chaotic">Chaotic</button>
          </div>
        </div>
      </div>
      <div class="kw-keys"><kbd>Enter</kbd> generate &middot; <kbd>Ctrl K</kbd> focus</div>
    </section>

    <section class="kw-working" id="working">
      <div class="kw-working-row"><span>Building from your liked songs...</span><span>AI scoring tracks</span></div>
      <div class="kw-progress"><span></span></div>
    </section>
    <section class="kw-result" id="result"></section>

    <section class="kw-history">
      <div class="kw-section-title">Your recent moods</div>
      <div class="kw-vibe-list" id="recentVibes"></div>
      <div class="kw-section-title" style="margin-top:18px">Recent playlists</div>
      <div class="kw-section-sub">Quick reopen here &middot; Gallery has every playlist</div>
      <div class="kw-playlist-list" id="recentPlaylists"></div>
      <a class="kw-gallery-link" href="/gallery">View all in Gallery -></a>
    </section>

    <footer class="kw-foot">Beta - <a href="mailto:feedback@kwalify.app">Send feedback</a></footer>
  </div>`;

  bindApp();
  updateInput();
  pollSync();
  state.pollTimer = window.setInterval(pollSync, 7000);
  loadRecent();
  byId("vibeInput")?.focus();
}

function bindApp() {
  byId("vibeInput").addEventListener("input", updateInput);
  byId("lengthInput").addEventListener("input", () => {
    state.length = Number(byId("lengthInput").value) || 40;
    byId("lengthText").textContent = `${state.length} tracks`;
  });
  byId("generateButton").addEventListener("click", generate);
  byId("cacheButton").addEventListener("click", () => pollSync(true));
  byId("logoutButton").addEventListener("click", logout);

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
      document.querySelectorAll("[data-mode]").forEach((node) => {
        node.classList.toggle("is-picked", node === button);
      });
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
      byId("vibeInput").select();
    }
  });
}

function updateInput() {
  const input = byId("vibeInput");
  const button = byId("generateButton");
  if (!input || !button) return;

  const count = input.value.length;
  byId("vibeCounter").textContent = `${count}/140`;

  if (!state.busy) {
    button.disabled = count === 0;
    button.textContent = count ? "Generate" : "Describe";
  }
}

function setBusy(value) {
  state.busy = value;
  byId("working").classList.toggle("is-visible", value);
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
      const syncedAt = data.lastSyncedAt ? ` - Last synced ${formatTime(data.lastSyncedAt)}` : "";
      target.innerHTML = `<span>Library ready - ${total.toLocaleString()} tracks${syncedAt}</span><button type="button" id="fullSyncButton">Full sync</button>`;
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
  try {
    const response = await api("/playlists");
    if (!response.ok) return;

    const playlists = Array.isArray(response.data.playlists) ? response.data.playlists : [];
    byId("recentVibes").innerHTML = playlists.slice(0, 5).map((playlist) => {
      const vibe = playlist.vibe || playlist.name || "sunny afternoon working on an old car";
      return `<div class="kw-vibe-line">"${escapeHtml(vibe)}"</div>`;
    }).join("");

    byId("recentPlaylists").innerHTML = playlists.slice(0, 5).map((playlist) => {
      const count = Array.isArray(playlist.tracks) ? playlist.tracks.length : playlist.trackCount || 0;
      const name = playlist.name || playlist.vibe || "Kwalify playlist";
      const meta = [count ? `${count} tracks` : "", formatDate(playlist.createdAt)].filter(Boolean).join(" - ");
      return `<div class="kw-playlist-line">
        <span>
          <span class="kw-list-name">${escapeHtml(name)}</span>
          <span class="kw-list-meta">${escapeHtml(meta)}</span>
        </span>
        <span class="kw-row-actions">
          ${playlist.spotifyUrl ? `<a class="kw-mini kw-mini-green" target="_blank" rel="noopener" href="${escapeHtml(playlist.spotifyUrl)}">Spotify</a>` : ""}
          <button class="kw-mini" type="button" data-share-id="${Number(playlist.id)}">Share</button>
          <a class="kw-mini" href="/p/${Number(playlist.id)}">Open</a>
        </span>
      </div>`;
    }).join("");

    document.querySelectorAll("[data-share-id]").forEach((button) => {
      button.addEventListener("click", () => copyShare(button.dataset.shareId));
    });
  } catch {
    toast("Could not load recent playlists", "bad");
  }
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
  byId("result").classList.remove("is-visible");

  try {
    const body = {
      vibe,
      mode: state.mode,
      length: state.length,
    };

    const reference = byId("referenceInput").value.trim();
    if (reference) body.referencePlaylist = reference;

    const response = await api("/generate", {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (response.status === 401) {
      window.location.href = "/api/auth/login";
      return;
    }

    if (!response.ok || response.data.error) {
      throw new Error(response.data.error || "Generation failed");
    }

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
    <div class="kw-result-meta">"${escapeHtml(result.vibe)}" - ${Number(result.count).toLocaleString()} tracks - from your likes</div>
    <div class="kw-result-actions" style="margin-bottom:15px">
      ${result.url ? `<a class="kw-btn kw-btn-green" target="_blank" rel="noopener" href="${escapeHtml(result.url)}">${spotifyIcon()}Open Spotify</a>` : ""}
      ${result.id ? `<button class="kw-btn kw-btn-quiet" type="button" id="shareResultButton">Share</button>` : ""}
      <button class="kw-btn kw-btn-quiet" type="button" id="againButton">Regenerate</button>
    </div>
    <div class="kw-song-list">${songRows(result.tracks, 25)}</div>`;

  target.classList.add("is-visible");
  byId("shareResultButton")?.addEventListener("click", () => copyShare(result.id));
  byId("againButton").addEventListener("click", regenerate);
  target.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
    const me = await api("/auth/me");
    if (me.ok) {
      appView(me.data.user || me.data);
      return;
    }
  } catch {
    // Fall through to guest state.
  }
  guestView();
}

boot();
