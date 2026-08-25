import { detectPromptCentralArtists, normalizeSessionArtist } from "./session-artist-gravity";

const EXPLICIT_ARTIST_REQUEST =
  /\b(?:songs?\s+by|tracks?\s+by|only\s+[a-z0-9&'.\-\s]{2,40}\s+(?:songs?|tracks?)|playlist\s+of\s+)\b/i;

export function hasExplicitArtistPlaylistRequest(vibe: string): boolean {
  return EXPLICIT_ARTIST_REQUEST.test(vibe);
}

/** Thin niche dancefloors concentrate on few artists — slightly loftier caps
 *  prevent post-refill artist prune from collapsing 35→10 disco parties. */
const NICHE_DANCEFLOOR_ARTIST_CAP =
  /\b(?:disco|latin|reggaeton|salsa|bachata|uk\s*garage|ukg|french\s*house|synthwave|city\s*pop|liquid\s*(?:dnb|drum)|shoegaze|dream\s*pop)\b/i;

/** Named genre/era prompts where library opportunity is deep — cap=2 collapses honest depth. */
const NAMED_GENRE_ERA_ARTIST_CAP =
  /\b(?:indie(?:\s+rock|\s+pop)?|2000s?\s+indie|noughties\s+indie|alternative\s+rock|alt(?:ernative)?\s+rock|90s?\s+alt|grunge|britpop|pop[-\s]?punk|madchester|nostalgic)\b/i;

export function isNicheDancefloorArtistCapPrompt(vibe: string): boolean {
  return NICHE_DANCEFLOOR_ARTIST_CAP.test(vibe);
}

export function isNamedGenreEraArtistCapPrompt(vibe: string): boolean {
  return NAMED_GENRE_ERA_ARTIST_CAP.test(vibe);
}

export function defaultPerPlaylistArtistCap(playlistSize: number, vibe: string): number {
  if (hasExplicitArtistPlaylistRequest(vibe)) return Number.MAX_SAFE_INTEGER;
  const base = playlistSize >= 30 ? 3 : 2;
  if (isNicheDancefloorArtistCapPrompt(vibe) && playlistSize >= 20) {
    return Math.max(base, Math.min(5, Math.ceil(playlistSize * 0.16)));
  }
  if (isNamedGenreEraArtistCapPrompt(vibe) && playlistSize >= 20) {
    // Deep genre/era libraries need room for a few anchors without collapsing to a stub.
    return Math.max(base, playlistSize >= 25 ? 4 : 3);
  }
  return base;
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
    : Math.max(cap, Math.ceil(opts.playlistSize * 0.22));
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
