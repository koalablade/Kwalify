import type { LockedIntent } from "./intent";
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

function eraCenter(intent: LockedIntent): number | null {
  return intent.eraRange ? Math.round((intent.eraRange.start + intent.eraRange.end) / 2) : null;
}

function eraFromBucket(bucket?: string | null): number | null {
  const ranges: Record<string, number> = {
    "60s": 1965,
    "70s": 1975,
    "80s": 1985,
    "90s": 1995,
    "00s": 2005,
    "10s": 2015,
    "20s": 2025,
  };
  return bucket ? ranges[bucket] ?? null : null;
}

function moodCompatible(track: ConstraintTrackLike, mood: string[]): boolean {
  if (mood.length === 0) return true;
  const energy = track.energy ?? 0.5;
  const valence = track.valence ?? 0.5;
  const acousticness = track.acousticness ?? 0.5;
  const danceability = track.danceability ?? 0.5;
  return mood.some((tag) => {
    if (tag === "melancholic") return valence <= 0.45;
    if (tag === "calm") return energy <= 0.5;
    if (tag === "nostalgic") return track.laneEra !== "20s";
    if (tag === "warm") return valence >= 0.55 && acousticness >= 0.3;
    if (tag === "energised") return energy >= 0.62 || danceability >= 0.62;
    return true;
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
    true;
  const energyMatch =
    intent.energy === "high" ? energy >= 0.62 || tempo >= 125 :
    intent.energy === "medium" ? energy >= 0.38 && energy <= 0.75 :
    intent.energy === "low" ? energy <= 0.5 :
    true;
  return activityMatch && energyMatch;
}

export function filterCandidates<TTrack extends ConstraintTrackLike>(
  tracks: Array<ScoredTrack<TTrack>>,
  ctx: FilterContext
): Array<ScoredTrack<TTrack>> {
  const primaryFamily = ctx.intent.genreFamilies[0] ?? null;
  const center = eraCenter(ctx.intent);
  return tracks.filter(({ track }) => {
    const family = track.genreFamily ?? track.genrePrimary ?? null;
    if (primaryFamily && family !== primaryFamily) return false;

    if (center !== null) {
      const year = track.releaseYear ?? eraFromBucket(track.laneEra);
      if (year !== null && Math.abs(year - center) > 15) return false;
    }

    if (!moodCompatible(track, ctx.intent.mood)) return false;
    if (!activityCompatible(track, ctx.intent)) return false;
    return true;
  });
}
