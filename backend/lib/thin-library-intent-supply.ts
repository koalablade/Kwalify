/**
 * Intent-preserving supply estimator for thin-library policy.
 * Separate from orchestration's estimateValidCandidateSupply — does not count
 * broad relaxed/recovery lanes when explicit genre or era intent is locked.
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
import {
  buildSubgenreEvidenceGraph,
  normalizeSubgenreTerm,
  trackSubgenreIsExplicitlyExcluded,
  type SubgenreIntentContext,
} from "./genre-subgenre-adjacency";
import type { SupplyTrackInput } from "./library-valid-candidate-supply";

export type EraConstraintInput = {
  eraStart?: number | null;
  eraEnd?: number | null;
  eraRange?: { start: number; end: number } | null;
};

export function hasEraConstraint(intent: EraConstraintInput): boolean {
  return intent.eraRange != null || intent.eraStart != null || intent.eraEnd != null;
}

export type ThinLibraryIntentSupplyInput = {
  tracks: SupplyTrackInput[];
  vibe: string;
  intent: ActivityIntentInput &
    EraConstraintInput &
    SubgenreIntentContext & {
      primaryGenres?: string[];
      primaryGenre?: string | null;
      mood?: string[];
      energyLevel?: string | null;
    };
  emotionProfile?: EmotionProfile;
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>;
  requestedLength: number;
};

export type ThinLibraryDiagnostics = {
  requestedLength: number;
  strictSupply: number;
  adjacentSupply: number;
  intentPreservingSupply: number;
  relaxedSupply: number;
  excludedRelaxedSupply: number;
  recoverySupply: number;
  maxAchievableReason: string;
};

export type ThinLibraryIntentSupply = ThinLibraryDiagnostics & {
  maxAchievable: number;
  hasExplicitGenreIntent: boolean;
  eraConstrained: boolean;
};

function classifyFor(
  track: SupplyTrackInput,
  classMap: ThinLibraryIntentSupplyInput["classMap"],
): ActivityClassificationInput {
  return classMap.get(track.trackId) ?? null;
}

function genreExpectations(
  intent: ThinLibraryIntentSupplyInput["intent"],
  vibe: string,
): string[] {
  const families = new Set<string>();
  for (const family of intent.genreFamilies ?? []) families.add(family);
  for (const genre of intent.primaryGenres ?? []) families.add(genre);
  if (intent.primaryGenre) families.add(intent.primaryGenre);
  if (/\b(?:pop[\s-]?punk|punk|rock|metal|disco|garage|hip.?hop|rap|electronic|house|techno|latin|reggaeton|salsa|folk|acoustic)\b/i.test(vibe)) {
    if (/\blatin|reggaeton|salsa\b/i.test(vibe)) families.add("latin");
    if (/\bpop[\s-]?punk|punk\b/i.test(vibe)) families.add("rock");
    if (/\bdisco\b/i.test(vibe)) families.add("soul");
    if (/\bgarage\b/i.test(vibe)) families.add("electronic");
    if (/\bacoustic|folk\b/i.test(vibe)) families.add("folk");
  }
  return [...families];
}

function classificationTerms(classification: ActivityClassificationInput): string[] {
  if (!classification) return [];
  return [
    classification.genreFamily,
    classification.genrePrimary,
    classification.primarySubgenre,
    classification.secondarySubgenre,
    ...(classification.subGenres ?? []),
  ]
    .filter(Boolean)
    .map((term) => normalizeSubgenreTerm(String(term)));
}

function trackMatchesGenreFamily(
  classification: ActivityClassificationInput,
  expectations: string[],
): boolean {
  if (expectations.length === 0) return true;
  const family = classification?.genreFamily ?? "unknown";
  const primary = classification?.genrePrimary ?? "";
  const sub = classification?.primarySubgenre ?? "";
  const terms = classificationTerms(classification);
  return expectations.some((expected) => {
    const norm = normalizeSubgenreTerm(expected);
    return (
      family === expected
      || family === norm
      || primary === expected
      || primary === norm
      || sub === expected
      || sub === norm
      || terms.includes(norm)
    );
  });
}

function trackMatchesEra(
  track: SupplyTrackInput,
  intent: EraConstraintInput,
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
  intent: ActivityIntentInput,
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

function matchesSubgenreTerm(terms: string[], target: string): boolean {
  const norm = normalizeSubgenreTerm(target);
  return terms.some((term) => term === norm || term.includes(norm) || norm.includes(term));
}

function trackMatchesCanonicalSubgenre(
  classification: ActivityClassificationInput,
  graph: ReturnType<typeof buildSubgenreEvidenceGraph>,
): boolean {
  if (graph.canonical.length === 0) return true;
  const terms = classificationTerms(classification);
  return graph.canonical.some((term) => matchesSubgenreTerm(terms, term));
}

function hasWeakSubgenreLabel(classification: ActivityClassificationInput): boolean {
  const sub = classification?.primarySubgenre;
  return !sub || sub === "unknown";
}

function hasConflictingSubgenreLabel(
  classification: ActivityClassificationInput,
  graph: ReturnType<typeof buildSubgenreEvidenceGraph>,
): boolean {
  if (hasWeakSubgenreLabel(classification)) return false;
  const terms = classificationTerms(classification);
  if (trackMatchesCanonicalSubgenre(classification, graph)) return false;
  return !graph.adjacent.some((term) => matchesSubgenreTerm(terms, term));
}

function trackCountsAsIntentPreservingStrict(
  baseIntentFit: boolean,
  classification: ActivityClassificationInput,
  graph: ReturnType<typeof buildSubgenreEvidenceGraph>,
): boolean {
  if (!baseIntentFit) return false;
  if (graph.lockedTerms.length === 0) return true;
  return trackMatchesCanonicalSubgenre(classification, graph);
}

function trackCountsAsIntentPreservingAdjacent(
  baseIntentFit: boolean,
  classification: ActivityClassificationInput,
  intent: SubgenreIntentContext,
  graph: ReturnType<typeof buildSubgenreEvidenceGraph>,
): boolean {
  if (!baseIntentFit) return false;
  if (graph.lockedTerms.length === 0) return false;
  if (trackMatchesCanonicalSubgenre(classification, graph)) return false;
  if (graph.adjacent.length === 0) return false;
  const terms = classificationTerms(classification);
  if (trackSubgenreIsExplicitlyExcluded(terms, intent)) return false;
  return graph.adjacent.some((term) => matchesSubgenreTerm(terms, term));
}

function hasExplicitGenreIntent(
  intent: ThinLibraryIntentSupplyInput["intent"],
  expectations: string[],
): boolean {
  return (
    expectations.length > 0
    || !!intent.primarySubgenre
    || (intent.subgenreTerms?.length ?? 0) > 0
    || (intent.primaryGenres?.length ?? 0) > 0
    || !!intent.primaryGenre
  );
}

/**
 * Count intent-preserving library supply for thin-library policy.
 * Does not mutate orchestration supply estimates.
 */
