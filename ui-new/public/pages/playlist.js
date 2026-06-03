const root = document.getElementById("playlistRoot");
const match = window.location.pathname.match(/\/p\/(\d+)/);
const playlistId = match ? match[1] : null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[char]);
}

async function rawJson(path) {
  const response = await fetch(path, { credentials: "include" });
  return {
    ok: response.ok,
    status: response.status,
    data: await response.json().catch(() => ({})),
  };
}

function spotifyIcon() {
  return `<span class="spotify-dot" aria-hidden="true"></span>`;
}

function setMeta(data, tracks) {
  const title = `${data.name || "Playlist"} - Kwalify`;
  const description = data.vibe
    ? `"${data.vibe}" - from Spotify liked songs only.`
    : "A Spotify playlist built from songs you already love.";
  const art = tracks.find((track) => track.albumArt || track.album_art);

  document.title = title;
  document.querySelector('meta[property="og:title"]')?.setAttribute("content", title);
  document.querySelector('meta[property="og:description"]')?.setAttribute("content", description);
  if (art) document.getElementById("ogImage")?.setAttribute("content", art.albumArt || art.album_art);
}

function trackRows(tracks) {
  return tracks.map((track, index) => {
    const art = track.albumArt || track.album_art || "";
    const name = track.trackName || track.name || "Unknown track";
    const artist = track.artistName || track.artist || "Unknown artist";
    const id = track.trackId || track.track_id || track.id || "";
    return `<article class="track-row">
      <span>${index + 1}</span>
      ${art ? `<img src="${escapeHtml(art)}" alt="">` : `<i></i>`}
      <strong>${escapeHtml(name)}<small>${escapeHtml(artist)}</small></strong>
      ${id ? `<a href="https://open.spotify.com/track/${escapeHtml(id)}" target="_blank" rel="noopener">Play</a>` : ""}
    </article>`;
  }).join("");
}

function renderNotFound() {
  root.innerHTML = `<section class="empty-state">
    <h1>Playlist not found</h1>
    <p>This link may be old or the playlist was removed.</p>
    <a class="button button-dark" href="/">Back to Kwalify</a>
  </section>`;
}

function renderPlaylist(data) {
  const tracks = Array.isArray(data.tracks) ? data.tracks : [];
  const count = data.trackCount || tracks.length || 0;
  setMeta(data, tracks);

  root.innerHTML = `<section class="share-page">
    <div class="hero-pill">Kwalify playlist</div>
    <h1>${escapeHtml(data.name || "Kwalify playlist")}</h1>
    ${data.vibe ? `<blockquote>"${escapeHtml(data.vibe)}"</blockquote>` : ""}
    <p>${Number(count).toLocaleString()} tracks · liked songs only</p>
    <div class="result-actions">
      ${data.spotifyUrl ? `<a class="button button-green" target="_blank" rel="noopener" href="${escapeHtml(data.spotifyUrl)}">${spotifyIcon()}Open Spotify</a>` : ""}
      <a class="button button-dark" href="/api/auth/login">Make your own</a>
    </div>
  </section>
  ${tracks.length ? `<section class="track-block">
    <div class="section-title">Tracks</div>
    <div class="track-list">${trackRows(tracks)}</div>
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
