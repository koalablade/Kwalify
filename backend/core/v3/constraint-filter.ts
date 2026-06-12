import { eraRangeFromBucket, normalizeLockedGenreFamily, type LockedIntent } from "./intent";
import type { ScoredTrack } from "./v3-score";

export interface FilterContext {
  intent: LockedIntent;
}

export type ConstraintTrackLike = {
  genreFamily?: string | null;
  genrePrimary?: string | null;
  releaseYear?: number | null;
  laneEra?: string | null;
  energy?: number | null;
  valence?: number | null;
  tempo?: number | null;
  danceability?: number | null;
  acousticness?: number | null;
  activityTags?: string[];
};

function genreFamilyAllowed(track: ConstraintTrackLike, intent: LockedIntent): boolean {
  const lockedFamilies = intent.genreFamilies
    .map(normalizeLockedGenreFamily)
    .filter((family): family is string => !!family);
  if (lockedFamilies.length === 0) return true;
  const candidateFamily =
    normalizeLockedGenreFamily(track.genreFamily) ??
    normalizeLockedGenreFamily(track.genrePrimary);
  return !!candidateFamily && lockedFamilies.includes(candidateFamily);
}

function eraRejectionReason(track: ConstraintTrackLike, intent: LockedIntent): string | null {
  if (!intent.eraRange) return null;
  if (track.releaseYear !== null && track.releaseYear !== undefined) {
    return track.releaseYear >= intent.eraRange.start && track.releaseYear <= intent.eraRange.end
      ? null
      : "eraMismatch";
  }
  const bucketRange = eraRangeFromBucket(track.laneEra);
  if (!bucketRange) return "unknownEra";
  return bucketRange.end >= intent.eraRange.start && bucketRange.start <= intent.eraRange.end
    ? null
    : "eraMismatch";
}

function eraAllowed(track: ConstraintTrackLike, intent: LockedIntent): boolean {
  return eraRejectionReason(track, intent) === null;
}

function moodCompatible(track: ConstraintTrackLike, mood: string[]): boolean {
  const activeMood = mood.filter((tag) => tag !== "balanced");
  if (activeMood.length === 0) return true;
  const energy = track.energy ?? 0.5;
  const valence = track.valence ?? 0.5;
  const acousticness = track.acousticness ?? 0.5;
  const danceability = track.danceability ?? 0.5;
  return activeMood.some((tag) => {
    if (tag === "melancholic") return valence <= 0.45;
    if (tag === "calm") return energy <= 0.5;
    if (tag === "nostalgic") return track.laneEra !== "20s";
    if (tag === "warm") return valence >= 0.55 && acousticness >= 0.3;
    if (tag === "energised") return energy >= 0.62 || danceability >= 0.62;
    return false;
  });
}

function activityCompatible(track: ConstraintTrackLike, intent: LockedIntent): boolean {
  if (!intent.activity && !intent.energy) return true;
  if (intent.activity && track.activityTags?.includes(intent.activity)) return true;
  const energy = track.energy ?? 0.5;
  const tempo = track.tempo ?? 110;
  const danceability = track.danceability ?? 0.5;
  const acousticness = track.acousticness ?? 0.5;
  const activityMatch =
    intent.activity === "driving" ? energy >= 0.45 && tempo >= 85 :
    intent.activity === "focus" ? energy <= 0.6 && acousticness >= 0.25 :
    intent.activity === "gym" ? energy >= 0.62 || tempo >= 125 :
    intent.activity === "party" ? energy >= 0.6 && danceability >= 0.55 :
    intent.activity === "relaxing" ? energy <= 0.45 :
    intent.activity === "listening" ? true :
    false;
  const energyMatch =
    intent.energy === "high" ? energy >= 0.62 || tempo >= 125 :
    intent.energy === "medium" ? energy >= 0.38 && energy <= 0.75 :
    intent.energy === "low" ? energy <= 0.5 :
    true;
  return activityMatch && energyMatch;
}

export function constraintRejectionReasons(track: ConstraintTrackLike, intent: LockedIntent): string[] {
  const reasons: string[] = [];
  const lockedFamilies = intent.genreFamilies
    .map(normalizeLockedGenreFamily)
    .filter((family): family is string => !!family);
  if (lockedFamilies.length > 0 && !genreFamilyAllowed(track, intent)) {
    const candidateFamily =
      normalizeLockedGenreFamily(track.genreFamily) ??
      normalizeLockedGenreFamily(track.genrePrimary);
    reasons.push(candidateFamily ? "genreFamilyMismatch" : "missingGenreFamily");
  }
  const eraReason = eraRejectionReason(track, intent);
  if (eraReason) reasons.push(eraReason);
  if (!moodCompatible(track, intent.mood)) reasons.push("moodMismatch");
  if (!activityCompatible(track, intent)) reasons.push("activityMismatch");
  return reasons;
}

export function trackMatchesConstraints(track: ConstraintTrackLike, intent: LockedIntent): boolean {
  return constraintRejectionReasons(track, intent).length === 0;
}

export function filterCandidates<TTrack extends ConstraintTrackLike>(
  tracks: Array<ScoredTrack<TTrack>>,
  ctx: FilterContext
): Array<ScoredTrack<TTrack>> {
  return tracks.filter(({ track }) => trackMatchesConstraints(track, ctx.intent));
}
