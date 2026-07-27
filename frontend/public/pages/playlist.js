// ── Kwalify · Playlist share page ────────────────────────────────────────────
import { esc, initTheme, showToast, apiJson, fmtDate } from "../lib/shared.js";
import { COPY } from "../lib/copy.js";
import { applyArtAccentToPoster } from "../lib/art-color.js";

initTheme();
const root = document.getElementById("playlistRoot");
const match = window.location.pathname.match(/\/p\/([^/]+)/);
const shareSlug = match ? decodeURIComponent(match[1]) : null;

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
    <a href="/" class="btn btn-cream" style="display:inline-flex;margin-top:20px;">Create yours</a>
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
  const tracks = Array.isArray(data.tracks) ? data.tracks : [];
  const count = data.trackCount || tracks.length;
  const title = `${data.name || "Playlist"} — Kwalify`;
  document.title = title;
  const shareUrl = `${window.location.origin}${window.location.pathname}`;
  const firstArt = tracks[0]?.albumArt
    || tracks[0]?.album_art
    || "https://kwalify.net/og-image.svg";
  const ogImage = String(firstArt).startsWith("http") ? firstArt : "https://kwalify.net/og-image.svg";
  setCanonicalUrl(shareUrl);
  setMetaContent("description", data.vibe ? `${data.vibe} — ${count} tracks on Kwalify` : title);
  setMetaContent("og:title", data.vibe ? `"${data.vibe}" — Kwalify` : (data.name || "Kwalify soundtrack"), "property");
  setMetaContent("og:description", data.vibe ? `A soundtrack built from favourite songs — ${count} tracks` : COPY.subhead, "property");
  setMetaContent("og:url", shareUrl, "property");
  setMetaContent("og:image", ogImage, "property");
  setMetaContent("twitter:card", "summary_large_image");
  setMetaContent("twitter:title", data.name || "Kwalify playlist");
  setMetaContent("twitter:description", data.vibe || "A Kwalify playlist from Spotify liked songs.");
  setMetaContent("twitter:image", ogImage);

  const artUrls = tracks.map((t) => t.albumArt || t.album_art).filter(Boolean).slice(0, 4);
  const backdropHtml = artUrls.length
    ? `<div class="art-backdrop" aria-hidden="true">${artUrls.map((url) => `<img src="${esc(url)}" alt="" class="art-backdrop-img" loading="lazy">`).join("")}</div>`
    : "";
  const storyLine = data.vibe || data.name || "A personal soundtrack";
  const ownerLine = data.ownerDisplayName
    ? `${esc(data.ownerDisplayName)} created a soundtrack for`
    : "A soundtrack for";

  const tracksHtml = tracks.map((t, i) => {
    const name = t.trackName || t.name || "Unknown";
    const artist = t.artistName || t.artist || "Unknown artist";
    const art = t.albumArt || t.album_art;
    const trackId = t.trackId || t.id || "";
    const why = Array.isArray(t.whyReasons) && t.whyReasons.length
      ? ` title="Why this song: ${esc(t.whyReasons.slice(0, 3).join(", "))}"`
      : "";
      return `
      <div class="track-row track-row--reveal share-track-row" data-track-id="${esc(trackId)}" style="--track-i:${i}"${why}>
        <span class="track-num">${i + 1}</span>
        <div class="track-art track-art--reveal">${art ? `<img src="${esc(art)}" alt="" loading="lazy">` : ""}</div>
      <div class="track-info">
        <div class="track-name">${esc(name)}</div>
        <div class="track-artist">${esc(artist)}</div>
      </div>
      <div class="track-actions share-track-actions">
        <button type="button" class="section-action share-react-btn" data-reaction="up" title="Good pick" aria-label="Thumbs up">♥</button>
        <button type="button" class="section-action share-react-btn" data-reaction="down" title="Not for me" aria-label="Thumbs down">↓</button>
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
  <div class="playlist-page playlist-page--story">
    <header class="share-poster result-poster" id="sharePoster">
      ${backdropHtml}
      <div class="result-poster-overlay"></div>
      <div class="result-poster-inner">
        <p class="result-poster-eyebrow">Shared soundtrack</p>
        <p class="share-poster-owner">${ownerLine}</p>
        <h1 class="result-poster-title share-poster-quote">"${esc(storyLine)}"</h1>
        <p class="result-poster-subtitle">Built from favourite songs · ${count} tracks</p>
        <div class="result-poster-actions playlist-actions">
          ${data.spotifyUrl ? `<a href="${esc(data.spotifyUrl)}" target="_blank" rel="noopener" class="btn btn-green btn-lg">${spi()} Play on Spotify</a>` : ""}
          ${typeof navigator.share === "function" ? `<button id="nativeShareBtn" class="btn btn-ghost btn-sm" type="button">Share…</button>` : ""}
          <button id="copyShareUrlBtn" class="btn btn-ghost btn-sm">Copy link</button>
          <a href="/api/auth/login" class="btn btn-cream btn-sm">Create yours</a>
        </div>
      </div>
    </header>
    <p class="share-rate-hint">Rate tracks below — <a href="/api/auth/login">sign in</a> to save taste preferences and build your own soundtracks.</p>
    <section class="track-reveal share-track-reveal">
      <div class="track-reveal-head">
        <h2 class="track-reveal-title">The soundtrack</h2>
        <span class="track-reveal-meta">${data.createdAt ? fmtDate(data.createdAt) : ""}</span>
      </div>
      <div class="tracks-list tracks-list--reveal">${tracksHtml}</div>
    </section>
    <div class="playlist-actions playlist-actions--footer">
      <button id="copyBtn" class="btn btn-ghost btn-sm">Copy tracklist</button>
    </div>
  </div>
  <footer class="app-footer site-footer">
    <div class="footer-left"><span class="footer-brand">© ${new Date().getFullYear()} Kwalify</span></div>
    <div class="footer-right">
      <a href="/privacy" class="footer-link">Privacy</a>
      <a href="/terms" class="footer-link">Terms</a>
      <a href="/" class="footer-link">Home</a>
    </div>
  </footer>`;

  void applyArtAccentToPoster(document.getElementById("sharePoster"), artUrls);

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
        setTimeout(() => { btn.textContent = "Copy link"; }, 2000);
      }
    } catch {
      const btn = document.getElementById("copyShareUrlBtn");
      if (btn) {
        btn.textContent = "Copy failed";
        setTimeout(() => { btn.textContent = "Copy link"; }, 2000);
      }
    }
  });

  document.querySelectorAll(".share-react-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest(".share-track-row");
      const trackId = row?.dataset?.trackId;
      const reaction = btn.dataset.reaction;
      if (!trackId || !reaction) return;
      btn.disabled = true;
      try {
        const result = await apiJson(`/share/${encodeURIComponent(shareSlug)}/track-react`, {
          method: "POST",
          body: JSON.stringify({ trackId, reaction }),
        });
        if (!result.ok) {
          showToast(result.data?.error || result.data?.message || "Could not save reaction. Try again.", "error");
          btn.disabled = false;
          return;
        }
        showToast("Thanks!", "success");
        row?.classList.add(reaction === "up" ? "share-track--up" : "share-track--down");
        btn.textContent = "✓";
      } catch (err) {
        showToast(err?.message || "Could not save reaction. Check your connection.", "error");
        btn.disabled = false;
      }
    });
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
    const result = await apiJson(`/share/${encodeURIComponent(shareSlug)}`, { timeoutMs: 20_000 });
    if (result.status === 404) { renderNotFound(); return; }
    if (!result.ok) { renderLoadError("The server could not load this playlist right now."); return; }
    render(result.data);
  } catch {
    renderLoadError("Network error while loading this playlist.");
  }
}

boot();