export function estimateThinLibraryIntentSupply(
  opts: ThinLibraryIntentSupplyInput,
): ThinLibraryIntentSupply {
  const expectations = genreExpectations(opts.intent, opts.vibe);
  const explicitGenre = hasExplicitGenreIntent(opts.intent, expectations);
  const eraConstrained = hasEraConstraint(opts.intent);
  const graph = buildSubgenreEvidenceGraph({
    primarySubgenre: opts.intent.primarySubgenre ?? null,
    secondarySubgenre: opts.intent.secondarySubgenre ?? null,
    subgenreTerms: opts.intent.subgenreTerms ?? [],
    genreFamilies: opts.intent.genreFamilies ?? [],
  });

  const sample = opts.tracks.length > 2400
    ? opts.tracks.filter((_, index) => index % Math.ceil(opts.tracks.length / 2400) === 0)
    : opts.tracks;

  let strictSample = 0;
  let adjacentOnlySample = 0;
  let eraIntentStrictSample = 0;
  let relaxedBroadSample = 0;
  let recoveryBroadSample = 0;

  for (const track of sample) {
    const classification = classifyFor(track, opts.classMap);
    const familyOk = trackMatchesGenreFamily(classification, expectations);
    const eraStrict = trackMatchesEra(track, opts.intent, false);
    const eraRelaxed = trackMatchesEra(track, opts.intent, true);
    const strictActivity = trackPassesStrictActivity(track, classification, opts.vibe, opts.intent);
    const relaxedActivity = trackPassesRelaxedActivity(track, opts.intent);

    const baseIntentFit = familyOk && eraStrict && strictActivity;
    if (baseIntentFit) eraIntentStrictSample += 1;
    const strictTier = trackCountsAsIntentPreservingStrict(baseIntentFit, classification, graph);
    const adjacentTier = trackCountsAsIntentPreservingAdjacent(baseIntentFit, classification, opts.intent, graph);

    if (strictTier) strictSample += 1;
    else if (adjacentTier) adjacentOnlySample += 1;
    else if (baseIntentFit && graph.lockedTerms.length > 0 && !hasConflictingSubgenreLabel(classification, graph)) {
      strictSample += 1;
    }

    // Broad relaxed (orchestrator-style) — for diagnostics / exclusion math only
    const broadRelaxed = relaxedActivity
      && (expectations.length === 0 || familyOk || relaxedActivity)
      && eraRelaxed;
    if (broadRelaxed) relaxedBroadSample += 1;

    const broadRecovery = relaxedActivity && eraRelaxed;
    if (broadRecovery) recoveryBroadSample += 1;
  }

  const scale = opts.tracks.length > 0 ? opts.tracks.length / Math.max(1, sample.length) : 1;
  const strictSupply = Math.round(strictSample * scale);
  const adjacentSupply = Math.round(adjacentOnlySample * scale);
  const eraIntentStrictSupply = Math.round(eraIntentStrictSample * scale);
  let intentPreservingSupply = strictSupply + adjacentSupply;
  if (eraConstrained && intentPreservingSupply === 0 && eraIntentStrictSupply > 0) {
    intentPreservingSupply = eraIntentStrictSupply;
  }
  const relaxedSupply = Math.round(relaxedBroadSample * scale);
  const recoverySupply = Math.round(recoveryBroadSample * scale);

  const excludedRelaxedSupply = explicitGenre || eraConstrained
    ? Math.max(0, relaxedSupply - intentPreservingSupply)
    : Math.max(0, relaxedSupply - intentPreservingSupply);

  let maxAchievable: number;
  let maxAchievableReason: string;

  if (explicitGenre) {
    maxAchievable = Math.min(opts.requestedLength, intentPreservingSupply);
    maxAchievableReason = expectations.length > 0
      ? `explicit ${expectations.join("/")} intent prevents broad relaxed supply`
      : "explicit genre intent prevents broad relaxed supply";
    if (eraConstrained && strictSupply + adjacentSupply === 0 && eraIntentStrictSupply > 0) {
      maxAchievableReason = "era constraint uses genre+era+activity strict supply when subgenre labels are sparse";
    }
  } else if (eraConstrained) {
    // Era-locked: only era-strict intent-preserving supply counts (not broad recovery)
    const eraPreserving = strictSupply + adjacentSupply;
    maxAchievable = Math.min(opts.requestedLength, eraPreserving);
    maxAchievableReason = "era constraint prevents broad recovery supply";
  } else {
    // Mood/scene prompts without hard genre lock — intent-preserving still preferred
    maxAchievable = Math.min(
      opts.requestedLength,
      Math.max(intentPreservingSupply, strictSupply),
    );
    maxAchievableReason = intentPreservingSupply >= opts.requestedLength
      ? "intent_preserving_supply_adequate"
      : "intent_preserving_supply";
  }

  return {
    requestedLength: opts.requestedLength,
    strictSupply: intentPreservingSupply === eraIntentStrictSupply && strictSupply === 0
      ? eraIntentStrictSupply
      : strictSupply,
    adjacentSupply,
    intentPreservingSupply,
    relaxedSupply,
    excludedRelaxedSupply,
    recoverySupply,
    maxAchievable,
    maxAchievableReason,
    hasExplicitGenreIntent: explicitGenre,
    eraConstrained,
  };
}
