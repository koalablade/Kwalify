/**
 * Blended intent pool — when strict genre+era+activity pool is thin, combine lanes
 * instead of jumping to generic fallback.
 */

import type { EmotionProfile } from "./emotion";
import type { LockedIntent } from "../core/v3/intent";
import {
  resolveActivityProfile,
  scoreActivityCandidateFit,
  type ActivityClassificationInput,
  type ActivityTrackInput,
} from "./activity-profiles";
import {
  buildPromptSonicTarget,
  buildSonicTasteProfile,
  scoreTrackSonicPromptFit,
  type SonicTasteProfile,
} from "./sonic-taste-profile";
import { buildConstraintRelaxationPlan, relaxedIntentForProfile } from "../core/v3/constraint-relaxation";
import { trackHasEraEvidence } from "./era-evidence";
import { getGenreFamily } from "../core/v3/global-diversity-controller";
import {
  histogramFamiliesForTracks,
  type StageFamilySnapshot,
} from "./family-stage-funnel";

export type BlendedPoolTrack = ActivityTrackInput & {
  trackId: string;
  trackName?: string | null;
  artistName: string;
  releaseYear?: number | null;
  popularity?: number | null;
  rediscoveryScore?: number | null;
};

export type BlendedPoolDiagnostics = {
  inputCount: number;
  outputCount: number;
  lanes: Record<string, number>;
  relaxationStep: string | null;
  targetCount: number;
  /** Family × lane forensics (diagnosis only). */
  familyFunnel?: {
    genreEligibleRaw: StageFamilySnapshot;
    genreLanePicked: StageFamilySnapshot;
    mergedPool: StageFamilySnapshot;
    genreFitEligibleCount: number;
    genreLaneQuota: number;
    relaxedGenreFamilies: string[];
    normalizedIntentFamilies: string[];
  };
};

export type CompoundIntentShape = {
  genreFamilies?: string[];
  eraRange?: { start: number; end: number } | null;
  activity?: string | null;
  mood?: string[];
};

export function compoundPromptDimensions(intent: CompoundIntentShape): number {
  return (
    ((intent.genreFamilies?.length ?? 0) > 0 ? 1 : 0) +
    (intent.eraRange ? 1 : 0) +
    (intent.activity ? 1 : 0) +
    ((intent.mood?.length ?? 0) > 0 ? 1 : 0)
  );
}

export function isCompoundPromptIntent(intent: CompoundIntentShape): boolean {
  return compoundPromptDimensions(intent) >= 2 && (intent.genreFamilies?.length ?? 0) > 0;
}

/** Strict genre+era+activity filters yielded too few survivors for playlist length. */
export function strictSupplyStarved(strictValidCount: number, requestedLength: number): boolean {
  return strictValidCount < Math.max(5, Math.ceil(requestedLength * 0.45));
}

export function blendedPoolMinimumCount(requestedLength: number): number {
  return Math.max(8, Math.min(requestedLength, 12));
}

function classifyFor<T extends BlendedPoolTrack>(
  track: T,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>,
): ActivityClassificationInput {
  return classMap.get(track.trackId) ?? null;
}

function quickEmotionFit(
  track: { energy?: number | null; valence?: number | null },
  profile: EmotionProfile,
): number {
  const e = track.energy ?? 0.5;
  const v = track.valence ?? 0.5;
  return 1 - (Math.abs(e - profile.energy) + Math.abs(v - profile.valence)) / 2;
}

function sonicLaneScore(
  track: BlendedPoolTrack,
  promptSonicTarget: ReturnType<typeof buildPromptSonicTarget>,
  sonicProfile: SonicTasteProfile | null,
): number {
  return scoreTrackSonicPromptFit(
    {
      energy: track.energy ?? null,
      valence: track.valence ?? null,
      tempo: track.tempo ?? null,
      danceability: track.danceability ?? null,
      acousticness: track.acousticness ?? null,
      speechiness: track.speechiness ?? null,
      instrumentalness: null,
    },
    promptSonicTarget,
    sonicProfile,
  );
}

