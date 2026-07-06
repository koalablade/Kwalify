import type { EmotionProfile } from "./emotion";
import type { CanonicalSceneResult } from "./scene-canonicalizer";
import type { MomentUnderstanding } from "./moment-understanding";
import type { IntentDecodeResult } from "./intent-decoder";
import type { EmotionalSequencePhases } from "./emotional-sequencing";

export type EnergyProfileBand = "low" | "med" | "high";

export interface PlaylistWhySummary {
  topSceneMatch: string | null;
  sceneConfidence: number | null;
  dominantEmotion: string | null;
  dominantMomentLabel: string;
  energyProfile: EnergyProfileBand;
  signals: string[];
  summary: string;
  structureExplanation: string;
}

function energyBand(energy: number): EnergyProfileBand {
  if (energy < 0.35) return "low";
  if (energy < 0.65) return "med";
  return "high";
}

function energyLabel(band: EnergyProfileBand): string {
  if (band === "low") return "gentle";
  if (band === "high") return "high";
  return "balanced";
}

function formatSceneId(sceneId: string): string {
  return sceneId.replace(/_/g, " ");
}

const EMOTIONAL_RESET_WORDS = new Set([
  "reflective",
  "melancholy",
  "sad",
  "grief",
  "chaos",
  "anxious",
  "overwhelmed",
  "heartbreak",
]);

const ENERGY_SCENE_HINTS = [
  "drive",
  "out",
  "party",
  "gym",
  "run",
  "dance",
  "hype",
  "road",
  "trip",
];

/** Rule-based moment phrase — no LLM. */
export function energyBandFromProfile(energy: number): EnergyProfileBand {
  return energyBand(energy);
}

export function buildDominantMomentLabel(
  scene: string | null,
  emotion: string,
  band: EnergyProfileBand
): string {
  const sceneText = scene?.toLowerCase() ?? "";
  const emotionLower = emotion.toLowerCase();

  if (
    band === "low" &&
    (EMOTIONAL_RESET_WORDS.has(emotionLower) || /reset|calm|quiet|unwind/.test(sceneText))
  ) {
    const after =
      emotionLower === "chaos" || emotionLower === "overwhelmed"
        ? "after chaos"
        : "reset";
    return `quiet emotional ${after}`;
  }

  if (band === "high") {
    if (ENERGY_SCENE_HINTS.some((h) => sceneText.includes(h))) {
      return scene ? `${scene} energy` : `${emotion} energy`;
    }
    if (/ready|pre|out|going/.test(sceneText)) {
      return scene ? `${scene} energy` : "getting ready to go out energy";
    }
    return scene ? `${scene} ${emotion} energy` : `${emotion} energy`;
  }

  if (scene && emotion) {
    if (/overthink|late night|night/.test(sceneText)) {
      return `${scene} ${emotion}`;
    }
    return `${emotion} ${scene}`;
  }

  if (scene) return scene;
  if (band === "med") return `${emotion} flow`;
  return `${emotion} ${energyLabel(band)} moment`;
}

function buildSummary(
  scene: string | null,
  emotion: string,
  band: EnergyProfileBand
): string {
  const scenePart = scene ? `a ${scene}` : "your moment";
  return `Built for ${scenePart} with a ${emotion} mood and ${energyLabel(band)} energy throughout.`;
}

function buildStructureExplanation(phases: EmotionalSequencePhases | null): string {
  if (!phases || phases.intro + phases.build + phases.peak + phases.cooldown < 4) {
    return "Tracks are ordered to ease in, lift, and settle without jarring jumps.";
  }
  const peakStart = phases.intro + phases.build + 1;
  const peakEnd = phases.intro + phases.build + phases.peak;
  return `Opens with ${phases.intro} stabilising track${phases.intro === 1 ? "" : "s"}, builds across ${phases.build}, peaks around tracks ${peakStart}–${peakEnd}, then cools down over ${phases.cooldown}.`;
}

export function buildPlaylistWhySummary(opts: {
  momentUnderstanding: MomentUnderstanding;
  canonicalScene: CanonicalSceneResult | null;
  emotionProfile: EmotionProfile;
  intent: IntentDecodeResult | null;
  promptConfidenceTier?: string;
  sequencePhases?: EmotionalSequencePhases | null;
}): PlaylistWhySummary {
  const { momentUnderstanding, canonicalScene, emotionProfile, intent } = opts;
  const signals: string[] = [];

  if (canonicalScene?.sceneId) {
    signals.push(`Scene match: ${formatSceneId(canonicalScene.sceneId)}`);
    if (canonicalScene.matchedAlias) {
      signals.push(`Matched phrase: "${canonicalScene.matchedAlias}"`);
    }
  } else if (momentUnderstanding.where.scene) {
    signals.push(`Scene: ${momentUnderstanding.where.scene}`);
  }

  if (intent?.intent) {
    signals.push(`Intent: ${intent.intent.replace(/_/g, " ")}`);
  }

  if (momentUnderstanding.destination.desired) {
    signals.push(`Destination: ${momentUnderstanding.destination.desired}`);
  }

  if (momentUnderstanding.soundtrack.rediscoveryMode !== "balanced") {
    signals.push(
      `Rediscovery: ${momentUnderstanding.soundtrack.rediscoveryMode.replace(/_/g, " ")}`
    );
  }

  if (opts.promptConfidenceTier) {
    signals.push(`Prompt confidence: ${opts.promptConfidenceTier}`);
  }

  const dominantEmotion =
    momentUnderstanding.feeling.current ??
    momentUnderstanding.feeling.mixed[0] ??
    (emotionProfile.valence >= 0.55
      ? "positive"
      : emotionProfile.valence <= 0.45
        ? "reflective"
        : "balanced");

  const topSceneMatch = canonicalScene?.sceneId
    ? formatSceneId(canonicalScene.sceneId)
    : momentUnderstanding.where.scene;

  const energyProfile = energyBand(emotionProfile.energy);
  const dominantMomentLabel = buildDominantMomentLabel(
    topSceneMatch,
    dominantEmotion,
    energyProfile
  );

  return {
    topSceneMatch,
    sceneConfidence: canonicalScene?.confidence ?? null,
    dominantEmotion,
    dominantMomentLabel,
    energyProfile,
    signals: signals.slice(0, 6),
    summary: buildSummary(topSceneMatch, dominantEmotion, energyProfile),
    structureExplanation: buildStructureExplanation(opts.sequencePhases ?? null),
  };
}
