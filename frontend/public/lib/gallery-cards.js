/** Shared gallery / home memory card helpers */

export function moodEmoji(vibe, mode) {
  const v = String(vibe || "").toLowerCase();
  if (/rain|storm|wet/.test(v)) return "🌧";
  if (/drive|road|motorway|highway|car/.test(v)) return "🚗";
  if (/summer|sun|warm|beach/.test(v)) return "🌅";
  if (/goodbye|heart|break|alone|miss/.test(v)) return "💔";
  if (/child|nostalg|remember|memory|school/.test(v)) return "🎮";
  if (/night|midnight|2am|late/.test(v)) return "🌙";
  if (mode === "chaotic") return "✨";
  if (mode === "strict") return "🎯";
  return "🎵";
}

export function moodLabel(vibe, mode) {
  const v = String(vibe || "").toLowerCase();
  if (/calm|peace|quiet|slow/.test(v)) return "Reflective";
  if (/drive|road|freedom|open/.test(v)) return "Freedom";
  if (/party|energy|upbeat|dance/.test(v)) return "Energetic";
  if (/sad|melanch|rain/.test(v)) return "Melancholy";
  if (mode === "chaotic") return "Adventurous";
  if (mode === "strict") return "Focused";
  return "Personal";
}

export function getPlaylistArts(p) {
  const tracks = Array.isArray(p.tracks) ? p.tracks : [];
  const arts = [];
  for (const t of tracks) {
    const art = t.albumArt || t.album_art;
    if (art && !arts.includes(art)) arts.push(art);
    if (arts.length >= 4) break;
  }
  return arts;
}

export function mosaicHtml(arts, escFn) {
  if (arts.length === 0) {
    return `<div class="gallery-card-mosaic"><div class="mosaic-empty">🎵</div></div>`;
  }
  const cells = [...arts, ...arts, ...arts, ...arts].slice(0, 4);
  return `<div class="gallery-card-mosaic">
    ${cells.map((a) => `<img class="mosaic-img" src="${escFn(a)}" alt="" loading="lazy">`).join("")}
  </div>`;
}

/** Meteorological life chapters — Winter uses the year containing January. */
export function seasonalLifeChapterLabel(iso) {
  if (!iso) return "Earlier";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Earlier";
  const month = d.getMonth();
  const year = d.getFullYear();
  if (month === 11) return `Winter ${year + 1}`;
  if (month <= 1) return `Winter ${year}`;
  if (month <= 4) return `Spring ${year}`;
  if (month <= 7) return `Summer ${year}`;
  return `Autumn ${year}`;
}

export function chapterMomentSubcopy(count, chapterLabel) {
  const season = String(chapterLabel || "").split(" ")[0]?.toLowerCase() || "this chapter";
  if (count === 1) return `One moment this ${season}`;
  return `${count} moments this ${season}`;
}

export function renderMemoryCard(p, { escFn, fmtDateFn, spiFn, deleteMode = false, selected = false, showDebugNote = false, generatorNoteFn = null }) {
  const arts = getPlaylistArts(p);
  const count = Array.isArray(p.tracks) ? p.tracks.length : (p.trackCount || 0);
  const openHref = !deleteMode && p.shareSlug ? `/p/${encodeURIComponent(p.shareSlug)}` : null;
  const cardClass = `gallery-card memory-card ${deleteMode ? "gallery-card--selectable" : ""} ${openHref ? "gallery-card--link" : ""} ${selected ? "selected" : ""}`.trim();
  const cardAttrs = deleteMode
    ? `data-select-playlist-id="${p.id}" role="button" tabindex="0"`
    : "";
  const note = showDebugNote && generatorNoteFn ? generatorNoteFn(p) : "";
  const inner = `
    ${deleteMode ? `<div class="gallery-select-check">${selected ? "✓" : ""}</div>` : ""}
    ${mosaicHtml(arts, escFn)}
    <div class="gallery-card-body memory-card-body">
      <div class="memory-card-emoji" aria-hidden="true">${moodEmoji(p.vibe, p.mode)}</div>
      <div class="memory-card-title" title="${escFn(p.vibe || p.name)}">${escFn(p.vibe ? (p.vibe.length > 56 ? `${p.vibe.slice(0, 53)}…` : p.vibe) : p.name)}</div>
      ${!p.vibe && p.name ? `<div class="gallery-card-name gallery-card-name--sub">${escFn(p.name)}</div>` : ""}
      <div class="memory-card-mood">${escFn(moodLabel(p.vibe, p.mode))}</div>
      ${note ? `<div class="gallery-generator-note">${escFn(note)}</div>` : ""}
      <div class="gallery-card-meta memory-card-meta">${count} songs · ${fmtDateFn(p.createdAt)}</div>
      ${deleteMode ? "" : `<div class="gallery-card-actions">
        ${p.spotifyUrl ? `<a href="${escFn(p.spotifyUrl)}" target="_blank" rel="noopener" class="btn btn-green btn-sm" onclick="event.stopPropagation()">${spiFn()} Spotify</a>` : ""}
        ${openHref ? `<span class="btn btn-ghost btn-sm">Open</span>` : ""}
      </div>`}
    </div>`;
  if (openHref && !deleteMode) {
    return `<a class="${cardClass}" href="${escFn(openHref)}">${inner}</a>`;
  }
  return `<div class="${cardClass}" ${cardAttrs}>${inner}</div>`;
}

