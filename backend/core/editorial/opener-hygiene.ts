/**
 * Lightweight opener-chain hygiene — no world-identity profile graph.
 * Used by last-mile API sanitization and fast unit tests.
 */

  /** Psych-indie / landfill opener fillers — world-aware suppression at API hygiene. */
export const OPENER_FILLER_PATTERN =
  /\b(?:kasabian|q\s+lazzarus|tame\s+impala|glenn\s+frey|arctic\s+monkeys|the\s+weeknd|bon\s+iver|clairo|noah\s+kahan|dayglow|gregory\s+alan\s+isakov|badbadnotgood|sufjan\s+stevens|phoebe\s+bridgers|mitski|beach\s+house|jake\s+bugg|joji|mac\s+demarco|fleet\s+foxes|iron\s+(?:&|and)\s+wine|the\s+killers)\b/i;

export function trackArtistName(track: { artistName?: string | null; artist?: string | null }): string {
  return String(track.artistName ?? track.artist ?? "").trim();
}

/** Remix/edit bait titles — common in UK scene retrieval, never intentional openers. */
export const REMIX_EDIT_BAIT_TITLE =
  /\b(?:remix|rework|re-?edit|extended\s+mix|club\s+mix|dub\s+mix|radio\s+edit|dj\s+edit|bootleg|flip)\b/i;

export const UK_SCENE_WORLD_IDS = new Set(["britpop_world"]);

const NAMED_WORLD_LANGUAGE =
  /\b(?:goth|grunge|disco|synthwave|retrowave|neon|lo-?fi|lofi|ambient|metal|pop[-\s]?punk|uk\s*garage|ukg|grime|shoegaze|darkwave|post[-\s]?punk|boss\s+fight|classic\s+rock|red\s+dirt|drum\s+and\s+bass|dnb|britpop|r&b|hyperpop|jazz|folk|emo|reggaeton|salsa|bachata|cumbia|garage\s+workshop|madchester)\b/i;

/** True when the user explicitly asked for sad-indie / tender melancholy (Bon Iver-adjacent is OK). */
export function hasExplicitSadIndieMood(prompt: string): boolean {
  return /\b(?:sad\s+indie|indie\s+sad|soft\s+sad|be\s+gentle|got\s+dumped|heartbroken|miss\s+someone|crying(?!\s+in\s+the\s+club)|lonely\s+but|hurt\s+a\s+little|tender\s+sad|melanchol\w+|film\s+ending|rainy\s+read|acoustic\s+sunday|i\s+just\s+got\s+dumped)\b/i.test(
    prompt,
  );
}

/**
 * Vague lifestyle prompts without sad-indie mood must not open on psych-indie landfill
 * even when the committed everyday world (e.g. sunday_chill) would normally allow it.
 */
export function shouldSuppressVagueLandfillOpeners(prompt: string | null | undefined): boolean {
  const p = String(prompt ?? "").trim();
  if (!p || hasExplicitSadIndieMood(p)) return false;
  if (NAMED_WORLD_LANGUAGE.test(p)) return false;
  return true;
}

export function isRemixBaitTrackTitle(trackName: string | null | undefined): boolean {
  const title = String(trackName ?? "").trim();
  return !!title && REMIX_EDIT_BAIT_TITLE.test(title);
}

export function isUkSceneWorld(activeWorldIds: string[]): boolean {
  return activeWorldIds.some((id) => UK_SCENE_WORLD_IDS.has(id));
}

