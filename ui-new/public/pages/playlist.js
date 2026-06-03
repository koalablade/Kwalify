import { rawJson } from "../components/api.js";
import { byId, escapeHtml, moodTags, songRows } from "../components/dom.js";

const match = window.location.pathname.match(/\/p\/(\d+)/);
const playlistId = match ? match[1] : null;

function spotifyIcon() {
  return `<span class="kw-spotify" aria-hidden="true"></span>`;
}

function setMeta(data, tracks) {
  const title = `${data.name || "Playlist"} - Kwalify`;
  const description = data.vibe
    ? `"${data.vibe}" - from Spotify liked songs only.`
    : "A Spotify playlist built from songs you already love.";
  const imageTrack = tracks.find((track) => track.albumArt || track.album_art);
  const image = imageTrack ? imageTrack.albumArt || imageTrack.album_art : "";

  document.title = title;
  document.querySelector('meta[property="og:title"]')?.setAttribute("content", title);
  document.querySelector('meta[property="og:description"]')?.setAttribute("content", description);
  if (image) byId("ogImage")?.setAttribute("content", image);
}

function renderNotFound() {
  byId("playlistRoot").innerHTML = `<section class="kw-empty">
    <div class="kw-empty-icon">Music</div>
    <h2>Playlist not found</h2>
    <p>This link may be old or the playlist was removed.</p>
    <a class="kw-btn kw-btn-quiet" href="/">&lt;- Back to Kwalify</a>
  </section>`;
}

function renderPlaylist(data) {
  const tracks = Array.isArray(data.tracks) ? data.tracks : [];
  const profile = data.emotionProfile || {};
  const tags = moodTags(profile);
  const count = data.trackCount || tracks.length;

  setMeta(data, tracks);

  byId("playlistRoot").innerHTML = `<section class="kw-share-hero">
    ${tags.length ? `<div class="kw-tags">${tags.map((tag) => `<span class="kw-tag">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
    <h1 class="kw-share-title">${escapeHtml(data.name || "Kwalify playlist")}</h1>
    ${data.vibe ? `<div class="kw-share-prompt"><span>Vibe</span><strong>"${escapeHtml(data.vibe)}"</strong></div>` : ""}
    <div class="kw-result-meta">${Number(count || 0).toLocaleString()} tracks - liked songs only</div>
    <div class="kw-result-actions">
      ${data.spotifyUrl ? `<a class="kw-btn kw-btn-green" target="_blank" rel="noopener" href="${escapeHtml(data.spotifyUrl)}">${spotifyIcon()}Open Spotify</a>` : ""}
      <a class="kw-btn kw-btn-quiet" href="/api/auth/login">Make your own on Kwalify</a>
    </div>
  </section>

  ${tracks.length ? `<section class="kw-track-block">
    <div class="kw-section-title" style="margin-bottom:12px">Tracks</div>
    <div class="kw-song-list">${songRows(tracks, tracks.length)}</div>
  </section>` : ""}`;
}

async function boot() {
  if (!playlistId) {
    renderNotFound();
    return;
  }

  try {
    const response = await rawJson(`/api/share/${playlistId}`);
    if (response.status === 404 || !response.ok) {
      renderNotFound();
      return;
    }
    renderPlaylist(response.data);
  } catch {
    renderNotFound();
  }
}

boot();
