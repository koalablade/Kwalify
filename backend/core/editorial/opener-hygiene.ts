/**
 * Lightweight opener-chain hygiene — no world-identity profile graph.
 * Used by last-mile API sanitization and fast unit tests.
 */

/** Psych-indie / retrieval filler artists that must not anchor openers outside natural worlds. */
export const OPENER_FILLER_PATTERN =
  /\b(?:kasabian|q\s+lazzarus|tame\s+impala|glenn\s+frey|arctic\s+monkeys|the\s+weeknd)\b/i;

export function trackArtistName(track: { artistName?: string | null; artist?: string | null }): string {
  return String(track.artistName ?? track.artist ?? "").trim();
}

/** Worlds where psych-indie opener fillers are never intentional curation. */
const ZERO_PSYCH_OPENER_WORLDS = new Set([
  "film_ending_world",
  "dad_secret_world",
  "older_sibling_world",
  "classic_rock_world",
  "goth_world",
  "focus_study_world",
  "coffee_soft_focus_world",
  "feel_good_world",
  "party_prep_world",
  "latin_summer_rooftop_world",
  "britpop_world",
  "grunge_world",
]);

/** Max psych-indie opener fillers allowed in slots 1–3 for these worlds. */
export function maxPsychIndieOpenersForWorlds(activeWorldIds: string[]): number {
  if (activeWorldIds.length === 0) return 1;
  if (activeWorldIds.some((id) => ZERO_PSYCH_OPENER_WORLDS.has(id))) return 0;
  return 1;
}

export function isZeroPsychOpenerWorld(activeWorldId: string | null | undefined): boolean {
  if (!activeWorldId) return false;
  return ZERO_PSYCH_OPENER_WORLDS.has(activeWorldId);
}

/**
 * Hard opener cap — Tame → Kasabian → Q chains are never acceptable as openers.
 * Keeps at most `maxOpeners` psych-indie fillers in the first `openerSlots` positions.
 */
export function sanitizePsychIndieOpenerChain<T extends { artistName?: string | null; artist?: string | null }>(
  tracks: T[],
  openerSlots = 3,
  maxOpeners = 1,
): { tracks: T[]; demoted: Array<{ artist: string; fromIndex: number; toIndex: number }> } {
  if (tracks.length <= openerSlots) {
    return { tracks, demoted: [] };
  }
  const out = tracks.slice();
  const demoted: Array<{ artist: string; fromIndex: number; toIndex: number }> = [];
  const limit = Math.min(openerSlots, out.length);
  let demoteAttempts = 0;
  const maxDemoteAttempts = out.length * openerSlots;

  while (demoteAttempts < maxDemoteAttempts) {
    let fillerCount = 0;
    for (let j = 0; j < limit; j++) {
      const artist = trackArtistName(out[j]!);
      if (artist && OPENER_FILLER_PATTERN.test(artist)) fillerCount += 1;
    }
    if (fillerCount <= maxOpeners) break;

    let demotedThisPass = false;
    if (maxOpeners <= 0) {
      for (let i = 0; i < limit; i++) {
        const artist = trackArtistName(out[i]!);
        if (!artist || !OPENER_FILLER_PATTERN.test(artist)) continue;
        const [track] = out.splice(i, 1);
        if (track) {
          out.push(track);
          demoted.push({ artist: trackArtistName(track), fromIndex: i, toIndex: out.length - 1 });
        }
        demoteAttempts += 1;
        demotedThisPass = true;
        break;
      }
    } else {
      let allowed = 0;
      for (let i = 0; i < limit; i++) {
        const artist = trackArtistName(out[i]!);
        if (!artist || !OPENER_FILLER_PATTERN.test(artist)) continue;
        allowed += 1;
        if (allowed > maxOpeners) {
          const [track] = out.splice(i, 1);
          if (track) {
            out.push(track);
            demoted.push({ artist: trackArtistName(track), fromIndex: i, toIndex: out.length - 1 });
          }
          demoteAttempts += 1;
          demotedThisPass = true;
          break;
        }
      }
    }
    if (!demotedThisPass) break;
  }

  return { tracks: out, demoted };
}

/** Opening-lock IDs after psych-opener sanitize — avoids locking filler chains. */
export function openingLockTrackIdsFromTracks<
  T extends { trackId: string; artistName?: string | null; artist?: string | null },
>(tracks: readonly T[], lockLen: number, maxPsychOpeners: number): string[] {
  if (lockLen <= 0) return [];
  const { tracks: sanitized } = sanitizePsychIndieOpenerChain(
    [...tracks],
    Math.min(3, lockLen),
    maxPsychOpeners,
  );
  return sanitized.slice(0, lockLen).map((track) => track.trackId);
}

/** Count pattern-matching opener fillers (no world filter). */
export function countOpenerFillerPatternMatches<T extends { artistName?: string | null; artist?: string | null }>(
  tracks: T[],
  openerSlots = 3,
): number {
  return tracks
    .slice(0, openerSlots)
    .filter((track) => {
      const artist = trackArtistName(track);
      return artist && OPENER_FILLER_PATTERN.test(artist);
    }).length;
}
