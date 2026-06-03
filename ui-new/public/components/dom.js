export const byId = (id) => document.getElementById(id);

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[char]);
}

export function formatDate(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString([], {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

export function formatTime(value) {
  if (!value) return "";
  try {
    const raw = String(value);
    return new Date(raw.endsWith("Z") ? raw : `${raw}Z`).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function toast(message, type = "") {
  const zone = byId("toastZone");
  if (!zone) return;

  const node = document.createElement("div");
  node.className = `kw-toast${type ? ` kw-toast-${type}` : ""}`;
  node.textContent = message;
  zone.appendChild(node);
  window.setTimeout(() => node.remove(), 3600);
}

export function songRows(tracks, limit = 25) {
  return (tracks || []).slice(0, limit).map((track, index) => {
    const art = track.albumArt || track.album_art || "";
    const name = track.name || track.trackName || "Unknown track";
    const artist = track.artist || track.artistName || "Unknown artist";
    const artHtml = art
      ? `<img class="kw-art" src="${escapeHtml(art)}" alt="">`
      : `<span class="kw-art-fallback">Music</span>`;

    return `<div class="kw-song">
      <span class="kw-song-index">${index + 1}</span>
      ${artHtml}
      <span>
        <span class="kw-song-name">${escapeHtml(name)}</span>
        <span class="kw-song-artist">${escapeHtml(artist)}</span>
      </span>
    </div>`;
  }).join("");
}

export function moodTags(profile = {}) {
  const tags = [];
  if (profile.timeOfDay) tags.push(profile.timeOfDay);
  if (profile.environment) tags.push(profile.environment);
  if (profile.motionState) tags.push(profile.motionState);
  if (typeof profile.valence === "number") tags.push(profile.valence >= 0.56 ? "bright" : "moody");
  return tags.slice(0, 4);
}
