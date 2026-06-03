import { api } from "../components/api.js";
import { byId, escapeHtml, formatDate, moodTags, toast } from "../components/dom.js";

function coverHtml(tracks) {
  const images = (tracks || [])
    .map((track) => track.albumArt || track.album_art || "")
    .filter(Boolean)
    .slice(0, 4);

  if (images.length > 1) {
    return `<div class="kw-cover-grid">${images.map((src) => `<img src="${escapeHtml(src)}" alt="">`).join("")}</div>`;
  }

  if (images.length === 1) {
    return `<div class="kw-cover-single"><img src="${escapeHtml(images[0])}" alt=""></div>`;
  }

  return `<div class="kw-cover-single">Music</div>`;
}

function releaseHtml(playlist) {
  const tracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];
  const tags = moodTags(playlist.emotionProfile);
  const count = playlist.trackCount || tracks.length || 0;
  const date = formatDate(playlist.createdAt);
  const meta = [count ? `${count} tracks` : "", date].filter(Boolean).join(" - ");
  const name = playlist.name || playlist.vibe || "Kwalify playlist";

  return `<article class="kw-release" data-open="${Number(playlist.id)}">
    ${coverHtml(tracks)}
    <div class="kw-release-body">
      <div class="kw-list-name">${escapeHtml(name)}</div>
      ${tags.length ? `<div class="kw-tags">${tags.map((tag) => `<span class="kw-tag">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
      ${playlist.vibe ? `<div class="kw-list-vibe">"${escapeHtml(playlist.vibe)}"</div>` : ""}
      <div class="kw-list-meta">${escapeHtml(meta)}</div>
    </div>
    <div class="kw-release-actions">
      ${playlist.spotifyUrl ? `<a class="kw-mini kw-mini-green" href="${escapeHtml(playlist.spotifyUrl)}" target="_blank" rel="noopener" data-stop>Spotify</a>` : ""}
      <button class="kw-mini" type="button" data-share="${Number(playlist.id)}">Share</button>
    </div>
  </article>`;
}

function render(playlists) {
  const root = byId("galleryRoot");

  if (!playlists.length) {
    root.innerHTML = `<section class="kw-empty">
      <div class="kw-empty-icon">Music</div>
      <h2>No playlists yet</h2>
      <p>Generate your first playlist from the app and it will appear here.</p>
      <a class="kw-btn kw-btn-green" href="/">Generate a playlist</a>
    </section>`;
    return;
  }

  root.innerHTML = `<div class="kw-gallery">${playlists.map(releaseHtml).join("")}</div>`;

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
  byId("galleryRoot").innerHTML = `<section class="kw-empty">
    <div class="kw-empty-icon">Music</div>
    <h2>Log in to see your gallery</h2>
    <p>Connect your Spotify account to view every playlist generated with Kwalify.</p>
    <a class="kw-btn kw-btn-green" href="/api/auth/login"><span class="kw-spotify"></span>Connect with Spotify</a>
  </section>`;
}

function share(id) {
  const url = `${window.location.origin}/p/${id}`;
  navigator.clipboard?.writeText(url)
    .then(() => toast("Link copied", "good"))
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
    byId("galleryRoot").innerHTML = `<section class="kw-empty">
      <div class="kw-empty-icon">!</div>
      <h2>Could not load gallery</h2>
      <p>${escapeHtml(error.message || "Something went wrong. Please try again.")}</p>
      <a class="kw-btn kw-btn-quiet" href="/">Back to app</a>
    </section>`;
  }
}

boot();