export function renderResultMemoryCard(p, { escFn }) {
  const arts = getPlaylistArts(p);
  const art = arts[0] || "";
  const label = p.vibe
    ? (p.vibe.length > 42 ? `${p.vibe.slice(0, 39)}…` : p.vibe)
    : (p.name || "A moment");
  const openHref = p.shareSlug ? `/p/${encodeURIComponent(p.shareSlug)}` : null;
  const inner = `
    <div class="result-memory-card-art"${art ? ` style="background-image:url('${escFn(art)}')"` : ""}></div>
    <div class="result-memory-card-body">
      <div class="result-memory-card-title">${escFn(label)}</div>
      <div class="result-memory-card-mood">${escFn(moodLabel(p.vibe, p.mode))}</div>
    </div>`;
  if (openHref) {
    return `<a class="result-memory-card" href="${escFn(openHref)}">${inner}</a>`;
  }
  return `<div class="result-memory-card">${inner}</div>`;
}

export function buildHomeFeaturedPosterHtml(playlist, { escFn, fmtDateFn, spiFn }) {
  if (!playlist) return "";
  const arts = getPlaylistArts(playlist);
  const art = arts[0] || "";
  const count = Array.isArray(playlist.tracks) ? playlist.tracks.length : (playlist.trackCount || 0);
  const prompt = playlist.vibe || playlist.name || "Your latest soundtrack";
  const titleLines = (() => {
    const words = String(prompt).trim().split(/\s+/).filter(Boolean);
    if (words.length >= 4) {
      const mid = Math.ceil(words.length / 2);
      return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
    }
    return [prompt];
  })();
  const openHref = playlist.shareSlug ? `/p/${encodeURIComponent(playlist.shareSlug)}` : null;
  return `<section class="home-featured" aria-label="Latest soundtrack">
    <div class="home-featured-inner">
      <header class="result-poster result-poster--album home-featured-poster" data-home-poster>
        ${art ? `<div class="art-backdrop art-backdrop--cinematic" style="background-image:url('${escFn(art)}')"></div>` : ""}
        <div class="result-poster-content">
          <p class="result-poster-eyebrow">${escFn(moodLabel(playlist.vibe, playlist.mode))}</p>
          <h2 class="result-poster-title">${titleLines.map((line) => `<span class="result-poster-title-line">${escFn(line)}</span>`).join("")}</h2>
          <blockquote class="result-poster-prompt">"${escFn(prompt.length > 120 ? `${prompt.slice(0, 117)}…` : prompt)}"</blockquote>
          <p class="result-poster-sub">${count} songs · From your library · ${fmtDateFn(playlist.createdAt)}</p>
          <div class="result-poster-actions">
            ${playlist.spotifyUrl ? `<a href="${escFn(playlist.spotifyUrl)}" target="_blank" rel="noopener" class="btn btn-cream btn-sm">${spiFn()} Play on Spotify</a>` : ""}
            ${openHref ? `<a href="${escFn(openHref)}" class="btn btn-ghost btn-sm">Open soundtrack</a>` : ""}
            <a href="/gallery.html" class="btn btn-ghost btn-sm">Your diary →</a>
          </div>
        </div>
      </header>
    </div>
  </section>`;
}

export function buildLandingShowcaseHtml({ escFn }) {
  const demoPrompt = "Empty motorway at midnight, rain on the windscreen";
  return `<section class="landing-showcase" aria-hidden="true">
    <p class="landing-showcase-label">Every moment becomes a soundtrack</p>
    <div class="landing-showcase-poster result-poster result-poster--album">
      <div class="result-poster-content">
        <p class="result-poster-eyebrow">Late night · Journey</p>
        <h2 class="result-poster-title">
          <span class="result-poster-title-line">RAIN ON</span>
          <span class="result-poster-title-line">THE WINDSCREEN</span>
        </h2>
        <blockquote class="result-poster-prompt">"${escFn(demoPrompt)}"</blockquote>
        <p class="result-poster-sub">A soundtrack built from your own memories</p>
      </div>
    </div>
  </section>`;
}
