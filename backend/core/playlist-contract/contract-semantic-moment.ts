/**
 * V46 — Semantic moment evidence for contract axis scoring.
 * Blends track semantic profiles with audio features; contrastive poles for negation axes.
 */

import { enrichTrackSemanticProfile, type EnrichmentTrackInput } from "../../lib/track-semantic-enrichment";
import type { TrackSemanticProfile } from "../../lib/track-semantic-types";
import type { ContractAuthoritativeTrack } from "./contract-authoritative-retrieval";

/** Low-valence, danceable, high-motion tracks — sad party bangers, not techno spam. */
export function isEmotionalBangerAudioProfile(
  energy: number,
  valence: number,
  danceability: number,
): boolean {
  return valence < 0.48 && energy > 0.6 && danceability > 0.46;
}

function textSpamPenalty(text: string): number {
  if (/\bcheesy|cheesey|novelty|eurovision|kidz bop|gummy bear|party all the time\b/.test(text)) {
    return 0.55;
  }
  if (/\bsped up|slowed \+ reverb|phonk|stutter techno|tiktok|vip mix|club mix|\bvip\b|\btechno\b.*\bremix\b/.test(text)) {
    return 0.38;
  }
  return 0;
}

/** Harmonic mean — both axes must contribute; stricter than geometric mean alone. */
export function harmonicAxisIntersection(a: number, b: number): number {
  if (a <= 0 || b <= 0) return 0;
  return (2 * a * b) / (a + b);
}

/** Compound intersection: geometric when balanced; shifts toward harmonic when imbalanced. */
export function compoundIntersectionStrength(
  a: number,
  b: number,
  opts?: { emotionalBanger?: boolean },
): number {
  const geometric = Math.sqrt(Math.max(0, a) * Math.max(0, b));
  const weak = Math.min(a, b);
  const strong = Math.max(a, b);
  const imbalance = strong > 0 ? (strong - weak) / strong : 0;
  const harmonic = harmonicAxisIntersection(a, b);
  // Sad bangers legitimately skew party_energy > melancholy — don't over-penalise imbalance.
  if (opts?.emotionalBanger && weak >= 0.3 && strong >= 0.38) {
    return geometric * (1 - imbalance * 0.22) + harmonic * (imbalance * 0.22);
  }
  return geometric * (1 - imbalance * 0.58) + harmonic * (imbalance * 0.58);
}

type AxisSemanticSpec = {
  atmospheres?: string[];
  themes?: string[];
  activities?: string[];
  sceneConcepts?: string[];
  narrativeTags?: string[];
  culturalContextTags?: string[];
  emotionalMovement?: string[];
  intensityCurve?: string[];
  /** Semantic poles to suppress on contrastive (not_*) axes. */
  unwantedConcepts?: string[];
  unwantedAtmospheres?: string[];
  unwantedNarrative?: string[];
};

const AXIS_SEMANTIC_SPECS: Record<string, AxisSemanticSpec> = {
  melancholy: {
    atmospheres: ["melancholic", "reflective", "lonely", "foreboding", "bittersweet"],
    themes: ["loss", "regret", "longing"],
    narrativeTags: ["melancholy-thread", "emotional-weight", "bittersweet-arc"],
    unwantedAtmospheres: ["euphoric"],
  },
  party_energy: {
    atmospheres: ["euphoric", "danceable", "bittersweet"],
    themes: ["party", "celebration"],
    activities: ["dancing"],
    culturalContextTags: ["club-scene", "high-motion-scene"],
    narrativeTags: ["momentum", "emotional-release"],
    emotionalMovement: ["pulse", "arc"],
  },
  high_energy: {
    culturalContextTags: ["high-motion-scene"],
    narrativeTags: ["momentum"],
    emotionalMovement: ["pulse", "arc"],
    intensityCurve: ["high", "variable"],
  },
  low_energy: {
    culturalContextTags: ["low-motion-scene", "ambient-scene", "spacious-listening"],
    emotionalMovement: ["static"],
    intensityCurve: ["low"],
  },
  not_cheesy: {
    narrativeTags: ["melancholy-thread", "nocturnal-narrative"],
    unwantedConcepts: ["warehouse-rave"],
  },
  not_boring: {
    narrativeTags: ["melancholy-thread", "tension-build", "nocturnal-narrative", "momentum"],
    emotionalMovement: ["pulse", "evolving", "arc"],
    unwantedNarrative: ["steady-flow"],
  },
};

