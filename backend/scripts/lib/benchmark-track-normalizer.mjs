/**
 * Canonical API-track → HumanCurationTrack normalization for benchmarks.
 * Matches human-curation-benchmark.mjs field mapping exactly.
 */

function firstNonEmptyString(...values) {
  for (const v of values) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

function firstArtistFromArray(artists) {
  if (!Array.isArray(artists) || artists.length === 0) return null;
  const first = artists[0];
  if (typeof first === "string" && first.trim()) return first.trim();
  if (first && typeof first === "object") {
    return firstNonEmptyString(first.name, first.artistName, first.artist);
  }
  return null;
}

function nullableNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Extract raw artist identity from API-shaped track (before normalization). */
export function extractRawArtistKey(track) {
  if (!track || typeof track !== "object") return "";
  const artist = firstNonEmptyString(
    track.artistName,
    track.artist,
    firstArtistFromArray(track.artists),
  );
  return artist ? artist.toLowerCase().trim() : "";
}

/** Extract raw track title from API-shaped track. */
export function extractRawTrackTitle(track) {
  if (!track || typeof track !== "object") return "";
  const title = firstNonEmptyString(track.trackName, track.name, track.title);
  return title ?? "";
}

/**
 * Normalize one API track to evaluator HumanCurationTrack shape.
 * Does not invent metadata — null when absent.
 */
export function normalizeBenchmarkTrack(track) {
  if (!track || typeof track !== "object") {
    return {
      trackName: null,
      artistName: null,
      energy: null,
      popularity: null,
      valence: null,
      acousticness: null,
    };
  }
  return {
    trackName: firstNonEmptyString(track.trackName, track.name, track.title),
    artistName: firstNonEmptyString(track.artistName, track.artist, firstArtistFromArray(track.artists)),
    energy: nullableNumber(track.energy),
    popularity: nullableNumber(track.popularity),
    valence: nullableNumber(track.valence),
    acousticness: nullableNumber(track.acousticness),
  };
}

/** Normalize playlist for evaluator input. */
export function normalizeBenchmarkTracks(tracks) {
  if (!Array.isArray(tracks)) return [];
  return tracks.map(normalizeBenchmarkTrack);
}

/** Protected-benchmark inline mapping (reference implementation). */
export function protectedBenchmarkMapTrack(t) {
  return {
    trackName: t.trackName ?? t.name,
    artistName: t.artistName ?? t.artist,
    energy: t.energy ?? null,
    popularity: t.popularity ?? null,
    valence: t.valence ?? null,
    acousticness: t.acousticness ?? null,
  };
}

export function protectedBenchmarkMapTracks(tracks) {
  return tracks.map(protectedBenchmarkMapTrack);
}

function uniqueNormalizedArtistKeys(normalized) {
  return new Set(normalized.map((t) => String(t.artistName ?? "").toLowerCase().trim()).filter(Boolean));
}

function uniqueRawArtistKeys(rawTracks) {
  return new Set(rawTracks.map(extractRawArtistKey).filter(Boolean));
}

/**
 * Validate normalization before scoring. Returns { ok, warnings, errors }.
 * Distinguishes genuine one-artist playlists from normalization failure.
 */
export function validateBenchmarkTrackNormalization(rawTracks, normalizedTracks) {
  const warnings = [];
  const errors = [];

  if (!Array.isArray(rawTracks) || rawTracks.length === 0) {
    return { ok: true, warnings, errors };
  }

  const rawArtists = uniqueRawArtistKeys(rawTracks);
  const normArtists = uniqueNormalizedArtistKeys(normalizedTracks);

  let missingArtistWhenRawExists = 0;
  let missingTitleWhenRawExists = 0;

  for (let i = 0; i < rawTracks.length; i += 1) {
    const raw = rawTracks[i];
    const norm = normalizedTracks[i];
    const rawArtist = extractRawArtistKey(raw);
    const rawTitle = extractRawTrackTitle(raw);
    const normArtist = String(norm?.artistName ?? "").trim();
    const normTitle = String(norm?.trackName ?? "").trim();

    if (rawArtist && !normArtist) {
      missingArtistWhenRawExists += 1;
      errors.push(`Track #${i + 1}: raw artist "${rawArtist}" lost during normalization`);
    }
    if (rawTitle && !normTitle) {
      missingTitleWhenRawExists += 1;
      errors.push(`Track #${i + 1}: raw title "${rawTitle}" lost during normalization`);
    }
  }

  if (rawArtists.size >= 3 && normArtists.size <= 1) {
    errors.push(
      `Normalization collapse: raw has ${rawArtists.size} unique artists but normalized has ${normArtists.size}`,
    );
  } else if (rawArtists.size >= 2 && normArtists.size === 1 && rawArtists.size > 1) {
    errors.push(
      `Possible normalization collapse: raw ${rawArtists.size} artists → normalized 1 artist`,
    );
  }

  if (missingArtistWhenRawExists > 0) {
    errors.push(`${missingArtistWhenRawExists} track(s) missing artist after normalization`);
  }
  if (missingTitleWhenRawExists > 0) {
    warnings.push(`${missingTitleWhenRawExists} track(s) missing title after normalization`);
  }

  const pctMissingArtist =
    rawTracks.length > 0
      ? rawTracks.filter((t) => extractRawArtistKey(t) && !String(normalizeBenchmarkTrack(t).artistName ?? "").trim())
          .length / rawTracks.length
      : 0;

  if (pctMissingArtist > 0.1) {
    errors.push(`${Math.round(pctMissingArtist * 100)}% of tracks lost artist identity during normalization`);
  }

  return { ok: errors.length === 0, warnings, errors };
}

/** Aggregate playlist-level instrumentation diagnostics after scoring. */
export function playlistInstrumentationDiagnostics(rawTracks, normalizedTracks, score) {
  const rawArtists = uniqueRawArtistKeys(rawTracks);
  const normArtists = uniqueNormalizedArtistKeys(normalizedTracks);
  const opener = normalizedTracks[0];
  const openerLabel = `${opener?.artistName ?? "?"} — ${opener?.trackName ?? "?"}`;
  const seqEvidence = score?.dimensions?.sequencing?.evidence ?? [];
  const undefinedTransitions = seqEvidence.filter((e) => String(e).includes("undefined")).length;

  return {
    rawUniqueArtists: rawArtists.size,
    normalizedUniqueArtists: normArtists.size,
    openerLabel,
    sequencingScore: score?.dimensions?.sequencing?.score ?? null,
    varietyScore: score?.dimensions?.variety?.score ?? null,
    undefinedTransitionEvidenceCount: undefinedTransitions,
    pathological:
      (rawArtists.size >= 2 && normArtists.size <= 1) ||
      openerLabel === "? — ?" ||
      (score?.dimensions?.sequencing?.score === 0 && rawTracks.length >= 3 && rawArtists.size >= 2) ||
      undefinedTransitions > 0,
  };
}

/** Deep equality for normalized track arrays (equivalence check). */
export function normalizedTracksEquivalent(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    for (const key of ["trackName", "artistName", "energy", "popularity", "valence", "acousticness"]) {
      if (left[key] !== right[key] && !(left[key] == null && right[key] == null)) return false;
    }
  }
  return true;
}
