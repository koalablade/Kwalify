/**
 * Parse / normalize persisted music semantic profiles.
 */

import {
  emptyMusicSemanticProfile,
  type EmotionalMovement,
  type MusicSemanticProfile,
  type RhythmicComplexity,
  type SonicTextureDensity,
  type SonicTextureGrain,
  type SonicTextureWarmth,
  type SpatialFeel,
  deepSignatureFromProfile,
  musicSignatureFromProfile,
} from "./music-semantic-types";

function asStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function asEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

export function parseMusicSemanticProfile(raw: unknown): MusicSemanticProfile {
  if (!raw || typeof raw !== "object") return emptyMusicSemanticProfile();
  const m = raw as Record<string, unknown>;
  const textureRaw = m["sonicTexture"];
  const textureObj = textureRaw && typeof textureRaw === "object" ? textureRaw as Record<string, unknown> : {};

  const sceneCompat =
    (m["sceneCompatibilityVectors"] && typeof m["sceneCompatibilityVectors"] === "object"
      ? m["sceneCompatibilityVectors"]
      : m["sceneAffinityVectors"]) as Record<string, number> | undefined;

  const profile: MusicSemanticProfile = {
    culturalContextTags: asStrings(m["culturalContextTags"]),
    sonicTexture: {
      grain: asEnum(textureObj["grain"], ["smooth", "grainy", "raw", "crisp"] as const, "smooth"),
      warmth: asEnum(textureObj["warmth"], ["cold", "neutral", "warm"] as const, "neutral"),
      density: asEnum(textureObj["density"], ["sparse", "medium", "dense"] as const, "medium"),
      descriptors: asStrings(textureObj["descriptors"]),
    },
    emotionalMovement: asEnum(m["emotionalMovement"], ["static", "evolving", "pulse", "arc"] as const, "static"),
    rhythmicComplexity: asEnum(
      m["rhythmicComplexity"],
      ["minimal", "straight", "syncopated", "broken", "polyrhythmic"] as const,
      "straight",
    ),
    spatialFeel: asStrings(m["spatialFeel"]).filter((s): s is SpatialFeel =>
      ["wide", "tight", "atmospheric", "intimate", "immersive"].includes(s),
    ),
    sceneCompatibilityVectors: sceneCompat ?? {},
    secondaryGenreHints: asStrings(m["secondaryGenreHints"]),
    narrativeTags: asStrings(m["narrativeTags"]),
    cinematicTags: asStrings(m["cinematicTags"]),
    culturalTags: asStrings(m["culturalTags"]),
    situationalTags: asStrings(m["situationalTags"]),
    emotionalArcRole:
      m["emotionalArcRole"] === "build" ||
      m["emotionalArcRole"] === "release" ||
      m["emotionalArcRole"] === "sustain" ||
      m["emotionalArcRole"] === "transition"
        ? m["emotionalArcRole"]
        : null,
    intensityCurve: asEnum(m["intensityCurve"], ["low", "medium", "high", "variable"] as const, "medium"),
    temporalFeeling: asStrings(m["temporalFeeling"]),
    sceneAffinityVectors: sceneCompat ?? {},
    musicSignature: typeof m["musicSignature"] === "string" ? m["musicSignature"] : "",
    deepSignature: typeof m["deepSignature"] === "string" ? m["deepSignature"] : "",
  };

  if (!profile.deepSignature) profile.deepSignature = deepSignatureFromProfile(profile);
  if (!profile.musicSignature) profile.musicSignature = musicSignatureFromProfile(profile);
  profile.sceneAffinityVectors = { ...profile.sceneCompatibilityVectors };
  return profile;
}