/** Worlds where psych-indie opener fillers are never intentional curation. */
const ZERO_PSYCH_OPENER_WORLDS = new Set([
  "film_ending_world",
  "dad_secret_world",
  "older_sibling_world",
  "classic_rock_world",
  "yacht_rock_world",
  "gym_rock_world",
  "angry_rock_world",
  "night_drive_world",
  "rainy_drive_world",
  "goth_world",
  "focus_study_world",
  "coffee_soft_focus_world",
  "feel_good_world",
  "party_prep_world",
  "latin_summer_rooftop_world",
  "britpop_world",
  "grunge_world",
  "gym_energy_world",
  "disco_party_world",
  "pop_punk_world",
  "neon_tek_drive",
  "melancholy_drive",
  "commute_world",
  "upbeat_chore_world",
  "social_kitchen_world",
  "sleepy_gym_world",
  "boss_fight",
  "quiet_rage",
  "rnb_night_world",
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

  const isFiller = (track: T): boolean => {
    const artist = trackArtistName(track);
    return !!artist && OPENER_FILLER_PATTERN.test(artist);
  };

  if (maxOpeners <= 0) {
    const clean: T[] = [];
    const fillers: T[] = [];
    for (let i = 0; i < out.length; i++) {
      const track = out[i]!;
      if (isFiller(track)) {
        if (i < limit) {
          demoted.push({ artist: trackArtistName(track), fromIndex: i, toIndex: out.length - 1 });
        }
        fillers.push(track);
      } else {
        clean.push(track);
      }
    }
    const head = clean.slice(0, limit);
    const tail = clean.slice(limit);
    const rebuilt = [...head, ...tail, ...fillers];
    for (const row of demoted) {
      const artist = row.artist;
      row.toIndex = rebuilt.findIndex((t) => trackArtistName(t) === artist);
    }
    return { tracks: rebuilt, demoted };
  }

  let demoteAttempts = 0;
  const maxDemoteAttempts = out.length * openerSlots;

  while (demoteAttempts < maxDemoteAttempts) {
    let fillerCount = 0;
    for (let j = 0; j < limit; j++) {
      if (isFiller(out[j]!)) fillerCount += 1;
    }
    if (fillerCount <= maxOpeners) break;

    let demotedThisPass = false;
    let allowed = 0;
    for (let i = 0; i < limit; i++) {
      if (!isFiller(out[i]!)) continue;
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

type RemixBaitTrack = { trackName?: string | null; name?: string | null; title?: string | null };

function remixTrackTitle(track: RemixBaitTrack): string {
  return String(track.trackName ?? track.name ?? track.title ?? "").trim();
}

/** Demote remix/edit bait titles from opener slots for UK scene worlds. */
export function demoteRemixBaitOpeners<T extends RemixBaitTrack>(
  tracks: T[],
  activeWorldIds: string[],
  openerSlots = 3,
): { tracks: T[]; demoted: Array<{ title: string; fromIndex: number; toIndex: number }> } {
  if (tracks.length <= openerSlots || !isUkSceneWorld(activeWorldIds)) {
    return { tracks, demoted: [] };
  }
  const out = tracks.slice();
  const demoted: Array<{ title: string; fromIndex: number; toIndex: number }> = [];
  const limit = Math.min(openerSlots, out.length);

  for (let i = 0; i < limit; i++) {
    const title = remixTrackTitle(out[i]!);
    if (!isRemixBaitTrackTitle(title)) continue;
    const [track] = out.splice(i, 1);
    if (track) {
      out.push(track);
      demoted.push({ title, fromIndex: i, toIndex: out.length - 1 });
    }
    break;
  }

  return { tracks: out, demoted };
}

/**
 * Promote the strongest world-representative track to #1 — track 1 must be the thesis.
 * When a cultural profile is provided, anchor artists beat adjacent beat weak emotional matches.
 */
export function rankThesisOpenerCandidate<T extends { artistName?: string | null; artist?: string | null; trackName?: string | null }>(
  track: T,
  profile: {
    openerRules?: { preferAnchorArtist?: boolean; anchorBeatsAdjacent?: boolean };
  } | null,
  scoreRepresentative: (track: T) => number,
  isAnchor: (artist: string) => boolean,
  isAdjacent: (artist: string) => boolean,
): number {
  const identityScore = scoreRepresentative(track);
  if (identityScore <= 0) return -1;
  const artist = trackArtistName(track);
  const anchorBoost = profile?.openerRules?.preferAnchorArtist !== false && isAnchor(artist) ? 1000 : 0;
  const adjacentBoost =
    anchorBoost === 0 && profile?.openerRules?.anchorBeatsAdjacent !== false && isAdjacent(artist) ? 500 : 0;
  return anchorBoost + adjacentBoost + identityScore;
}

export function promoteWorldThesisOpener<T extends { artistName?: string | null; artist?: string | null }>(
  tracks: T[],
  scoreRepresentative: (track: T, index: number) => number,
  searchDepth = 10,
  rankCandidate?: (track: T, index: number) => number,
): { tracks: T[]; promoted: boolean; fromIndex: number } {
  if (tracks.length <= 1) return { tracks, promoted: false, fromIndex: 0 };
  const depth = Math.min(searchDepth, tracks.length);
  let bestIdx = 0;
  let bestScore = rankCandidate
    ? rankCandidate(tracks[0]!, 0)
    : scoreRepresentative(tracks[0]!, 0);
  for (let i = 1; i < depth; i++) {
    const score = rankCandidate
      ? rankCandidate(tracks[i]!, i)
      : scoreRepresentative(tracks[i]!, i);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  if (bestIdx === 0 || bestScore <= 0) return { tracks, promoted: false, fromIndex: 0 };
  const out = tracks.slice();
  const [best] = out.splice(bestIdx, 1);
  if (!best) return { tracks, promoted: false, fromIndex: 0 };
  out.unshift(best);
  return { tracks: out, promoted: true, fromIndex: bestIdx };
}
