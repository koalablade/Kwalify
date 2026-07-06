import { analyzeMomentPipeline } from "./moment-pipeline";
import { detectMixedEmotions } from "./multi-emotion";
import { detectJourneyArc } from "./emotion";
import { decodeIntent } from "./intent-decoder";
import { buildPlaylistWhySummary } from "./playlist-why-summary";
import { buildPrimaryNarrative } from "./primary-narrative";
import type { VersionedPrimaryNarrative } from "./primary-narrative-schema";
import { computeIdentitySignature } from "./moment-signature";
import { computeEmotionalClarityScore } from "./emotional-clarity-score";
import type { EmotionalSequencePhases } from "./emotional-sequencing";
import type { MomentUnderstanding } from "./moment-understanding";
import { computeSurpriseMix } from "./human-surprise";
import { detectRediscoveryMode } from "./forgotten-favourites";

const FIXED_PHASES: EmotionalSequencePhases = {
  intro: 3,
  build: 5,
  peak: 8,
  cooldown: 4,
};

function stubMomentUnderstanding(
  prompt: string,
  pipeline: ReturnType<typeof analyzeMomentPipeline>
): MomentUnderstanding {
  const mixed = detectMixedEmotions(prompt);
  const journeyArc = detectJourneyArc(prompt, pipeline.profile);
  const rediscoveryMode = detectRediscoveryMode(prompt);

  return {
    promise: "",
    where: {
      time: null,
      place: null,
      scene: pipeline.canonicalScene?.sceneId?.replace(/_/g, " ") ?? null,
      season: null,
      social: null,
    },
    doing: { motion: null, summary: null },
    feeling: {
      current: mixed[0] ?? null,
      mixed,
      energy: pipeline.profile.energy,
      valence: pipeline.profile.valence,
    },
    destination: {
      desired: null,
      journeyArc,
      arcDescription: "",
    },
    soundtrack: {
      source: "liked_songs",
      librarySize: 0,
      tracksSelected: 20,
      rediscoveryMode,
      usesForgottenFavourites: false,
      chapter: null,
      surpriseMix: computeSurpriseMix({
        profile: pipeline.profile,
        vibe: prompt,
        rediscoveryMode,
        archaeology: null,
        journeyArc,
        mode: "balanced",
      }),
    },
    summary: "",
  };
}

export interface PerceptionSnapshot {
  primaryNarrative: VersionedPrimaryNarrative;
  identitySignature: string;
  emotionalClarityScore: number;
}

export const PERCEPTION_FIXED_PHASES = FIXED_PHASES;

/** Same prompt + user context — narrative layer is deterministic today. */
export function buildPerceptionSnapshotForUser(
  prompt: string,
  _userId: string
): PerceptionSnapshot {
  return buildPerceptionSnapshot(prompt);
}

/** Narrative-layer fixture for perception regression tests — no track scoring. */
export function buildPerceptionSnapshot(prompt: string): PerceptionSnapshot {
  const pipeline = analyzeMomentPipeline(prompt);
  const momentUnderstanding = stubMomentUnderstanding(prompt, pipeline);
  const playlistWhy = buildPlaylistWhySummary({
    momentUnderstanding,
    canonicalScene: pipeline.canonicalScene,
    emotionProfile: pipeline.profile,
    intent: pipeline.intent ?? decodeIntent(prompt),
    promptConfidenceTier: "medium",
    sequencePhases: FIXED_PHASES,
  });

  const primaryNarrative = buildPrimaryNarrative(playlistWhy);
  const identitySignature = computeIdentitySignature({
    momentLabel: primaryNarrative.momentLabel,
    sceneId: pipeline.canonicalScene?.sceneId ?? null,
    arcSummary: primaryNarrative.arcSummary,
  });
  const emotionalClarity = computeEmotionalClarityScore({
    primaryNarrative,
    emotionalConsistencyScore: 70,
    signatureStable: true,
  });

  return {
    primaryNarrative,
    identitySignature,
    emotionalClarityScore: emotionalClarity.score,
  };
}
