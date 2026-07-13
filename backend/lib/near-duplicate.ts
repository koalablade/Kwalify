/**
 * Near-duplicate intelligence.
 *
 * Exact track-id de-duplication (done at the response-formatting choke point)
 * cannot catch the same *recording* delivered under a different Spotify id:
 *
 *   "Welcome to the Jungle"            (album version)
 *   "Welcome to the Jungle - Remaster" (remaster, different id)
 *   "Welcome to the Jungle (Live)"     (live take, different id)
 *
 * To a human listener these feel like the playlist repeated itself. This module
 * collapses such near-duplicates while deliberately NOT collapsing genuinely
 * different works:
 *
 *   - Different artists with the same title stay separate (covers, common names).
 *   - Remixes stay separate (a dancefloor remix is a different experience).
 *
 * The module is pure and dependency-free so it can be reused both at the final
 * formatting choke point and, later, inside selection to trigger back-fill.
 */

/**
 * Version / edition qualifiers that denote the *same underlying song* rather
 * than a genuinely different composition. These are stripped before comparison.
 *
 * Deliberately EXCLUDES "remix" and standalone "mix" — those frequently denote
 * a materially different arrangement a curator may legitimately want alongside
 * the original.
 */
const VERSION_QUALIFIERS = [
  "remaster",
  "remastered",
  "re-master",
  "re-mastered",
  "deluxe",
  "deluxe edition",
  "deluxe version",
  "expanded",
  "expanded edition",
  "anniversary",
  "anniversary edition",
  "radio edit",
  "radio version",
  "album version",
  "single version",
  "original version",
  "original mix",
  "original",
  "mono",
  "stereo",
  "mono version",
  "stereo version",
  "bonus track",
  "bonus",
  "re-recorded",
  "rerecorded",
  "re-recorded version",
  "taylor's version",
  "taylors version",
  "live",
  "live version",
  "acoustic",
  "acoustic version",
  "unplugged",
  "movie version",
  "soundtrack version",
];

const REMASTER_YEAR = /\b(19|20)\d{2}\s*(digital\s*)?remaster(ed)?\b/gi;

/**
 * Collapse a track title to a comparison key: drop version/edition noise,
 * featured-artist credits, punctuation and casing.
 */
export function normalizeTitle(raw: string | null | undefined): string {
  let s = String(raw ?? "").toLowerCase();

  // "... - 2011 Remaster" / "(2009 Digital Remaster)" etc.
  s = s.replace(REMASTER_YEAR, " ");

  // Parenthetical / bracketed qualifiers: (Remastered), [Live at ...], etc.
  s = s.replace(/[([{][^)\]}]*[)\]}]/g, (m) => {
    const inner = m.slice(1, -1).toLowerCase();
    return VERSION_QUALIFIERS.some((q) => inner.includes(q)) ||
      /\b(19|20)\d{2}\b.*remaster/.test(inner)
      ? " "
      : m;
  });

  // " - Remastered", " - Live", " - Radio Edit", etc. (dash-suffixed qualifier)
  const qualifierAlt = VERSION_QUALIFIERS.map((q) =>
    q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  ).join("|");
  s = s.replace(new RegExp(`\\s*-\\s*(${qualifierAlt})\\b.*$`, "i"), " ");

  // Featured-artist credits.
  s = s.replace(/\b(feat|ft|featuring|with)\b\.?.*$/i, " ");

  return s
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize an artist string to its primary artist for comparison. Collapses
 * "A feat. B", "A & B", "A, B" to the leading credited artist.
 */
export function normalizeArtist(raw: string | null | undefined): string {
  let s = String(raw ?? "").toLowerCase();
  s = s.replace(/\b(feat|ft|featuring|with)\b\.?.*$/i, " ");
  s = s.split(/\s*(?:,|&|\/|\bx\b|\band\b)\s*/)[0] ?? s;
  return s
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface NearDuplicatable {
  name?: string | null;
  artist?: string | null;
}

/**
 * The near-duplicate key for a track: primary-artist + version-stripped title.
 * Two tracks sharing this key are considered the same underlying recording even
 * if their Spotify ids differ. Returns null when the track lacks the fields
 * required to compare confidently (so it is never wrongly collapsed).
 */
export function nearDuplicateKey(track: NearDuplicatable): string | null {
  const title = normalizeTitle(track.name);
  const artist = normalizeArtist(track.artist);
  if (!title || !artist) return null;
  return `${artist}|${title}`;
}

export interface CollapseOptions<T> {
  /** Extract the near-duplicate key; return null to always keep the item. */
  getKey?: (item: T) => string | null;
  /**
   * Optional: return true if `candidate` should REPLACE the already-kept
   * `incumbent` for the same key. Defaults to keeping the first occurrence,
   * which preserves curated ordering (earlier slot was chosen intentionally).
   */
  preferReplacement?: (candidate: T, incumbent: T) => boolean;
}

/**
 * Remove near-duplicates from a list, preserving order. By default keeps the
 * first occurrence of each near-duplicate key (consistent with the exact-id
 * dedup: an honestly shorter playlist beats an audibly repetitive one).
 */
export function collapseNearDuplicates<T extends NearDuplicatable>(
  items: T[],
  options: CollapseOptions<T> = {},
): { kept: T[]; removed: T[] } {
  const getKey = options.getKey ?? ((item: T) => nearDuplicateKey(item));
  const prefer = options.preferReplacement;

  const keptIndexByKey = new Map<string, number>();
  const kept: T[] = [];
  const removed: T[] = [];

  for (const item of items) {
    const key = getKey(item);
    if (key == null) {
      kept.push(item);
      continue;
    }
    const existingIdx = keptIndexByKey.get(key);
    if (existingIdx === undefined) {
      keptIndexByKey.set(key, kept.length);
      kept.push(item);
      continue;
    }
    if (prefer && prefer(item, kept[existingIdx])) {
      removed.push(kept[existingIdx]);
      kept[existingIdx] = item;
    } else {
      removed.push(item);
    }
  }

  return { kept, removed };
}
