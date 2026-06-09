// ── Kwalify · Playlist share page ────────────────────────────────────────────
const root = document.getElementById("playlistRoot");
const match = window.location.pathname.match(/\/p\/(\d+)/);
const playlistId = match ? match[1] : null;

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

async function api(path, opts = {}) {
  const r = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}

const feedbackSessionId = `share_${Date.now()}_${Math.random().toString(36).slice(2)}`;

function feedbackTrackPayload(track) {
  return {
    trackId: track?.trackId || track?.id,
    trackName: track?.trackName || track?.name || null,
    artistName: track?.artistName || track?.artist || null,
    albumName: track?.albumName || track?.album || null,
    genrePrimary: track?.genrePrimary || null,
    genres: Array.isArray(track?.genres) ? track.genres : null,
    energy: typeof track?.energy === "number" ? track.energy : null,
  };
}

async function sendFeedbackEvent(track, action, playlistId, context = {}) {
  const payloadTrack = feedbackTrackPayload(track);
  if (!payloadTrack.trackId) return;
  await api("/feedback/track", {
    method: "POST",
    body: JSON.stringify({
      trackId: payloadTrack.trackId,
      action,
      playlistId: String(playlistId || ""),
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

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch { return ""; }
}

function spi() {
  return `<span class="spi"><svg width="11" height="11" viewBox="0 0 24 24" fill="#1db954"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg></span>`;
}

function navHtml() {
  return `
  <nav class="nav">
    <div class="nav-logo">
      <div class="nav-logo-mark">K</div>
      <span>Kwalify</span>
    </div>
    <div class="nav-right">
      <a href="/" class="btn btn-ghost btn-sm">← Back</a>
    </div>
  </nav>`;
}

function renderNotFound() {
  document.title = "Not found — Kwalify";
  root.innerHTML = `
  ${navHtml()}
  <div class="not-found">
    <h2>Playlist not found</h2>
    <p>This link may be outdated or the playlist was removed.</p>
    <a href="/" class="btn btn-green" style="display:inline-flex;margin-top:20px;">Generate a new vibe</a>
  </div>`;
}

function render(data) {
  document.title = `${data.name || "Playlist"} — Kwalify`;

  const tracks = Array.isArray(data.tracks) ? data.tracks : [];
  const count = data.trackCount || tracks.length;

  const tracksHtml = tracks.map((t, i) => {
    const name = t.trackName || t.name || "Unknown";
    const artist = t.artistName || t.artist || "Unknown artist";
    const art = t.albumArt || t.album_art;
    const why = Array.isArray(t.whyReasons) && t.whyReasons.length
      ? ` title="Why this song: ${esc(t.whyReasons.slice(0, 3).join(", "))}"`
      : "";
    return `
    <div class="track-row"${why}>
      <span class="track-num">${i + 1}</span>
      <div class="track-art">${art ? `<img src="${esc(art)}" alt="" loading="lazy">` : ""}</div>
      <div class="track-info">
        <div class="track-name">${esc(name)}</div>
        <div class="track-artist">${esc(artist)}</div>
      </div>
      <div class="track-actions">
        <button class="section-action feedback-track-btn" data-action="skip" data-track-index="${i}" title="Skip this track" aria-label="Skip this track">⏭</button>
        <button class="section-action feedback-track-btn" data-action="remove" data-track-index="${i}" title="Remove from future playlists" aria-label="Remove from future playlists">−</button>
        <button class="section-action feedback-track-btn" data-action="replace" data-track-index="${i}" title="Replace with a nearby track" aria-label="Replace with a nearby track">↻</button>
        <button class="section-action feedback-track-btn" data-action="like" data-track-index="${i}" title="Like this track" aria-label="Like this track">♥</button>
        <button class="section-action feedback-track-btn" data-action="dislike" data-track-index="${i}" title="Thumbs down" aria-label="Thumbs down">↓</button>
        <button class="section-action feedback-track-btn undo-feedback-btn" data-action="undo" data-track-index="${i}" title="Undo last feedback" aria-label="Undo last feedback" style="display:none">Undo</button>
      </div>
    </div>`;
  }).join("");

  const copyLines = [
    data.name || "Kwalify Playlist",
    `${count} tracks`,
    data.spotifyUrl || "",
    ...tracks.map((t, i) => {
      const name = t.trackName || t.name || "Unknown";
      const artist = t.artistName || t.artist || "Unknown artist";
      return `${i + 1}. ${name} — ${artist}`;
    }),
  ].filter(Boolean).join("\n");

  root.innerHTML = `
  ${navHtml()}
  <div class="playlist-page">
    <h1 class="playlist-title">${esc(data.name || "Kwalify Playlist")}</h1>
    ${data.vibe ? `<div class="playlist-vibe">"${esc(data.vibe)}"</div>` : ""}
    <div class="playlist-meta">
      ${count} tracks${data.mode ? ` · ${data.mode.charAt(0).toUpperCase() + data.mode.slice(1)}` : ""}${data.createdAt ? ` · ${fmtDate(data.createdAt)}` : ""}
    </div>
    <div class="playlist-actions">
      ${data.spotifyUrl ? `<a href="${esc(data.spotifyUrl)}" target="_blank" rel="noopener" class="btn btn-green">${spi()} Open in Spotify</a>` : ""}
      <button id="copyBtn" class="btn btn-ghost">Copy tracklist</button>
      <a href="/" class="btn btn-outline btn-sm">Generate yours — free</a>
    </div>
    <div class="tracks-list">${tracksHtml}</div>
  </div>`;

  document.getElementById("copyBtn")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(copyLines);
      const btn = document.getElementById("copyBtn");
      if (btn) {
        btn.textContent = "Copied!";
        setTimeout(() => { btn.textContent = "Copy tracklist"; }, 2000);
      }
    } catch {}
  });

  document.querySelectorAll(".feedback-track-btn[data-track-index]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const index = Number(btn.dataset.trackIndex);
      const action = btn.dataset.action;
      const track = tracks[index];
      if (!track || !action) return;
      btn.disabled = true;
      const originalText = btn.textContent;
      btn.textContent = action === "like" ? "♥" : action === "replace" ? "…" : action === "undo" ? "Undo" : "✓";
      try {
        if (action === "undo") {
          await sendFeedbackEvent(track, "undo", data.id, { vibe: data.vibe || "" });
          btn.closest(".track-row")?.style.setProperty("opacity", "1");
          btn.style.display = "none";
          btn.disabled = false;
          return;
        }
        if (action === "replace") {
          const replacement = await replacePlaylistTrack(data.id, track, { vibe: data.vibe || "" });
          if (replacement) {
            data.tracks[index] = replacement;
            render(data);
          }
          return;
        }
        await sendFeedbackEvent(track, action, data.id, { vibe: data.vibe || "" });
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
}

async function boot() {
  if (!playlistId) { renderNotFound(); return; }

  root.innerHTML = navHtml() + `<div class="loading-shell"><div class="spinner"></div><span>Loading playlist…</span></div>`;

  try {
    const r = await fetch(`/api/share/${playlistId}`, { credentials: "include" });
    if (!r.ok) { renderNotFound(); return; }
    render(await r.json());
  } catch {
    renderNotFound();
  }
}

boot();
