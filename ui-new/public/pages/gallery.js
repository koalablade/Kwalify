const root = document.getElementById("galleryRoot");

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

function toast(message) {
  const layer = document.getElementById("toastLayer");
  if (!layer) return;
  const node = document.createElement("div");
  node.className = "toast good";
  node.textContent = message;
  layer.appendChild(node);
  window.setTimeout(() => node.remove(), 3000);
}

function formatDate(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

function moodTags(profile = {}) {
  const tags = [];
  if (profile.timeOfDay) tags.push(String(profile.timeOfDay).replace(/_/g, " "));
  if (profile.environment) tags.push(String(profile.environment).replace(/_/g, " "));
  if (profile.journeyArc) tags.push(String(profile.journeyArc).replace(/_/g, " "));
  if (typeof profile.calm === "number" && profile.calm >= 0.6) tags.push("calm");
  return tags.slice(0, 4);
}

function artGrid(tracks) {
  const images = (tracks || [])
    .map((track) => track.albumArt || track.album_art || "")
    .filter(Boolean)
    .slice(0, 4);

  if (!images.length) return `<div class="cover-empty">♪</div>`;
  return `<div class="cover-grid">${images.map((src) => `<img src="${escapeHtml(src)}" alt="">`).join("")}</div>`;
}

function playlistCard(playlist) {
  const tracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];
  const tags = moodTags(playlist.emotionProfile);
  const count = playlist.trackCount || tracks.length || 0;
  const name = playlist.name || playlist.vibe || "Kwalify playlist";
  const meta = [count ? `${count} tracks` : "", formatDate(playlist.createdAt)].filter(Boolean).join(" · ");

  return `<article class="gallery-card" data-open="${Number(playlist.id)}">
    ${artGrid(tracks)}
    <div class="gallery-card-body">
      <h2>${escapeHtml(name)}</h2>
      ${tags.length ? `<div class="tag-row">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
      ${playlist.vibe ? `<p>"${escapeHtml(playlist.vibe)}"</p>` : ""}
      <small>${escapeHtml(meta)}</small>
      <div class="gallery-actions">
        ${playlist.spotifyUrl ? `<a class="mini-button green" href="${escapeHtml(playlist.spotifyUrl)}" target="_blank" rel="noopener" data-stop>Spotify</a>` : ""}
        <button class="mini-button" type="button" data-share="${Number(playlist.id)}">Share</button>
      </div>
    </div>
  </article>`;
}

function render(playlists) {
  if (!playlists.length) {
    root.innerHTML = `<section class="empty-state">
      <h2>No playlists yet</h2>
      <p>Generate your first playlist from the app - it will appear here.</p>
      <a class="button button-green" href="/">Generate a playlist</a>
    </section>`;
    return;
  }

  root.innerHTML = `<div class="gallery-grid">${playlists.map(playlistCard).join("")}</div>`;

  root.querySelectorAll("[data-open]").forEach((node) => {
    node.addEventListener("click", () => {
      window.location.href = `/p/${node.dataset.open}`;
    });
  });
  root.querySelectorAll("[data-stop]").forEach((node) => {
    node.addEventListener("click", (event) => event.stopPropagation());
  });
  root.querySelectorAll("[data-share]").forEach((node) => {
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      share(node.dataset.share);
    });
  });
}

function renderLogin() {
  root.innerHTML = `<section class="empty-state">
    <h2>Log in to see your gallery</h2>
    <p>Connect your Spotify account to view every generated playlist.</p>
    <a class="button button-green" href="/api/auth/login"><span class="spotify-dot"></span>Connect with Spotify</a>
  </section>`;
}

function share(id) {
  const url = `${window.location.origin}/p/${id}`;
  navigator.clipboard?.writeText(url)
    .then(() => toast("Link copied"))
    .catch(() => toast(url));
}

async function boot() {
  try {
    const response = await api("/playlists");
    if (response.status === 401) {
      renderLogin();
      return;
    }
    if (!response.ok) throw new Error("Could not load gallery");
    render(Array.isArray(response.data.playlists) ? response.data.playlists : []);
  } catch (error) {
    root.innerHTML = `<section class="empty-state">
      <h2>Could not load gallery</h2>
      <p>${escapeHtml(error.message || "Something went wrong.")}</p>
      <a class="button button-dark" href="/">Back to app</a>
    </section>`;
  }
}

boot();
