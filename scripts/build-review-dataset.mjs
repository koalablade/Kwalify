/**
 * Build a human-reviewable dataset from real-library generations.
 *
 * Reads every results-real/*.json generation, flattens it to
 * (input prompt -> song / artist / genre / energy / valence), and runs a
 * "similar names" comparison to surface near-duplicates that exact track-id
 * de-duplication cannot catch (e.g. "Song" vs "Song - Remastered", same song on
 * a single / an album, or the same track reused across playlists).
 *
 * Outputs (all under results-real/review/, git-ignored — local review data):
 *   dataset.json        full structured dataset
 *   dataset.csv         flat table: prompt,song,artist,genre,energy,valence,playlist
 *   similar-names.json  near-duplicate song + artist groupings
 *   REVIEW.md           quick human-readable digest
 *
 *   node scripts/build-review-dataset.mjs
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve("results-real");
const OUT = path.resolve("results-real/review");

/** Collapse a title/artist to a comparable key: drop version/feature noise. */
function normalizeName(raw) {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, " ") // (remastered), [live] ...
    .replace(/\s*-\s*(remaster(ed)?|live|radio edit|mono|stereo|deluxe|acoustic|version|remix|edit).*$/i, " ")
    .replace(/\b(feat|ft|featuring|with)\b.*$/i, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trackGenre(t) {
  if (t.genrePrimary && t.genrePrimary !== "unknown") return t.genrePrimary;
  if (t.genreFamily && t.genreFamily !== "unknown") return t.genreFamily;
  if (Array.isArray(t.genres) && t.genres.length) return t.genres[0];
  if (Array.isArray(t.spotifyArtistGenres) && t.spotifyArtistGenres.length) return t.spotifyArtistGenres[0];
  return "unknown";
}

function round(n) {
  return typeof n === "number" ? Math.round(n * 1000) / 1000 : null;
}

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function main() {
  mkdirSync(OUT, { recursive: true });
  const files = readdirSync(SRC)
    .filter((f) => f.endsWith(".json") && !["digest.json"].includes(f))
    .sort();

  const generations = [];
  const flatRows = [];
  // trackId -> { name, artist, occurrences: [{prompt, playlist}] }
  const byId = new Map();
  // normalized song name -> Set of distinct "artist|id" (near-dup detection)
  const bySongName = new Map();
  const byArtistName = new Map();

  for (const file of files) {
    let j;
    try {
      j = JSON.parse(readFileSync(path.join(SRC, file), "utf8"));
    } catch {
      continue;
    }
    if (!Array.isArray(j.tracks)) continue;
    const prompt = j.vibe ?? j.name ?? file;
    const playlist = j.playlistName ?? j.name ?? file;

    const tracks = j.tracks.map((t) => {
      const genre = trackGenre(t);
      const row = {
        song: t.name ?? "",
        artist: t.artist ?? "",
        genre,
        energy: round(t.energy),
        valence: round(t.valence),
        releaseYear: t.releaseYear ?? null,
        trackId: t.id ?? "",
      };
      flatRows.push({ prompt, playlist, ...row });

      const nSong = normalizeName(row.song);
      const nArtist = normalizeName(row.artist);
      if (nSong) {
        if (!bySongName.has(nSong)) bySongName.set(nSong, new Map());
        bySongName.get(nSong).set(row.trackId, { song: row.song, artist: row.artist, prompt, playlist });
      }
      if (nArtist) byArtistName.set(nArtist, (byArtistName.get(nArtist) ?? 0) + 1);

      if (row.trackId) {
        if (!byId.has(row.trackId)) byId.set(row.trackId, { song: row.song, artist: row.artist, occurrences: [] });
        byId.get(row.trackId).occurrences.push({ prompt, playlist });
      }
      return row;
    });

    generations.push({
      file,
      prompt,
      playlist,
      mode: j.mode ?? null,
      trackCount: tracks.length,
      requested: j.count ?? j.totalTracks ?? null,
      genreDistribution: j.finalGenreDistribution ?? null,
      matchQualityLabel: j.matchQualityLabel ?? null,
      playlistConfidence: j.playlistConfidence ?? null,
      degraded: j.degraded ?? null,
      tracks,
    });
  }

  // ── Similar-name comparisons ───────────────────────────────────────────────
  // 1) Same normalized song title spanning multiple distinct track ids
  //    (near-duplicate versions of the same song).
  const nearDuplicateSongs = [];
  for (const [norm, idMap] of bySongName) {
    if (idMap.size > 1) {
      nearDuplicateSongs.push({
        normalized: norm,
        distinctVersions: idMap.size,
        variants: [...idMap.entries()].map(([id, v]) => ({ trackId: id, ...v })),
      });
    }
  }
  nearDuplicateSongs.sort((a, b) => b.distinctVersions - a.distinctVersions);

  // 2) Exact same track id reused across multiple playlists.
  const crossPlaylistReuse = [];
  for (const [id, info] of byId) {
    const prompts = new Set(info.occurrences.map((o) => o.prompt));
    if (info.occurrences.length > 1) {
      crossPlaylistReuse.push({
        trackId: id,
        song: info.song,
        artist: info.artist,
        timesUsed: info.occurrences.length,
        distinctPrompts: prompts.size,
        prompts: [...prompts],
      });
    }
  }
  crossPlaylistReuse.sort((a, b) => b.timesUsed - a.timesUsed);

  // 3) Similar prompt names (normalized).
  const promptGroups = new Map();
  for (const g of generations) {
    const key = normalizeName(g.prompt);
    if (!promptGroups.has(key)) promptGroups.set(key, []);
    promptGroups.get(key).push(g.prompt);
  }
  const similarPrompts = [...promptGroups.values()].filter((v) => v.length > 1);

  const similar = {
    nearDuplicateSongs,
    crossPlaylistReuse,
    similarPrompts,
    summary: {
      totalGenerations: generations.length,
      totalTracks: flatRows.length,
      distinctTracks: byId.size,
      nearDuplicateSongTitles: nearDuplicateSongs.length,
      tracksReusedAcrossPlaylists: crossPlaylistReuse.length,
    },
  };

  // ── Write outputs ───────────────────────────────────────────────────────────
  writeFileSync(path.join(OUT, "dataset.json"), JSON.stringify(generations, null, 2));
  writeFileSync(path.join(OUT, "similar-names.json"), JSON.stringify(similar, null, 2));

  const header = "prompt,song,artist,genre,energy,valence,releaseYear,playlist,trackId";
  const csv = [header, ...flatRows.map((r) =>
    [r.prompt, r.song, r.artist, r.genre, r.energy, r.valence, r.releaseYear, r.playlist, r.trackId]
      .map(csvCell).join(","),
  )].join("\n");
  writeFileSync(path.join(OUT, "dataset.csv"), csv);

  const md = [];
  md.push("# Generation review dataset");
  md.push("");
  md.push(`Generated ${new Date().toISOString()} from ${generations.length} real-library generations.`);
  md.push("");
  md.push("## Summary");
  md.push(`- Generations: **${similar.summary.totalGenerations}**`);
  md.push(`- Total tracks: **${similar.summary.totalTracks}** (distinct ids: **${similar.summary.distinctTracks}**)`);
  md.push(`- Near-duplicate song titles (same name, different version/id): **${similar.summary.nearDuplicateSongTitles}**`);
  md.push(`- Tracks reused across playlists: **${similar.summary.tracksReusedAcrossPlaylists}**`);
  md.push("");
  md.push("## Prompt → genre mix");
  md.push("");
  md.push("| Prompt | Tracks | Match quality | Top genres |");
  md.push("|---|--:|---|---|");
  for (const g of generations) {
    const dist = g.genreDistribution && typeof g.genreDistribution === "object"
      ? Object.entries(g.genreDistribution).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 3)
          .map(([k, v]) => `${k} ${v}`).join(", ")
      : "—";
    md.push(`| ${g.prompt} | ${g.trackCount} | ${g.matchQualityLabel ?? "—"} | ${dist} |`);
  }
  md.push("");
  if (nearDuplicateSongs.length) {
    md.push("## Near-duplicate song titles (review)");
    md.push("");
    for (const d of nearDuplicateSongs.slice(0, 40)) {
      md.push(`- **${d.normalized}** — ${d.distinctVersions} versions: ` +
        d.variants.map((v) => `"${v.song}" · ${v.artist}`).join(" | "));
    }
    md.push("");
  }
  if (crossPlaylistReuse.length) {
    md.push("## Tracks reused across playlists (review)");
    md.push("");
    for (const r of crossPlaylistReuse.slice(0, 40)) {
      md.push(`- **${r.song}** · ${r.artist} — used ${r.timesUsed}× across ${r.distinctPrompts} prompts`);
    }
    md.push("");
  }
  writeFileSync(path.join(OUT, "REVIEW.md"), md.join("\n"));

  process.stdout.write(JSON.stringify({ out: OUT, ...similar.summary }, null, 2) + "\n");
}

main();