function tagRecall(expected: string[], actual: string[]): number {
  if (expected.length === 0) return 0;
  const set = new Set(actual.map((t) => t.toLowerCase()));
  const hits = expected.filter((t) => set.has(t.toLowerCase())).length;
  return hits / expected.length;
}

function collectProfileTags(profile: TrackSemanticProfile): {
  atmospheres: string[];
  themes: string[];
  activities: string[];
  sceneConcepts: string[];
  narrativeTags: string[];
  culturalContextTags: string[];
  emotionalMovement: string[];
  intensityCurve: string[];
} {
  const ms = profile.musicSemantic;
  return {
    atmospheres: profile.scene.atmospheres,
    themes: profile.themes,
    activities: profile.scene.activities,
    sceneConcepts: profile.sceneConcepts,
    narrativeTags: ms.narrativeTags,
    culturalContextTags: [...ms.culturalContextTags, ...ms.culturalTags],
    emotionalMovement: ms.emotionalMovement ? [ms.emotionalMovement] : [],
    intensityCurve: ms.intensityCurve ? [ms.intensityCurve] : [],
  };
}

function scoreSemanticEvidence(profile: TrackSemanticProfile, spec: AxisSemanticSpec): number {
  const tags = collectProfileTags(profile);
  const parts: number[] = [];

  if (spec.atmospheres?.length) parts.push(tagRecall(spec.atmospheres, tags.atmospheres));
  if (spec.themes?.length) parts.push(tagRecall(spec.themes, tags.themes));
  if (spec.activities?.length) parts.push(tagRecall(spec.activities, tags.activities));
  if (spec.sceneConcepts?.length) parts.push(tagRecall(spec.sceneConcepts, tags.sceneConcepts));
  if (spec.narrativeTags?.length) parts.push(tagRecall(spec.narrativeTags, tags.narrativeTags));
  if (spec.culturalContextTags?.length) parts.push(tagRecall(spec.culturalContextTags, tags.culturalContextTags));
  if (spec.emotionalMovement?.length) parts.push(tagRecall(spec.emotionalMovement, tags.emotionalMovement));
  if (spec.intensityCurve?.length) parts.push(tagRecall(spec.intensityCurve, tags.intensityCurve));

  if (parts.length === 0) return 0;
  const raw = parts.reduce((sum, p) => sum + p, 0) / parts.length;
  return Math.min(0.92, raw * 0.72 + (parts.some((p) => p >= 0.5) ? 0.18 : 0));
}

export function scoreUnwantedPoleForAxis(
  profile: TrackSemanticProfile | null | undefined,
  dimensionId: string,
): number {
  if (!profile) return 0;
  const spec = AXIS_SEMANTIC_SPECS[dimensionId];
  if (!spec) return 0;
  return scoreUnwantedPole(profile, spec);
}

function scoreUnwantedPole(profile: TrackSemanticProfile, spec: AxisSemanticSpec): number {
  const tags = collectProfileTags(profile);
  const parts: number[] = [];

  if (spec.unwantedConcepts?.length) parts.push(tagRecall(spec.unwantedConcepts, tags.sceneConcepts));
  if (spec.unwantedAtmospheres?.length) parts.push(tagRecall(spec.unwantedAtmospheres, tags.atmospheres));
  if (spec.unwantedNarrative?.length) parts.push(tagRecall(spec.unwantedNarrative, tags.narrativeTags));

  if (parts.length === 0) return 0;
  return Math.min(1, parts.reduce((max, p) => Math.max(max, p), 0));
}

