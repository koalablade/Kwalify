const root = document.getElementById("appRoot");
const state = {
  lastPlaylistUrl: "",
  lastOutput: "",
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[char]);
}

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  return { ok: response.ok, status: response.status, data: await response.json().catch(() => ({})) };
}

function renderForm(message = "") {
  root.innerHTML = `<section>
    <h1>Kwalify</h1>
    <form id="generateForm">
      <label for="playlistUrl">Spotify playlist URL</label>
      <input id="playlistUrl" name="playlistUrl" type="url" autocomplete="off" required value="${escapeHtml(state.lastPlaylistUrl)}">
      <button type="submit">Generate</button>
    </form>
    ${message ? `<p role="alert">${escapeHtml(message)}</p>` : ""}
  </section>`;

  document.getElementById("generateForm").addEventListener("submit", generate);
}

function renderLoading() {
  root.innerHTML = "<p>Generating...</p>";
}

async function generate(event) {
  event.preventDefault();
  const playlistUrl = String(new FormData(event.currentTarget).get("playlistUrl") || "").trim();
  if (!playlistUrl) return;

  state.lastPlaylistUrl = playlistUrl;
  renderLoading();

  try {
    const response = await api("/generate", {
      method: "POST",
      body: JSON.stringify({
        vibe: "balanced playlist based on a Spotify reference playlist",
        referencePlaylist: playlistUrl,
        mode: "balanced",
        length: 25,
      }),
    });

    if (response.status === 401) {
      window.location.href = "/api/auth/login";
      return;
    }

    if (!response.ok || response.data.error) throw new Error(response.data.error || "Generation failed");
    const tracks = Array.isArray(response.data.tracks) ? response.data.tracks : [];
    renderResult({
      id: response.data.playlistId,
      name: response.data.playlistName || response.data.name || "Kwalify playlist",
      tracks,
      count: response.data.count || response.data.totalTracks || tracks.length,
      url: response.data.spotifyPlaylistUrl || response.data.playlistUrl || "",
    });
  } catch (error) {
    renderForm(error.message || "Generation failed.");
  }
}

function renderResult(result) {
  const output = buildOutput(result);
  state.lastOutput = output;
  root.innerHTML = `<section>
    <h1>${escapeHtml(result.name)}</h1>
    <h2>Generated Output</h2>
    <pre id="generatedOutput">${escapeHtml(output)}</pre>
    <button id="copyButton" type="button">Copy</button>
    <button id="againButton" type="button">Generate Again</button>
  </section>`;

  document.getElementById("copyButton").addEventListener("click", copyOutput);
  document.getElementById("againButton").addEventListener("click", () => renderForm());
}

function buildOutput(result) {
  const lines = [
    result.name,
    `${Number(result.count || 0).toLocaleString()} tracks`,
  ];

  if (result.url) lines.push(result.url);

  result.tracks.forEach((track, index) => {
    const name = track.name || track.trackName || "Unknown track";
    const artist = track.artist || track.artistName || "Unknown artist";
    lines.push(`${index + 1}. ${name} - ${artist}`);
  });

  return lines.join("\n");
}

async function copyOutput() {
  await navigator.clipboard?.writeText(state.lastOutput);
}

renderForm();
