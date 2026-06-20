/**
 * Deep music semantics — sonic/cultural feel above genre labels.
 * Genres are secondary hints only (secondaryGenreHints).
 */

export type EmotionalArcRole = "build" | "release" | "sustain" | "transition";
export type IntensityCurve = "low" | "medium" | "high" | "variable";

export type SonicTextureGrain = "smooth" | "grainy" | "raw" | "crisp";
export type SonicTextureWarmth = "cold" | "neutral" | "warm";
export type SonicTextureDensity = "sparse" | "medium" | "dense";
export type EmotionalMovement = "static" | "evolving" | "pulse" | "arc";
export type RhythmicComplexity = "minimal" | "straight" | "syncopated" | "broken" | "polyrhythmic";
export type SpatialFeel = "wide" | "tight" | "atmospheric" | "intimate" | "immersive";

export type SonicTextureProfile = {
  grain: SonicTextureGrain;
  warmth: SonicTextureWarmth;
  density: SonicTextureDensity;
  descriptors: string[];
};

export type MusicSemanticProfile = {
  /** Scene-relevant cultural context — primary semantic driver. */
  culturalContextTags: string[];
  sonicTexture: SonicTextureProfile;
  emotionalMovement: EmotionalMovement;
  rhythmicComplexity: RhythmicComplexity;
  spatialFeel: SpatialFeel[];
  sceneCompatibilityVectors: Record<string, number>;
  /** Genre families/subgenres — secondary labels only, never primary retrieval signal. */
  secondaryGenreHints: string[];

  narrativeTags: string[];
  cinematicTags: string[];
  culturalTags: string[];
  situationalTags: string[];
  emotionalArcRole: EmotionalArcRole | null;
  intensityCurve: IntensityCurve;
  temporalFeeling: string[];
  /** @deprecated alias — use sceneCompatibilityVectors */
  sceneAffinityVectors: Record<string, number>;
  musicSignature: string;
  deepSignature: string;
};

export type MusicSemanticConstraints = {
  narrativeTags: string[];
  cinematicTags: string[];
  culturalTags: string[];
  situationalTags: string[];
  emotionalArcRoles: EmotionalArcRole[];
  intensityCurves: IntensityCurve[];
  temporalFeeling: string[];
  sceneAffinityVectors: Record<string, number>;
  spatialFeel: SpatialFeel[];
  rhythmicComplexity: RhythmicComplexity[];
  emotionalMovement: EmotionalMovement[];
  textureDescriptors: string[];
  constraintSignature: string;
  richness: number;
};

export function emptyMusicSemanticProfile(): MusicSemanticProfile {
  return {
    culturalContextTags: [],
    sonicTexture: { grain: "smooth", warmth: "neutral", density: "medium", descriptors: [] },
    emotionalMovement: "static",
    rhythmicComplexity: "straight",
    spatialFeel: [],
    sceneCompatibilityVectors: {},
    secondaryGenreHints: [],
    narrativeTags: [],
    cinematicTags: [],
    culturalTags: [],
    situationalTags: [],
    emotionalArcRole: null,
    intensityCurve: "medium",
    temporalFeeling: [],
    sceneAffinityVectors: {},
    musicSignature: "",
    deepSignature: "",
  };
}

export function deepSignatureFromProfile(profile: Pick<
  MusicSemanticProfile,
  "culturalContextTags" | "sonicTexture" | "emotionalMovement" | "rhythmicComplexity" | "spatialFeel"
>): string {
  return [
    ...profile.culturalContextTags.slice(0, 3),
    profile.sonicTexture.grain,
    profile.sonicTexture.warmth,
    profile.sonicTexture.density,
    ...profile.sonicTexture.descriptors.slice(0, 2),
    profile.emotionalMovement,
    profile.rhythmicComplexity,
    ...profile.spatialFeel.slice(0, 2),
  ].join("|");
}

export function musicSignatureFromProfile(profile: Pick<
  MusicSemanticProfile,
  "narrativeTags" | "cinematicTags" | "culturalTags" | "situationalTags" | "temporalFeeling" | "deepSignature"
>): string {
  return [
    profile.deepSignature,
    ...profile.narrativeTags.slice(0, 2),
    ...profile.cinematicTags.slice(0, 2),
    ...profile.culturalTags.slice(0, 2),
  ].filter(Boolean).sort().join("|");
}
