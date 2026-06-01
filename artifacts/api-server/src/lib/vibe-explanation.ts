import type { EmotionProfile } from "./emotion";
import type { JourneyArc } from "./emotion-destination";
import type { PromptConfidence } from "./prompt-confidence";
import { describeMatchedConcepts } from "./knowledge-graph";

export interface GenerationExplanation {
  detected: {
    time?: string | null;
    environment?: string | null;
    motion?: string | null;
    experienceScene?: string | null;
    qualities: string[];
    lifeSituation?: string;
    mixedEmotions: string[];
    socialContext?: string;
    season?: string;
  };
  narrative: string;
  journeyArc: JourneyArc;
  emotionalArc: string;
  promptConfidence: PromptConfidence;
  knowledgeConcepts?: string[];
}

const ARC_LABELS: Record<JourneyArc, string> = {
  default: "intro → build → peak → reflection",
  recovery: "heavier start → gradual warmth",
  linear_rise: "steady lift in energy",
  linear_fall: "gentle wind-down",
  slow_burn: "slow deepening",
  peak_release: "build to release",
  wave: "ebb and flow",
};

export function buildGenerationExplanation(opts: {
  profile: EmotionProfile;
  vibe: string;
  journeyArc: JourneyArc;
  experienceScene?: {
    sceneId: string;
    qualities: string[];
    lifeSituation?: string;
  } | null;
  mixedEmotions: string[];
  promptConfidence: PromptConfidence;
  socialContext?: string;
  season?: string;
}): GenerationExplanation {
  const { profile, journeyArc, experienceScene, mixedEmotions, promptConfidence, vibe } = opts;
  const knowledgeConcepts = describeMatchedConcepts(vibe);

  const parts: string[] = [];
  if (experienceScene) {
    parts.push(experienceScene.sceneId.replace(/_/g, " "));
  } else {
    if (profile.timeOfDay) parts.push(profile.timeOfDay.replace(/_/g, " "));
    if (profile.environment) parts.push(profile.environment);
    if (profile.motionState) parts.push(profile.motionState);
  }
  if (mixedEmotions.length) parts.push(mixedEmotions.join(" + "));

  const narrative =
    parts.length > 0
      ? `${parts.join(" · ")} → ${ARC_LABELS[journeyArc] ?? ARC_LABELS.default}`
      : ARC_LABELS[journeyArc] ?? ARC_LABELS.default;

  return {
    detected: {
      time: profile.timeOfDay,
      environment: profile.environment,
      motion: profile.motionState,
      experienceScene: experienceScene?.sceneId ?? null,
      qualities: experienceScene?.qualities ?? [],
      lifeSituation: experienceScene?.lifeSituation,
      mixedEmotions,
      socialContext: opts.socialContext,
      season: opts.season,
    },
    narrative,
    journeyArc,
    emotionalArc: ARC_LABELS[journeyArc] ?? ARC_LABELS.default,
    promptConfidence,
    knowledgeConcepts,
  };
}
