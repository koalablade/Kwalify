/**
 * Product promise in one object:
 * where · doing · feeling · destination · your library as soundtrack
 */

import type { EmotionProfile } from "./emotion";
import type { JourneyArc } from "./emotion-destination";
import type { DestinationParse } from "./emotion-destination";
import type { SurpriseMix } from "./human-surprise";
import type { RediscoveryMode } from "./forgotten-favourites";
import type { GenerationExplanation } from "./vibe-explanation";

export interface MomentUnderstanding {
  /** One-line generation promise for API consumers. */
  promise: string;
  /** Where you are — time, place, scene. */
  where: {
    time: string | null;
    place: string | null;
    scene: string | null;
    season: string | null;
    social: string | null;
  };
  /** What you're doing. */
  doing: {
    motion: string | null;
    summary: string | null;
  };
  /** How you're feeling now. */
  feeling: {
    current: string | null;
    mixed: string[];
    energy: number;
    valence: number;
  };
  /** Where you want to go emotionally. */
  destination: {
    desired: string | null;
    journeyArc: JourneyArc;
    arcDescription: string;
  };
  /** Soundtrack from your own liked songs. */
  soundtrack: {
    source: "liked_songs";
    librarySize: number;
    tracksSelected: number;
    rediscoveryMode: RediscoveryMode;
    usesForgottenFavourites: boolean;
    chapter: string | null;
    surpriseMix: SurpriseMix;
  };
  /** Human-readable summary of what Kwalify understood. */
  summary: string;
}

function label(s: string | null | undefined): string | null {
  if (!s) return null;
  return s.replace(/_/g, " ");
}

function extractFeelingLabels(vibe: string, dest: DestinationParse): {
  current: string | null;
  desired: string | null;
} {
  const lower = vibe.toLowerCase();
  let current: string | null = null;
  let desired: string | null = null;

  const fromTo = lower.match(/\bfrom\s+(\w+)\s+to\s+(\w+)/);
  if (fromTo) {
    current = fromTo[1]!;
    desired = fromTo[2]!;
  }

  const butWant = lower.match(
    /\b(\w+)\s+but\s+(?:want(?:ing)?|need(?:ing)?)\s+(?:to\s+)?(?:feel\s+)?(\w+)/
  );
  if (butWant) {
    current = current ?? butWant[1]!;
    desired = desired ?? butWant[2]!;
  }

  const wantFeel = lower.match(/\b(?:want|need|wanna)\s+(?:to\s+)?(?:feel|be|get)\s+(\w+)/);
  if (wantFeel) desired = desired ?? wantFeel[1]!;

  if (dest.current && !current) current = "present";
  if (dest.desired && !desired) desired = "target state";

  return { current, desired };
}

export function buildMomentUnderstanding(opts: {
  vibe: string;
  profile: EmotionProfile;
  journeyArc: JourneyArc;
  destParse: DestinationParse;
  mixedEmotions: string[];
  explanation: GenerationExplanation;
  experienceScene?: { sceneId: string; label?: string } | null;
  socialContext?: string;
  season?: string;
  librarySize: number;
  tracksSelected: number;
  rediscoveryMode: RediscoveryMode;
  chapterLabel: string | null;
  surpriseMix: SurpriseMix;
  archaeologyActive: boolean;
}): MomentUnderstanding {
  const {
    vibe,
    profile,
    journeyArc,
    destParse,
    mixedEmotions,
    explanation,
    experienceScene,
    librarySize,
    tracksSelected,
    rediscoveryMode,
    chapterLabel,
    surpriseMix,
    archaeologyActive,
  } = opts;

  const feelingLabels = extractFeelingLabels(vibe, destParse);
  const sceneLabel = experienceScene
    ? (experienceScene.label ?? experienceScene.sceneId.replace(/_/g, " "))
    : null;

  const whereParts = [
    label(profile.timeOfDay),
    label(profile.environment),
    sceneLabel,
  ].filter(Boolean);

  const doingSummary = label(profile.motionState);

  const summaryBits: string[] = [];
  if (whereParts.length) summaryBits.push(`Where: ${whereParts.join(", ")}`);
  if (doingSummary) summaryBits.push(`Doing: ${doingSummary}`);
  if (feelingLabels.current || mixedEmotions.length) {
    summaryBits.push(
      `Feeling: ${[feelingLabels.current, ...mixedEmotions].filter(Boolean).join(" · ")}`
    );
  }
  if (feelingLabels.desired) summaryBits.push(`Heading toward: ${feelingLabels.desired}`);
  summaryBits.push(
    `Soundtrack: ${tracksSelected} tracks from your ${librarySize.toLocaleString()} liked songs`
  );

  return {
    promise:
      "Understand where I am, what I'm doing, how I'm feeling, where I want to go emotionally, and use my own music history to soundtrack that moment.",
    where: {
      time: label(profile.timeOfDay),
      place: label(profile.environment),
      scene: sceneLabel,
      season: opts.season ? label(opts.season) : null,
      social: opts.socialContext ? label(opts.socialContext) : null,
    },
    doing: {
      motion: label(profile.motionState),
      summary: doingSummary,
    },
    feeling: {
      current: feelingLabels.current,
      mixed: mixedEmotions,
      energy: Math.round(profile.energy * 100) / 100,
      valence: Math.round(profile.valence * 100) / 100,
    },
    destination: {
      desired: feelingLabels.desired,
      journeyArc,
      arcDescription: explanation.emotionalArc,
    },
    soundtrack: {
      source: "liked_songs",
      librarySize,
      tracksSelected,
      rediscoveryMode,
      usesForgottenFavourites:
        archaeologyActive || rediscoveryMode !== "balanced" || surpriseMix.rediscoveryRatio > 0.15,
      chapter: chapterLabel,
      surpriseMix,
    },
    summary: summaryBits.join(" · "),
  };
}
