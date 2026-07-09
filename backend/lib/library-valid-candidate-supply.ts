/**
 * Estimates how many library tracks can realistically fill a playlist under
 * strict vs relaxed prompt-fit gates. Used by retrieval orchestration and
 * finalization recovery to avoid empty success responses when supply exists.
 */

import type { EmotionProfile } from "./emotion";
import {
  resolveActivityProfile,
  scoreActivityCandidateFit,
  trackFailsActivityHardGate,
  type ActivityClassificationInput,
  type ActivityIntentInput,
  type ActivityTrackInput,
} from "./activity-profiles";

export type SupplyTrackInput = ActivityTrackInput & {
  trackId: string;
  trackName?: string;
  artistName?: string;
  releaseYear?: number | null;
};

export type ValidCandidateSupply = {
  requestedLength: number;
  minRequired: number;
  strictValidCount: number;
  relaxedValidCount: number;
  recoveryValidCount: number;
  sufficient: boolean;
  supplyRatio: number;
  limitingDimensions: string[];
};

export type EstimateValidCandidateSupplyOpts<T extends SupplyTrackInput> = {
  tracks: T[];
  vibe: string;
  intent: ActivityIntentInput & {
    activity?: string | null;
    genreFamilies?: string[];
    primaryGenres?: string[];
    primaryGenre?: string | null;
    mood?: string[];
    energyLevel?: string | null;
    eraStart?: number | null;
    eraEnd?: number | null;
    eraRange?: { start: number; end: number } | null;
  };
  emotionProfile: EmotionProfile;
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>;
  requestedLength: number;
};

export function minRequiredValidCandidates(requestedLength: number): number {
  return Math.max(5, Math.ceil(requestedLength * 0.4));
}

function classifyFor<T extends SupplyTrackInput>(
  track: T,
  classMap: EstimateValidCandidateSupplyOpts<T>["classMap"],
): ActivityClassificationInput {
  return classMap.get(track.trackId) ?? null;
}

function genreExpectations(intent: EstimateValidCandidateSupplyOpts<SupplyTrackInput>["intent"], vibe: string): string[] {
  const families = new Set<string>();
  for (const family of intent.genreFamilies ?? []) families.add(family);
  for (const genre of intent.primaryGenres ?? []) families.add(genre);
  if (intent.primaryGenre) families.add(intent.primaryGenre);
  if (/\b(?:pop[\s-]?punk|punk|rock|metal|disco|garage|hip.?hop|rap|electronic|house|techno)\b/i.test(vibe)) {
    if (/\bpop[\s-]?punk|punk\b/i.test(vibe)) families.add("rock");
    if (/\bdisco\b/i.test(vibe)) families.add("soul");
    if (/\bgarage\b/i.test(vibe)) families.add("electronic");
  }
  return [...families];
}

function trackMatchesGenreExpectation(
  track: SupplyTrackInput,
  classification: ActivityClassificationInput,
  expectations: string[],
): boolean {
  if (expectations.length === 0) return true;
  const family = classification?.genreFamily ?? "unknown";
  const primary = classification?.genrePrimary ?? "";
  const sub = classification?.primarySubgenre ?? "";
  return expectations.some((expected) => family === expected || primary === expected || sub === expected);
}

function trackMatchesEra(
  track: SupplyTrackInput,
  intent: EstimateValidCandidateSupplyOpts<SupplyTrackInput>["intent"],
  relaxed = false,
): boolean {
  const start = intent.eraRange?.start ?? intent.eraStart;
  const end = intent.eraRange?.end ?? intent.eraEnd;
  if (start == null || end == null) return true;
  const year = track.releaseYear;
  if (year == null || !Number.isFinite(year)) return relaxed;
  const pad = relaxed ? 8 : 3;
  return year >= start - pad && year <= end + pad;
}

function trackPassesStrictActivity(
  track: SupplyTrackInput,
  classification: ActivityClassificationInput,
  vibe: string,
  intent: ActivityIntentInput,
): boolean {
  const profile = resolveActivityProfile(vibe, intent);
  if (!profile) return true;
  if (trackFailsActivityHardGate(track, classification, profile, vibe)) return false;
  return scoreActivityCandidateFit(track, classification, profile, vibe) >= 0.52;
}

function trackPassesRelaxedActivity(
  track: SupplyTrackInput,
  intent: EstimateValidCandidateSupplyOpts<SupplyTrackInput>["intent"],
): boolean {
  const energy = track.energy ?? null;
  const tempo = track.tempo ?? null;
  const danceability = track.danceability ?? null;
  const activity = intent.activity;
  if (!activity && !intent.energyLevel) return true;
  if (activity === "gym") {
    return (energy !== null && energy >= 0.52) || (tempo !== null && tempo >= 105) || (danceability !== null && danceability >= 0.54);
  }
  if (activity === "party") {
    return (energy !== null && energy >= 0.55) || (danceability !== null && danceability >= 0.58);
  }
  if (activity === "focus" || activity === "study") {
    return (energy == null || energy <= 0.68) && (danceability == null || danceability <= 0.78);
  }
  if (activity === "driving") {
    return (energy == null || energy >= 0.38) && (tempo == null || tempo >= 80);
  }
  if (intent.energyLevel === "high") {
    return (energy !== null && energy >= 0.58) || (tempo !== null && tempo >= 118);
  }
  if (intent.energyLevel === "low") {
    return energy == null || energy <= 0.55;
  }
  return true;
}

