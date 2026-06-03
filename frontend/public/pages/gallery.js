// ── Kwalify Gallery ───────────────────────────────────────────────────────────
const root = document.getElementById("galleryRoot");

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

async function api(path, opts = {}) {
  const r = await fetch(`/api${path}`, { credentials: "include", ...opts });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch { return ""; }
}

function spotifyIconSvg() {
  return `<span class="spotify-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="#1db954"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg></span>`;
}

function getTagsFromPlaylist(p) {
  const tags = [];
  const ep = (p.emotionProfile || {});
  if (p.mode) tags.push(p.mode.charAt(0).toUpperCase() + p.mode.slice(1));
  if (ep.timeOfDay) tags.push(ep.timeOfDay);
  if (ep.environment) tags.push(ep.environment);
  if (ep.energy !== undefined) {
    if (ep.energy > 0.7) tags.push("high energy");
    else if (ep.energy < 0.4) tags.push("calm");
  }
  if (ep.valence !== undefined) {
    if (ep.valence > 0.7) tags.push("happy");
    else if (ep.valence < 0.35) tags.push("melancholic");
  }
  if (ep.nostalgia !== undefined && ep.nostalgia > 0.6) tags.push("nostalgic");
  return tags.slice(0, 4);
}

function getAlbumArts(p) {
  const tracks = Array.isArray(p.tracks) ? p.tracks : [];
  const arts = [];
  for (const t of tracks) {
    const art = t.albumArt || t.album_art;
    if (art && !arts.includes(art)) arts.push(art);
    if (arts.length >= 4) break;
  }
  return arts;
}

function renderArtMosaic(arts, name) {
  if (arts.length === 0) {
    return `<div class="gallery-card-art" style="display:flex;align-items:center;justify-content:center;">
      <div class="gallery-card-art-placeholder">🎵</div>
    </div>`;
  }
  const cells = [...arts, ...arts, ...arts, ...arts].slice(0, 4);
  return `<div class="gallery-card-art">
    ${cells.map((a) => `<img class="gallery-card-art-img" src="${esc(a)}" alt="" loading="lazy" onerror="this.style.background='#1a1a2c';this.style.display='none'">`).join("")}
  </div>`;
}

function renderCards(playlists) {
  if (!playlists.length) {
    return `<div class="error-state"><h2>No playlists yet</h2><p>Generate your first vibe to see it here.</p></div>`;
  }
  return `<div class="gallery-grid">${playlists.map((p) => {
    const arts = getAlbumArts(p);
    const tags = getTagsFromPlaylist(p);
    const trackCount = Array.isArray(p.tracks) ? p.tracks.length : (p.trackCount || 0);
    return `
    <div class="gallery-card">
      ${renderArtMosaic(arts, p.name)}
      <div class="gallery-card-body">
        <div class="gallery-card-name" title="${esc(p.name)}">${esc(p.name)}</div>
        ${tags.length ? `<div class="gallery-tags">${tags.map((t) => `<span class="gallery-tag">${esc(t)}</span>`).join("")}</div>` : ""}
        ${p.vibe ? `<div class="gallery-card-quote">"${esc(p.vibe)}"</div>` : ""}
        <div class="gallery-card-meta">${trackCount} tracks · ${formatDate(p.createdAt)}</div>
        <div class="gallery-card-actions">
          ${p.spotifyUrl ? `<a href="${esc(p.spotifyUrl)}" target="_blank" rel="noopener" class="btn btn-green btn-sm">${spotifyIconSvg()} Spotify</a>` : ""}
          <a href="/p/${p.id}" class="btn btn-ghost btn-sm">Share</a>
        </div>
      </div>
    </div>`;
  }).join("")}</div>`;
}

async function boot() {
  // Check auth
  const meRes = await api("/auth/me");
  if (meRes.status === 401 || !meRes.ok) {
    window.location.href = "/";
    return;
  }

  root.innerHTML = `
  <nav class="nav">
    <div class="nav-logo">
      <div class="nav-logo-badge">Y</div>
      <span>Kwalify</span>
    </div>
    <div class="nav-right">
      <a href="/" class="btn btn-ghost btn-sm">← Back to app</a>
    </div>
  </nav>
  <div class="loading-state"><div class="gen-spinner"></div><span>Loading…</span></div>
  `;

  const plRes = await api("/playlists");
  const playlists = plRes.ok ? (plRes.data.playlists || []) : [];

  root.innerHTML = `
  <nav class="nav">
    <div class="nav-logo">
      <div class="nav-logo-badge">Y</div>
      <span>Kwalify</span>
    </div>
    <div class="nav-right">
      <a href="/" class="btn btn-ghost btn-sm">← Back to app</a>
    </div>
  </nav>
  <div class="gallery-wrap">
    <h1 class="gallery-title">Recently generated vibes</h1>
    <p class="gallery-sub">Moments people turned into playlists — only songs they already loved on Spotify</p>
    ${renderCards(playlists)}
  </div>
  `;
}

boot();
