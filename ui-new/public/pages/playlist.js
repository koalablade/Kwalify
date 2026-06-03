// Share page — enhanced with emotion bars, arc, narrative

const root = document.getElementById("playlistRoot");
const match = window.location.pathname.match(/\/p\/(\d+)/);
const playlistId = match ? match[1] : null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

const ARC_LABELS = {
  default:      "intro → build → peak → reflection",
  flat:         "steady throughout",
  recovery:     "heavy start → gradual warmth",
  linear_rise:  "steady lift ↗",
  linear_fall:  "gentle wind-down ↘",
  slow_burn:    "slow deepening",
  peak_release: "build → release",
  wave:         "ebb and flow",
};

function renderEmotionBars(ep) {
  if (!ep || typeof ep.energy !== "number") return "";
  const bars = [
    { label: "Energy",    value: ep.energy },
    { label: "Mood",      value: ep.valence },
    { label: "Nostalgia", value: ep.nostalgia },
    { label: "Calm",      value: ep.calm },
  ].filter((b) => typeof b.value === "number");
  if (!bars.length) return "";

  return `<div class="emotion-bars">${bars.map(({ label, value }) => `
    <div class="emotion-bar-row">
      <span class="emotion-bar-label">${label}</span>
      <div class="emotion-bar-track">
        <div class="emotion-bar-fill" style="width:${Math.round(value * 100)}%"></div>
      </div>
      <span class="emotion-bar-pct">${Math.round(value * 100)}%</span>
    </div>`).join("")}
  </div>`;
}

function notFound() {
  document.title = "Not Found - Kwalify";
  root.innerHTML = `
    <header class="site-header">
      <a href="/" class="site-logo">Kwalify</a>
      <nav><a href="/">Generate</a></nav>
    </header>
    <section>
      <h1>Playlist not found</h1>
      <p>This link may be old or the playlist was removed.</p>
      <a href="/" class="primary-btn">Generate a new one →</a>
    </section>`;
}

function render(data) {
  const tracks   = Array.isArray(data.tracks) ? data.tracks : [];
  const ep       = data.emotionProfile ?? {};
  const arc      = data.journeyArc || "";
  const arcLabel = ARC_LABELS[arc] || "";

  document.title = `${data.name || "Playlist"} - Kwalify`;

  const lines = [data.name || "Kwalify playlist"];
  if (data.spotifyUrl) lines.push(data.spotifyUrl);
  tracks.forEach((t, i) => {
    const n = t.trackName || t.name || "Unknown";
    const a = t.artistName || t.artist || "";
    lines.push(`${i + 1}. ${n}${a ? ` - ${a}` : ""}`);
  });
  const outputText = lines.join("\n");

  root.innerHTML = `
    <header class="site-header">
      <a href="/" class="site-logo">Kwalify</a>
      <nav><a href="/">Generate</a></nav>
    </header>

    <section>
      <h1>${escapeHtml(data.name || "Kwalify playlist")}</h1>
      ${data.vibe ? `<p class="narrative">"${escapeHtml(data.vibe)}"</p>` : ""}

      <div class="playlist-meta">
        <span>${tracks.length} tracks</span>
        ${arcLabel ? `<span class="arc-badge">${escapeHtml(arcLabel)}</span>` : ""}
      </div>

      ${renderEmotionBars(ep)}

      <div class="result-actions">
        ${data.spotifyUrl
          ? `<a href="${escapeHtml(data.spotifyUrl)}" target="_blank" rel="noopener" class="primary-btn spotify-btn">Open in Spotify ↗</a>`
          : ""}
        <button type="button" id="copyBtn">Copy list</button>
        <a href="/" class="link-btn">Generate one like this →</a>
      </div>

      <div class="track-list">
        ${tracks.map((t, i) => {
          const name   = escapeHtml(t.trackName || t.name || "Unknown track");
          const artist = escapeHtml(t.artistName || t.artist || "Unknown artist");
          return `
            <div class="track-card">
              <div class="track-number">${i + 1}</div>
              <div class="track-body">
                <div class="track-title">${name}</div>
                <div class="track-artist">${artist}</div>
              </div>
            </div>`;
        }).join("")}
      </div>
    </section>`;

  document.getElementById("copyBtn")?.addEventListener("click", () => {
    navigator.clipboard?.writeText(outputText).catch(() => {});
    const btn = document.getElementById("copyBtn");
    if (btn) { btn.textContent = "Copied!"; setTimeout(() => { btn.textContent = "Copy list"; }, 2000); }
  });
}

async function boot() {
  if (!playlistId) { notFound(); return; }
  try {
    const res = await fetch(`/api/share/${playlistId}`, { credentials: "include" });
    if (!res.ok) { notFound(); return; }
    render(await res.json());
  } catch {
    notFound();
  }
}

boot();