function genreLaneScore(
  track: BlendedPoolTrack,
  classification: ActivityClassificationInput,
  families: string[],
): number {
  if (families.length === 0) return 0.5;
  const normalized = new Set(families.map((f) => getGenreFamily(f)));
  const trackFamilies = [
    classification?.genreFamily,
    classification?.genrePrimary,
    classification?.primarySubgenre,
    ...(classification?.subGenres ?? []),
  ].filter((v): v is string => !!v).map((f) => getGenreFamily(f));
  const hit = trackFamilies.some((f) => normalized.has(f));
  return hit ? 1 : 0.15;
}

function eraLaneScore(track: BlendedPoolTrack, eraRange: { start: number; end: number } | null): number {
  if (!eraRange) return 0.5;
  return trackHasEraEvidence(track, eraRange) ? 1 : 0.2;
}

export function buildBlendedIntentPool<T extends BlendedPoolTrack>(
  opts: {
    tracks: T[];
    vibe: string;
    intent: LockedIntent;
    emotionProfile: EmotionProfile;
    classMap: Map<string, {
      genrePrimary: string;
      genreFamily: string;
      primarySubgenre: string;
      secondarySubgenre: string | null;
      subGenres: string[];
    }>;
    requestedLength: number;
    sonicTasteProfile?: SonicTasteProfile | null;
    mode?: "strict" | "balanced" | "chaotic";
  },
): { tracks: T[]; diagnostics: BlendedPoolDiagnostics } {
  const targetCount = Math.max(
    Math.ceil(opts.requestedLength * 0.8),
    Math.min(12, opts.requestedLength),
    Math.min(opts.tracks.length, Math.max(24, opts.requestedLength * 4)),
  );
  const cap = Math.min(opts.tracks.length, Math.max(targetCount * 3, 120));
  const activityProfile = resolveActivityProfile(opts.vibe, opts.intent);
  const sonicProfile = opts.sonicTasteProfile ?? buildSonicTasteProfile(opts.tracks);
  const promptSonicTarget = buildPromptSonicTarget(opts.vibe, opts.emotionProfile, activityProfile);
  const relaxationPlan = buildConstraintRelaxationPlan(opts.intent, opts.mode ?? "balanced");

  let selectedStep = relaxationPlan[0]!;
  let relaxedIntent = opts.intent;
  for (const step of relaxationPlan) {
    relaxedIntent = relaxedIntentForProfile(opts.intent, step.profile);
    const families = relaxedIntent.genreFamilies;
    const eraRange = relaxedIntent.eraRange;
    const scored = opts.tracks.map((track) => {
      const classification = classifyFor(track, opts.classMap);
      const activityFit = activityProfile
        ? scoreActivityCandidateFit(track, classification, activityProfile, opts.vibe)
        : quickEmotionFit(track, opts.emotionProfile);
      const genreFit = genreLaneScore(track, classification, families);
      const eraFit = eraLaneScore(track, eraRange);
      const sonicFit = sonicLaneScore(track, promptSonicTarget, sonicProfile);
      const discoveryFit = typeof track.rediscoveryScore === "number"
        ? Math.max(0, Math.min(1, track.rediscoveryScore))
        : 0.35;
      const composite =
        activityFit * 0.28 +
        genreFit * 0.26 +
        eraFit * 0.18 +
        sonicFit * 0.18 +
        discoveryFit * 0.10;
      return { track, composite, activityFit, genreFit, eraFit, sonicFit, discoveryFit };
    });
    const strong = scored.filter((row) => row.composite >= 0.38).length;
    if (strong >= targetCount || step.id === "relax_genre") {
      selectedStep = step;
      break;
    }
    selectedStep = step;
  }

  const families = relaxedIntent.genreFamilies;
  const eraRange = relaxedIntent.eraRange;
  const laneCounts: Record<string, number> = {
    era_match: 0,
    genre_match: 0,
    sonic_match: 0,
    discovery: 0,
    activity_match: 0,
  };

  const scored = opts.tracks
    .map((track) => {
      const classification = classifyFor(track, opts.classMap);
      const activityFit = activityProfile
        ? scoreActivityCandidateFit(track, classification, activityProfile, opts.vibe)
        : quickEmotionFit(track, opts.emotionProfile);
      const genreFit = genreLaneScore(track, classification, families);
      const eraFit = eraLaneScore(track, eraRange);
      const sonicFit = sonicLaneScore(track, promptSonicTarget, sonicProfile);
      const discoveryFit = typeof track.rediscoveryScore === "number"
        ? Math.max(0, Math.min(1, track.rediscoveryScore))
        : 0.35;
      return {
        track,
        composite:
          activityFit * 0.28 +
          genreFit * 0.26 +
          eraFit * 0.18 +
          sonicFit * 0.18 +
          discoveryFit * 0.10,
        activityFit,
        genreFit,
        eraFit,
        sonicFit,
        discoveryFit,
      };
    })
    .sort((a, b) => b.composite - a.composite);

  const seen = new Set<string>();
  const merged: T[] = [];
  const pullLane = (
    lane: string,
    predicate: (row: typeof scored[number]) => boolean,
    quota: number,
  ): void => {
    let picked = 0;
    for (const row of scored) {
      if (merged.length >= cap || picked >= quota) break;
      if (seen.has(row.track.trackId)) continue;
      if (!predicate(row)) continue;
      seen.add(row.track.trackId);
      merged.push(row.track);
      laneCounts[lane] = (laneCounts[lane] ?? 0) + 1;
      picked += 1;
    }
  };

  const eraQuota = Math.ceil(cap * 0.22);
  const genreQuota = Math.ceil(cap * 0.28);
  const sonicQuota = Math.ceil(cap * 0.18);
  const discoveryQuota = Math.ceil(cap * 0.12);
  const activityQuota = Math.ceil(cap * 0.20);

  const genreEligible = scored.filter((row) => row.genreFit >= 0.85).map((row) => row.track);

  pullLane("genre_match", (row) => row.genreFit >= 0.85, genreQuota);
  const genreLanePicked = [...merged];
  pullLane("era_match", (row) => row.eraFit >= 0.85, eraQuota);
  pullLane("activity_match", (row) => row.activityFit >= 0.55, activityQuota);
  pullLane("sonic_match", (row) => row.sonicFit >= 0.52, sonicQuota);
  pullLane("discovery", (row) => row.discoveryFit >= 0.55, discoveryQuota);

  for (const row of scored) {
    if (merged.length >= cap) break;
    if (seen.has(row.track.trackId)) continue;
    seen.add(row.track.trackId);
    merged.push(row.track);
  }

  const outputTracks = merged.slice(0, cap);
  const classLookup = (trackId: string) => opts.classMap.get(trackId) ?? null;
  const genreEligibleSnap = histogramFamiliesForTracks(genreEligible, classLookup, "blended_genre_eligible");
  const genreLaneSnap = histogramFamiliesForTracks(genreLanePicked, classLookup, "blended_genre_match_lane");
  const mergedSnap = histogramFamiliesForTracks(outputTracks, classLookup, "blended_merged_pool");

  return {
    tracks: outputTracks,
    diagnostics: {
      inputCount: opts.tracks.length,
      outputCount: outputTracks.length,
      lanes: laneCounts,
      relaxationStep: selectedStep.label,
      targetCount,
      familyFunnel: {
        genreEligibleRaw: genreEligibleSnap,
        genreLanePicked: genreLaneSnap,
        mergedPool: mergedSnap,
        genreFitEligibleCount: genreEligible.length,
        genreLaneQuota: genreQuota,
        relaxedGenreFamilies: families,
        normalizedIntentFamilies: families.map((f) => getGenreFamily(f)),
      },
    },
  };
}
