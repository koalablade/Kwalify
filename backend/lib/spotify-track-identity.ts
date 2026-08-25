/**
 * Spotify track identity helpers.
 * Primary identity is the Spotify track ID / URI — never artist+title.
 */

const TRACK_ID_RE = /^[A-Za-z0-9]{22}$/;

export function normalizeSpotifyTrackId(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const uri = raw.match(/^spotify:track:([A-Za-z0-9]{22})$/i);
  if (uri) return uri[1];
  const open = raw.match(/open\.spotify\.com\/track\/([A-Za-z0-9]{22})/i);
  if (open) return open[1];
  if (TRACK_ID_RE.test(raw)) return raw;
  return null;
}

export function toSpotifyTrackUri(trackId: string): string {
  return `spotify:track:${trackId}`;
}

export type UriIntegrityStats = {
  inputCount: number;
  uniqueIds: number;
  duplicateIds: number;
  missingOrEmpty: number;
  invalid: number;
  nonSpotify: number;
};

export function uriIntegrityStats(values: readonly unknown[]): UriIntegrityStats {
  const seen = new Set<string>();
  let duplicateIds = 0;
  let missingOrEmpty = 0;
  let invalid = 0;
  let nonSpotify = 0;
  for (const value of values) {
    if (value == null || String(value).trim() === "") {
      missingOrEmpty += 1;
      continue;
    }
    const raw = String(value).trim();
    const id = normalizeSpotifyTrackId(raw);
    if (!id) {
      if (raw.startsWith("spotify:") && !raw.startsWith("spotify:track:")) nonSpotify += 1;
      else invalid += 1;
      continue;
    }
    if (seen.has(id)) duplicateIds += 1;
    else seen.add(id);
  }
  return {
    inputCount: values.length,
    uniqueIds: seen.size,
    duplicateIds,
    missingOrEmpty,
    invalid,
    nonSpotify,
  };
}

export function uniqueNormalizedTrackIds(values: readonly unknown[]): Set<string> {
  const out = new Set<string>();
  for (const value of values) {
    const id = normalizeSpotifyTrackId(value);
    if (id) out.add(id);
  }
  return out;
}

export function setDiff<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): T[] {
  const out: T[] = [];
  for (const item of a) {
    if (!b.has(item)) out.push(item);
  }
  return out;
}
