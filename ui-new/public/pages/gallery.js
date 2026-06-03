// Gallery page — quick win #3

const root = document.getElementById("galleryRoot");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

async function api(path) {
  const res = await fetch(`/api${path}`, { credentials: "include" });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });
}

function emotionSummary(ep) {
  if (!ep || typeof ep.valence !== "number") return "";
  const tags = [];
  if (ep.valence   >= 0.65) tags.push("uplifting");
  else if (ep.valence <= 0.38) tags.push("melancholic");
  if (ep.energy    >= 0.65) tags.push("energetic");
  else if (ep.energy <= 0.38) tags.push("calm");
  if ((ep.nostalgia ?? 0) >= 0.55) tags.push("nostalgic");
  return tags.slice(0, 2).join(" · ");
}

function renderCard(p) {
  const ep         = p.emotionProfile ?? {};
  const tag        = emotionSummary(ep);
  const trackCount = Array.isArray(p.tracks) ? p.tracks.length : 0;
  const modeLabel  = { strict: "Focused", balanced: "Balanced", chaotic: "Exploratory" }[p.mode] || p.mode || "";

  return `
    <div class="playlist-card">
      <div class="playlist-card-name">${escapeHtml(p.name)}</div>
      ${p.vibe ? `<div class="playlist-card-vibe">"${escapeHtml(p.vibe)}"</div>` : ""}
      <div class="playlist-card-meta">
        ${[
          trackCount ? `${trackCount} tracks` : "",
          modeLabel  ? modeLabel  : "",
          tag        ? tag        : "",
          p.createdAt ? formatDate(p.createdAt) : "",
        ].filter(Boolean).join(" · ")}
      </div>
      <div class="playlist-card-actions">
        <a href="/p/${p.id}">View →</a>
        ${p.spotifyUrl ? `<a href="${escapeHtml(p.spotifyUrl)}" target="_blank" rel="noopener" class="spotify-link">Spotify ↗</a>` : ""}
      </div>
    </div>`;
}

async function boot() {
  const authResp = await api("/auth/me");

  if (!authResp.ok) {
    root.innerHTML = `
      <header class="site-header">
        <a href="/" class="site-logo">Kwalify</a>
        <nav><a href="/">Generate</a></nav>
      </header>
      <p>Please <a href="/api/auth/login">connect Spotify</a> to see your playlists.</p>`;
    return;
  }

  const user = authResp.data;
  const resp = await api("/playlists");

  if (!resp.ok) {
    root.innerHTML = `
      <header class="site-header">
        <a href="/" class="site-logo">Kwalify</a>
      </header>
      <p>Could not load playlists. <a href="/">Go back</a></p>`;
    return;
  }

  const playlists = resp.data.playlists ?? [];
  document.title  = "Your Playlists - Kwalify";

  root.innerHTML = `
    <header class="site-header">
      <a href="/" class="site-logo">Kwalify</a>
      <nav>
        <a href="/">Generate</a>
        <span style="color:#aaa">Hi ${escapeHtml(user.displayName || "")}</span>
      </nav>
    </header>

    <h1>Your playlists</h1>
    <p class="gallery-sub">
      ${playlists.length === 0
        ? "No playlists yet."
        : `${playlists.length} ${playlists.length === 1 ? "playlist" : "playlists"} generated`}
    </p>

    ${playlists.length === 0
      ? `<a href="/" class="primary-btn">Generate your first playlist →</a>`
      : `<div class="gallery-grid">${playlists.map(renderCard).join("")}</div>`}`;
}

boot();
