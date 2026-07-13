import { detectPromptCentralArtists, normalizeSessionArtist } from "./session-artist-gravity";

const EXPLICIT_ARTIST_REQUEST =
  /\b(?:songs?\s+by|tracks?\s+by|only\s+[a-z0-9&'.\-\s]{2,40}\s+(?:songs?|tracks?)|playlist\s+of\s+)\b/i;

export function hasExplicitArtistPlaylistRequest(vibe: string): boolean {
  return EXPLICIT_ARTIST_REQUEST.test(vibe);
}

export function defaultPerPlaylistArtistCap(playlistSize: number, vibe: string): number {
  if (hasExplicitArtistPlaylistRequest(vibe)) return Number.MAX_SAFE_INTEGER;
  return playlistSize >= 25 ? 4 : 3;
}

function artistIsCentral(
  artist: string,
  promptCentralArtists: ReadonlySet<string>,
): boolean {
  if (promptCentralArtists.size === 0) return false;
  if (promptCentralArtists.has(artist)) return true;
  for (const central of promptCentralArtists) {
    if (artist.includes(central) || central.includes(artist)) return true;
  }
  return false;
}

export function enforcePerPlaylistArtistCap<T extends { artistName?: string | null }>(
  tracks: T[],
  opts: {
    vibe: string;
    playlistSize: number;
    promptCentralArtists?: ReadonlySet<string>;
    defaultCap?: number;
  },
): { tracks: T[]; dropped: number; cap: number; centralArtistCap: number } {
  const cap = opts.defaultCap ?? defaultPerPlaylistArtistCap(opts.playlistSize, opts.vibe);
  const centralArtists = opts.promptCentralArtists ?? detectPromptCentralArtists(opts.vibe);
  const centralArtistCap = cap >= Number.MAX_SAFE_INTEGER / 2
    ? Number.MAX_SAFE_INTEGER
    : Math.max(cap, Math.ceil(opts.playlistSize * 0.45));
  const counts = new Map<string, number>();
  const out: T[] = [];
  let dropped = 0;

  for (const track of tracks) {
    const artist = normalizeSessionArtist(track.artistName ?? "");
    if (!artist) {
      out.push(track);
      continue;
    }
    const limit = artistIsCentral(artist, centralArtists) ? centralArtistCap : cap;
    const current = counts.get(artist) ?? 0;
    if (current >= limit) {
      dropped += 1;
      continue;
    }
    counts.set(artist, current + 1);
    out.push(track);
  }

  return { tracks: out, dropped, cap, centralArtistCap };
}

export function applyDeliveryPerPlaylistArtistCap<T extends { artistName?: string | null }>(
  tracks: T[],
  opts: {
    vibe: string;
    playlistSize: number;
    promptCentralArtists?: ReadonlySet<string>;
    defaultCap?: number;
  },
): { tracks: T[]; diagnostics: { applied: boolean; dropped: number; cap: number; remaining: number } } {
  const result = enforcePerPlaylistArtistCap(tracks, opts);
  return {
    tracks: result.tracks,
    diagnostics: {
      applied: result.dropped > 0,
      dropped: result.dropped,
      cap: result.cap,
      remaining: result.tracks.length,
    },
  };
}