export function trackPassesRecoveryActivity(
  track: SupplyTrackInput,
  intent: EstimateValidCandidateSupplyOpts<SupplyTrackInput>["intent"],
): boolean {
  const energy = track.energy ?? null;
  const tempo = track.tempo ?? null;
  const danceability = track.danceability ?? null;
  if (intent.activity === "gym") {
    return (energy !== null && energy >= 0.48) || (tempo !== null && tempo >= 100) || (danceability !== null && danceability >= 0.5);
  }
  if (intent.activity === "party") {
    return (energy !== null && energy >= 0.48) || (danceability !== null && danceability >= 0.5);
  }
  return trackPassesRelaxedActivity(track, intent);
}

export function estimateValidCandidateSupply<T extends SupplyTrackInput>(
  opts: EstimateValidCandidateSupplyOpts<T>,
): ValidCandidateSupply {
  const expectations = genreExpectations(opts.intent, opts.vibe);
  const minRequired = minRequiredValidCandidates(opts.requestedLength);
  const sample = opts.tracks.length > 2400
    ? opts.tracks.filter((_, index) => index % Math.ceil(opts.tracks.length / 2400) === 0)
    : opts.tracks;

  let strictValidCount = 0;
  let relaxedValidCount = 0;
  let recoveryValidCount = 0;

  for (const track of sample) {
    const classification = classifyFor(track, opts.classMap);
    const genreOk = trackMatchesGenreExpectation(track, classification, expectations);
    const eraStrict = trackMatchesEra(track, opts.intent, false);
    const eraRelaxed = trackMatchesEra(track, opts.intent, true);

    const strictActivity = trackPassesStrictActivity(track, classification, opts.vibe, opts.intent);
    const relaxedActivity = trackPassesRelaxedActivity(track, opts.intent);
    const recoveryActivity = trackPassesRecoveryActivity(track, opts.intent);

    if (strictActivity && genreOk && eraStrict) strictValidCount += 1;
    if (relaxedActivity && (expectations.length === 0 || genreOk || relaxedActivity) && eraRelaxed) relaxedValidCount += 1;
    if (recoveryActivity && eraRelaxed) recoveryValidCount += 1;
  }

  const scale = opts.tracks.length > 0 ? opts.tracks.length / Math.max(1, sample.length) : 1;
  const scaledStrict = Math.round(strictValidCount * scale);
  const scaledRelaxed = Math.round(relaxedValidCount * scale);
  const scaledRecovery = Math.round(recoveryValidCount * scale);
  const limitingDimensions: string[] = [];

  if (scaledStrict < minRequired) limitingDimensions.push("insufficient_strict_valid_candidates");
  if (scaledRelaxed < minRequired) limitingDimensions.push("insufficient_relaxed_valid_candidates");
  if (scaledRecovery < Math.max(5, Math.ceil(opts.requestedLength * 0.25))) {
    limitingDimensions.push("insufficient_recovery_valid_candidates");
  }
  if (expectations.length > 0 && scaledStrict < minRequired) limitingDimensions.push("genre_or_era_supply_gap");

  return {
    requestedLength: opts.requestedLength,
    minRequired,
    strictValidCount: scaledStrict,
    relaxedValidCount: scaledRelaxed,
    recoveryValidCount: scaledRecovery,
    sufficient: scaledRelaxed >= minRequired,
    supplyRatio: minRequired > 0 ? Math.round((scaledStrict / minRequired) * 100) / 100 : 1,
    limitingDimensions,
  };
}

export function rankSupplyAwareRecoveryCandidates<T extends SupplyTrackInput & { score?: number }>(
  candidates: T[],
  opts: EstimateValidCandidateSupplyOpts<T> & {
    frequencyPenalty?: Map<string, number>;
  },
): T[] {
  const expectations = genreExpectations(opts.intent, opts.vibe);
  const profile = resolveActivityProfile(opts.vibe, opts.intent);
  return [...candidates]
    .filter((track) => trackPassesRecoveryActivity(track, opts.intent))
    .map((track) => {
      const classification = classifyFor(track, opts.classMap);
      const genreFit = trackMatchesGenreExpectation(track, classification, expectations) ? 0.22 : 0;
      const eraFit = trackMatchesEra(track, opts.intent, true) ? 0.12 : 0;
      const activityFit = profile
        ? scoreActivityCandidateFit(track, classification, profile, opts.vibe)
        : 0.45;
      const baseScore = typeof track.score === "number" ? track.score : 0.35;
      const freqMultiplier = opts.frequencyPenalty?.get(track.trackId) ?? 1;
      const composite = (activityFit * 0.62 + baseScore * 0.28 + genreFit + eraFit) * freqMultiplier;
      return { track, composite };
    })
    .sort((a, b) => b.composite - a.composite)
    .map((row) => row.track);
}
