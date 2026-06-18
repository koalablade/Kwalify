// ── Kwalify · Playlist share page ────────────────────────────────────────────
import { esc, initTheme } from "../lib/shared.js";

initTheme();
const root = document.getElementById("playlistRoot");
const match = window.location.pathname.match(/\/p\/([^/]+)/);
const shareSlug = match ? decodeURIComponent(match[1]) : null;

async function api(path, opts = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  const { timeoutMs: _timeoutMs, ...fetchOpts } = opts;
  try {
    const r = await fetch(`/api${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      ...fetchOpts,
      signal: controller.signal,
    });
    return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
  } finally {
    clearTimeout(timeout);
  }
}

const feedbackSessionId = `share_${Date.now()}_${Math.random().toString(36).slice(2)}`;

function feedbackTrackPayload(track) {
  return {
    trackId: track?.trackId || track?.id,
    trackName: track?.trackName || track?.name || null,
    artistName: track?.artistName || track?.artist || null,
    albumName: track?.albumName || track?.album || null,
    genrePrimary: track?.genrePrimary || null,
    genreFamily: track?.genreFamily || null,
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

function setMetaContent(name, content, attr = "name") {
  if (!content) return;
  let el = document.querySelector(`meta[${attr}="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setCanonicalUrl(url) {
  let el = document.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", url);
}

function spi() {
  return `<span class="spi"><svg width="11" height="11" viewBox="0 0 24 24" fill="#1db954"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg></span>`;
}

function navHtml() {
  return `
  <nav class="nav">
    <a href="/" class="nav-logo" style="text-decoration:none;color:inherit;">
      <div class="nav-logo-mark">K</div>
      <span>Kwalify</span>
    </a>
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

function renderLoadError(message = "Could not load this playlist. Please refresh and try again.") {
  document.title = "Playlist unavailable — Kwalify";
  root.innerHTML = `
  ${navHtml()}
  <div class="not-found">
    <h2>Playlist unavailable</h2>
    <p>${esc(message)}</p>
    <button id="retryPlaylistBtn" class="btn btn-green" style="display:inline-flex;margin-top:20px;">Retry</button>
    <a href="/" class="btn btn-ghost" style="display:inline-flex;margin-top:20px;">Back to app</a>
  </div>`;
  document.getElementById("retryPlaylistBtn")?.addEventListener("click", boot);
}

function render(data) {
  const title = `${data.name || "Playlist"} — Kwalify`;
  document.title = title;
  const shareUrl = `${window.location.origin}${window.location.pathname}`;
  const firstArt = (Array.isArray(data.tracks) ? data.tracks[0] : null)?.albumArt
    || (Array.isArray(data.tracks) ? data.tracks[0] : null)?.album_art
    || "https://kwalify.net/og-image.svg";
  const ogImage = String(firstArt).startsWith("http") ? firstArt : "https://kwalify.net/og-image.svg";
  setCanonicalUrl(shareUrl);
  setMetaContent("description", data.vibe ? `${data.vibe} — ${data.trackCount || 0} tracks on Kwalify` : title);
  setMetaContent("og:title", data.name || "Kwalify playlist", "property");
  setMetaContent("og:description", data.vibe || "A moment-to-music playlist from liked songs on Spotify.", "property");
  setMetaContent("og:url", shareUrl, "property");
  setMetaContent("og:image", ogImage, "property");
  setMetaContent("twitter:card", "summary_large_image");
  setMetaContent("twitter:title", data.name || "Kwalify playlist");
  setMetaContent("twitter:description", data.vibe || "A Kwalify playlist from Spotify liked songs.");
  setMetaContent("twitter:image", ogImage);

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
      <button id="copyShareUrlBtn" class="btn btn-ghost">Copy page link</button>
      ${typeof navigator.share === "function" ? `<button id="nativeShareBtn" class="btn btn-ghost btn-sm" type="button">Share…</button>` : ""}
      <a href="/" class="btn btn-outline btn-sm">Generate yours — free</a>
    </div>
    <div class="playlist-vibe" style="margin-top:14px;">Want feedback controls and replacements? Sign in and generate your own version.</div>
    <div class="tracks-list">${tracksHtml}</div>
  </div>
  <footer class="app-footer site-footer">
    <div class="footer-left"><span class="footer-brand">© ${new Date().getFullYear()} Kwalify</span></div>
    <div class="footer-right">
      <a href="/privacy" class="footer-link">Privacy</a>
      <a href="/terms" class="footer-link">Terms</a>
      <a href="/" class="footer-link">Home</a>
    </div>
  </footer>`;

  document.getElementById("copyBtn")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(copyLines);
      const btn = document.getElementById("copyBtn");
      if (btn) {
        btn.textContent = "Copied!";
        setTimeout(() => { btn.textContent = "Copy tracklist"; }, 2000);
      }
    } catch {
      const btn = document.getElementById("copyBtn");
      if (btn) {
        btn.textContent = "Copy failed";
        setTimeout(() => { btn.textContent = "Copy tracklist"; }, 2000);
      }
    }
  });

  document.getElementById("copyShareUrlBtn")?.addEventListener("click", async () => {
    const url = `${window.location.origin}${window.location.pathname}`;
    try {
      await navigator.clipboard.writeText(url);
      const btn = document.getElementById("copyShareUrlBtn");
      if (btn) {
        btn.textContent = "Link copied!";
        setTimeout(() => { btn.textContent = "Copy page link"; }, 2000);
      }
    } catch {
      const btn = document.getElementById("copyShareUrlBtn");
      if (btn) {
        btn.textContent = "Copy failed";
        setTimeout(() => { btn.textContent = "Copy page link"; }, 2000);
      }
    }
  });

  document.getElementById("nativeShareBtn")?.addEventListener("click", async () => {
    try {
      await navigator.share({
        title: data.name || "Kwalify playlist",
        text: data.vibe || "A playlist from Kwalify",
        url: `${window.location.origin}${window.location.pathname}`,
      });
    } catch (err) {
      if (err?.name !== "AbortError") { /* ignore */ }
    }
  });

}

async function boot() {
  if (!shareSlug) { renderNotFound(); return; }

  root.innerHTML = navHtml() + `<div class="loading-shell"><div class="spinner"></div><span>Loading playlist…</span></div>`;

  try {
    const result = await api(`/share/${encodeURIComponent(shareSlug)}`, { timeoutMs: 20_000 });
    if (result.status === 404) { renderNotFound(); return; }
    if (!result.ok) { renderLoadError("The server could not load this playlist right now."); return; }
    render(result.data);
  } catch {
    renderLoadError("Network error while loading this playlist.");
  }
}

boot();