/** Score how well track semantic profile supports a contract dimension. */
export function scoreSemanticAxisEvidence(
  profile: TrackSemanticProfile | null | undefined,
  dimensionId: string,
): number {
  if (!profile) return 0;
  const spec = AXIS_SEMANTIC_SPECS[dimensionId];
  if (!spec) return 0;

  let score = scoreSemanticEvidence(profile, spec);
  const unwanted = scoreUnwantedPole(profile, spec);

  if (dimensionId.startsWith("not_")) {
    score = Math.max(score, 0.35 * (1 - unwanted));
    if (dimensionId === "not_cheesy") score -= unwanted * 0.22;
    else score -= unwanted * 0.35;
  } else {
    score -= unwanted * 0.38;
  }

  if (dimensionId === "melancholy") {
    const hasMelancholySignal =
      tagsInclude(profile.scene.atmospheres, "melancholic") ||
      tagsInclude(profile.scene.atmospheres, "bittersweet") ||
      tagsInclude(profile.musicSemantic.narrativeTags, "melancholy-thread") ||
      tagsInclude(profile.musicSemantic.narrativeTags, "bittersweet-arc");
    const clubOnly =
      tagsInclude(profile.musicSemantic.culturalContextTags, "club-scene") &&
      !hasMelancholySignal &&
      !tagsInclude(profile.scene.atmospheres, "reflective");
    if (clubOnly) score = Math.max(0, score - 0.22);
    const ms = profile.musicSemantic;
    const emotionalBangerMotion =
      (ms.emotionalMovement === "pulse" || ms.emotionalMovement === "arc") &&
      (tagsInclude(profile.scene.atmospheres, "danceable") ||
        tagsInclude(ms.narrativeTags, "emotional-release"));
    if (emotionalBangerMotion && hasMelancholySignal) score = Math.min(0.92, score + 0.14);
  }

  if (dimensionId === "party_energy") {
    const hasMelancholyPartner =
      tagsInclude(profile.scene.atmospheres, "melancholic") ||
      tagsInclude(profile.scene.atmospheres, "bittersweet") ||
      tagsInclude(profile.musicSemantic.narrativeTags, "melancholy-thread");
    const pulseOnly =
      profile.musicSemantic.emotionalMovement === "pulse" &&
      !tagsInclude(profile.scene.atmospheres, "euphoric") &&
      !tagsInclude(profile.themes, "party") &&
      !hasMelancholyPartner;
    if (pulseOnly) score *= 0.72;
    if (hasMelancholyPartner && tagsInclude(profile.scene.atmospheres, "danceable")) {
      score = Math.min(0.92, score + 0.12);
    }
  }

  return Math.max(0, Math.min(0.95, score));
}

function tagsInclude(tags: string[], needle: string): boolean {
  const n = needle.toLowerCase();
  return tags.some((t) => t.toLowerCase() === n || t.toLowerCase().includes(n));
}

/** Generic contrastive penalty from soft mustNot negations (cheesy, boring, etc.). */
export function contrastiveNegationPenalty(
  profile: TrackSemanticProfile | null | undefined,
  trackText: string,
  negationValue: string,
): number {
  const lower = negationValue.toLowerCase();
  if (lower === "cheesy") {
    return Math.max(textSpamPenalty(trackText), scoreUnwantedPole(profile!, AXIS_SEMANTIC_SPECS.not_cheesy ?? {}));
  }
  if (lower === "boring") {
    if (!profile) return 0;
    const flat =
      profile.musicSemantic.emotionalMovement === "static" &&
      profile.musicSemantic.intensityCurve === "low" &&
      profile.musicSemantic.narrativeTags.length === 0;
    return flat ? 0.55 : scoreUnwantedPole(profile, AXIS_SEMANTIC_SPECS.not_boring ?? {});
  }
  return 0;
}

export function buildTrackSemanticProfileForContract(
  track: ContractAuthoritativeTrack,
  classification: { genreFamily?: string | null; genrePrimary?: string | null } | null,
): TrackSemanticProfile {
  const input: EnrichmentTrackInput = {
    trackId: track.trackId,
    trackName: track.trackName ?? "",
    artistName: track.artistName ?? "",
    albumName: track.albumName ?? null,
    energy: track.energy,
    valence: track.valence,
    danceability: track.danceability,
    acousticness: track.acousticness,
    instrumentalness: track.instrumentalness,
    releaseYear: track.releaseYear ?? null,
    spotifyArtistGenres: classification?.genreFamily ? [classification.genreFamily] : undefined,
  };
  return enrichTrackSemanticProfile(input);
}

/** Blend audio-feature axis score with semantic profile evidence. */
export function blendAxisWithSemanticMoment(
  audioScore: number,
  semanticScore: number,
  dimensionId: string,
  unwantedPole = 0,
): number {
  const isContrastive = dimensionId.startsWith("not_");
  const hasSemanticSignal = semanticScore >= 0.28;
  const hasUnwantedSignal = unwantedPole >= 0.5;

  if (hasUnwantedSignal && isContrastive) {
    const penalty = unwantedPole * 0.28;
    return Math.max(0.06, audioScore - penalty);
  }

  if (hasUnwantedSignal && !isContrastive) {
    const penalty = unwantedPole * 0.22;
    return Math.max(0.06, audioScore - penalty);
  }

  if (!hasSemanticSignal) {
    return Math.max(0.06, Math.min(0.92, audioScore));
  }

  const semanticWeight = isContrastive ? 0.38 : 0.34;
  const blended = audioScore * (1 - semanticWeight) + semanticScore * semanticWeight;
  return Math.max(0.06, Math.min(0.92, blended));
}
