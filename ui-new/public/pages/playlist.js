const root = document.getElementById("playlistRoot");
const match = window.location.pathname.match(/\/p\/(\d+)/);
const playlistId = match ? match[1] : null;
let currentOutput = "";

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
  return { ok: response.ok, status: response.status, data: await response.json().catch(() => ({})) };
}

function setMeta(data) {
  const title = `${data.name || "Playlist"} - Kwalify`;
  document.title = title;
}

function buildOutput(data, tracks) {
  const lines = [
    data.name || "Kwalify playlist",
    `${Number(data.trackCount || tracks.length || 0).toLocaleString()} tracks`,
  ];

  if (data.spotifyUrl) lines.push(data.spotifyUrl);

  tracks.forEach((track, index) => {
    const name = track.trackName || track.name || "Unknown track";
    const artist = track.artistName || track.artist || "Unknown artist";
    lines.push(`${index + 1}. ${name} - ${artist}`);
  });

  return lines.join("\n");
}

function notFound() {
  root.innerHTML = `<section>
    <h1>Playlist not found</h1>
    <p>This link may be old or the playlist was removed.</p>
    <p><a href="/">Generate Again</a></p>
  </section>`;
}

function render(data) {
  const tracks = Array.isArray(data.tracks) ? data.tracks : [];
  setMeta(data);
  currentOutput = buildOutput(data, tracks);
  root.innerHTML = `<section>
    <h1>${escapeHtml(data.name || "Kwalify playlist")}</h1>
    <h2>Generated Output</h2>
    <pre>${escapeHtml(currentOutput)}</pre>
    <button id="copyButton" type="button">Copy</button>
    <button id="againButton" type="button">Generate Again</button>
  </section>`;

  document.getElementById("copyButton").addEventListener("click", () => navigator.clipboard?.writeText(currentOutput));
  document.getElementById("againButton").addEventListener("click", () => {
    window.location.href = "/";
  });
}

async function boot() {
  if (!playlistId) {
    notFound();
    return;
  }
  try {
    const response = await rawJson(`/api/share/${playlistId}`);
    if (response.status === 404 || !response.ok) {
      notFound();
      return;
    }
    render(response.data);
  } catch {
    notFound();
  }
}

boot();
