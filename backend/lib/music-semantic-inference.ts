/**
 * Deep music semantics inference — audio + metadata first; genres secondary only.
 */

import type { EnrichmentTrackInput } from "./track-semantic-enrichment";
import type { SceneDimensionProfile } from "./track-semantic-types";
import {
  type EmotionalArcRole,
  type EmotionalMovement,
  type IntensityCurve,
  type MusicSemanticProfile,
  type RhythmicComplexity,
  type SonicTextureDensity,
  type SonicTextureGrain,
  type SonicTextureWarmth,
  type SpatialFeel,
  deepSignatureFromProfile,
  musicSignatureFromProfile,
} from "./music-semantic-types";

type BaseSemantic = {
  culturalTags: string[];
  scene: SceneDimensionProfile;
  themes: string[];
  sceneConcepts: string[];
};

function safeNum(v: number | null | undefined, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function corpusText(track: EnrichmentTrackInput): string {
  const genres = Array.isArray(track.spotifyArtistGenres)
    ? track.spotifyArtistGenres.filter((g): g is string => typeof g === "string").join(" ")
    : "";
  return [track.trackName, track.artistName, track.albumName ?? "", genres].join(" ").toLowerCase();
}

function inferSecondaryGenreHints(track: EnrichmentTrackInput): string[] {
  const genres = Array.isArray(track.spotifyArtistGenres)
    ? track.spotifyArtistGenres.filter((g): g is string => typeof g === "string")
    : [];
  return [...new Set(genres.map((g) => g.toLowerCase().replace(/[\s-]+/g, "_")))].slice(0, 4);
}

function inferRhythmicComplexity(
  energy: number,
  dance: number,
  tempo: number,
  inst: number,
): RhythmicComplexity {
  if (dance < 0.32 && energy < 0.42 && inst >= 0.45) return "minimal";
  if (dance >= 0.62 && energy >= 0.62 && tempo >= 118 && tempo <= 132) return "straight";
  if (dance >= 0.52 && energy >= 0.38 && energy <= 0.72 && tempo >= 126 && tempo <= 148) return "broken";
  if (dance >= 0.48 && dance <= 0.72 && tempo >= 90 && tempo <= 125) return "syncopated";
  if (dance >= 0.55 && inst >= 0.35) return "polyrhythmic";
  return "straight";
}

function inferEmotionalMovement(
  energy: number,
  valence: number,
  dance: number,
  arcRole: EmotionalArcRole | null,
): EmotionalMovement {
  if (dance >= 0.62 && energy >= 0.58) return "pulse";
  if (arcRole === "build" || arcRole === "release") return "arc";
  if (energy >= 0.45 && (dance >= 0.45 || valence >= 0.45)) return "evolving";
  return "static";
}

function inferSpatialFeel(
  energy: number,
  inst: number,
  acoustic: number,
  dance: number,
  base: BaseSemantic,
): SpatialFeel[] {
  const tags = new Set<SpatialFeel>();
  if (inst >= 0.55 && energy <= 0.45) tags.add("wide");
  if (inst >= 0.4 && acoustic >= 0.35 && energy <= 0.5) tags.add("atmospheric");
  if (dance >= 0.65 && energy >= 0.55) tags.add("tight");
  if (energy <= 0.38 && inst >= 0.3) tags.add("intimate");
  if (inst >= 0.65 && energy >= 0.45 && energy <= 0.65) tags.add("immersive");
  if (base.sceneConcepts.includes("warehouse-rave")) tags.add("tight");
  if (base.culturalTags.includes("cinematic") || base.scene.atmospheres.includes("epic")) tags.add("wide");
  if (tags.size === 0) tags.add(energy >= 0.55 ? "tight" : "atmospheric");
  return [...tags];
}

function inferSonicTexture(
  energy: number,
  valence: number,
  acoustic: number,
  inst: number,
  dance: number,
  corpus: string,
): { grain: SonicTextureGrain; warmth: SonicTextureWarmth; density: SonicTextureDensity; descriptors: string[] } {
  let grain: SonicTextureGrain = "smooth";
  if (dance >= 0.55 && acoustic <= 0.25 && energy >= 0.38 && energy <= 0.68) grain = "grainy";
  else if (energy >= 0.72 && acoustic <= 0.2) grain = "raw";
  else if (inst >= 0.55 && acoustic <= 0.15) grain = "crisp";
  else if (acoustic >= 0.55 && energy <= 0.45) grain = "smooth";

  let warmth: SonicTextureWarmth = "neutral";
  if (valence >= 0.55 && acoustic >= 0.4) warmth = "warm";
  if (valence <= 0.35 && acoustic <= 0.25) warmth = "cold";

  let density: SonicTextureDensity = "medium";
  if (inst >= 0.6 && energy <= 0.42) density = "sparse";
  if (energy >= 0.65 && dance >= 0.6) density = "dense";
  if (energy <= 0.35 && inst >= 0.5) density = "sparse";

  const descriptors = new Set<string>();
  descriptors.add(grain === "grainy" ? "grainy" : grain);
  descriptors.add(warmth);
  descriptors.add(density);
  if (/\b(reverb|echo|haze|fog|mist)\b/.test(corpus)) descriptors.add("hazy");
  if (inst >= 0.5 && energy <= 0.4) descriptors.add("spacious");
  if (dance >= 0.6 && energy >= 0.5) descriptors.add("percussive");

  return { grain, warmth, density, descriptors: [...descriptors] };
}

function inferCulturalContextTags(
  track: EnrichmentTrackInput,
  base: BaseSemantic,
  texture: ReturnType<typeof inferSonicTexture>,
  rhythm: RhythmicComplexity,
  spatial: SpatialFeel[],
  corpus: string,
): string[] {
  const tags = new Set<string>(base.culturalTags);

  if (rhythm === "broken" || (texture.grain === "grainy" && texture.descriptors.includes("percussive"))) {
    tags.add("broken-beat");
    tags.add("uk-electronic-scene");
  }
  if (rhythm === "minimal" && texture.density === "sparse" && spatial.includes("wide")) {
    tags.add("ambient-scene");
    tags.add("spacious-listening");
  }
  if (spatial.includes("wide") && (base.culturalTags.includes("cinematic") || base.scene.atmospheres.includes("epic"))) {
    tags.add("cinematic-scene");
  }
  if (spatial.includes("tight") && rhythm === "straight" && texture.density === "dense") {
    tags.add("club-scene");
  }
  if (base.scene.atmospheres.some((a) => ["nocturnal", "tense", "mystery"].includes(a)) || /\bmidnight\b|\bnight\b/.test(corpus)) {
    tags.add("nocturnal-scene");
  }
  if (energyBand(track) === "energetic") tags.add("high-motion-scene");
  if (energyBand(track) === "low") tags.add("low-motion-scene");

  for (const concept of base.sceneConcepts) tags.add(concept);
  return [...tags];
}

function energyBand(track: EnrichmentTrackInput): "low" | "mid" | "energetic" {
  const e = safeNum(track.energy, 0.5);
  if (e >= 0.62) return "energetic";
  if (e <= 0.38) return "low";
  return "mid";
}

function inferIntensityCurve(energy: number, danceability: number): IntensityCurve {
  if (energy >= 0.72 || danceability >= 0.78) return "high";
  if (energy <= 0.32) return "low";
  if (Math.abs(energy - 0.5) < 0.12 && danceability > 0.55) return "variable";
  return "medium";
}

function inferArcRole(energy: number, valence: number, tempo: number | null): EmotionalArcRole | null {
  const t = tempo ?? 120;
  if (energy >= 0.68 && valence >= 0.55) return "release";
  if (energy >= 0.55 && t >= 125) return "build";
  if (energy <= 0.42 && valence <= 0.45) return "sustain";
  if (energy >= 0.4 && energy <= 0.65 && valence >= 0.4 && valence <= 0.6) return "transition";
  return "sustain";
}

function inferTemporalFeeling(scene: SceneDimensionProfile, energy: number): string[] {
  const tags = new Set<string>([...scene.times, ...scene.weather]);
  if (scene.times.some((t) => t.includes("night"))) tags.add("night");
  if (scene.weather.includes("rain")) tags.add("rain");
  if (energy < 0.35) tags.add("night");
  return [...tags];
}

function inferNarrativeTags(base: BaseSemantic, energy: number, valence: number, inst: number, speech: number, dance = 0.5): string[] {
  const tags = new Set<string>();
  if (base.scene.atmospheres.some((a) => ["tense", "suspense", "mystery"].includes(a))) {
    tags.add("tension-build");
  }
  if (inst >= 0.5 && speech < 0.08) tags.add("low-vocal-density");
  if (energy <= 0.4 && inst >= 0.35) tags.add("steady-flow");
  if (valence <= 0.35) tags.add("melancholy-thread");
  if (dance >= 0.72 && energy >= 0.65) tags.add("momentum");
  if (base.culturalTags.includes("broken-beat") || base.culturalTags.includes("uk-electronic-scene")) {
    tags.add("nocturnal-narrative");
  }
  return [...tags];
}

function inferCinematicTags(base: BaseSemantic, inst: number, energy: number, spatial: SpatialFeel[], dance = 0.5): string[] {
  const tags = new Set<string>();
  if (spatial.includes("wide")) tags.add("wide-landscape");
  if (spatial.includes("intimate")) tags.add("intimate-scene");
  if (inst >= 0.4 || base.culturalTags.includes("cinematic")) tags.add("cinematic");
  if (energy >= 0.65 && inst >= 0.3) tags.add("wide-landscape");
  if (dance >= 0.72 && energy >= 0.65) tags.add("strobe-cut");
  return [...tags];
}

function inferSituationalTags(base: BaseSemantic, energy: number, inst: number): string[] {
  const tags = new Set<string>();
  for (const a of base.scene.activities) {
    if (a === "reading" || a === "studying") tags.add("reading");
    if (a === "driving") tags.add("driving");
    if (a === "dancing") tags.add("party");
  }
  if (energy <= 0.38 && inst >= 0.4) tags.add("thinking");
  if (energy <= 0.42 && inst >= 0.5) tags.add("low-distraction");
  return [...tags];
}

function buildSceneCompatibility(base: BaseSemantic, culturalContext: string[]): Record<string, number> {
  const vectors: Record<string, number> = {};
  const bump = (key: string, w: number) => {
    vectors[key] = Math.round(((vectors[key] ?? 0) + w) * 100) / 100;
  };
  if (culturalContext.includes("uk-electronic-scene") || base.sceneConcepts.includes("uk-garage")) bump("tokyo-night", 0.55);
  if (culturalContext.includes("ambient-scene")) bump("paris-cafe", 0.2);
  if (culturalContext.includes("cinematic-scene")) bump("epic-fantasy", 0.3);
  if (culturalContext.includes("club-scene")) bump("berlin-warehouse", 0.35);
  if (culturalContext.includes("nocturnal-scene")) bump("tokyo-night", 0.4);
  if (base.culturalTags.includes("detective")) bump("cozy-mystery", 0.45);
  if (base.scene.places.includes("train")) bump("last-train", 0.4);
  return vectors;
}

/** Lightweight deep semantics from audio only — used by manifold v2 clustering. */
export function inferDeepMusicSemanticsFromAudio(track: EnrichmentTrackInput): Pick<
  MusicSemanticProfile,
  "sonicTexture" | "emotionalMovement" | "rhythmicComplexity" | "spatialFeel" | "culturalContextTags" | "deepSignature"
> {
  const energy = safeNum(track.energy, 0.5);
  const valence = safeNum(track.valence, 0.5);
  const inst = safeNum(track.instrumentalness, 0.2);
  const dance = safeNum(track.danceability, 0.5);
  const acoustic = safeNum(track.acousticness, 0.3);
  const tempo = safeNum(track.tempo, 120);
  const corpus = corpusText(track);
  const emptyBase: BaseSemantic = { culturalTags: [], scene: { places: [], times: [], activities: [], weather: [], atmospheres: [] }, themes: [], sceneConcepts: [] };

  const sonicTexture = inferSonicTexture(energy, valence, acoustic, inst, dance, corpus);
  const rhythmicComplexity = inferRhythmicComplexity(energy, dance, tempo, inst);
  const spatialFeel = inferSpatialFeel(energy, inst, acoustic, dance, emptyBase);
  const emotionalMovement = inferEmotionalMovement(energy, valence, dance, inferArcRole(energy, valence, tempo));
  const culturalContextTags = inferCulturalContextTags(track, emptyBase, sonicTexture, rhythmicComplexity, spatialFeel, corpus);

  const slice = { culturalContextTags, sonicTexture, emotionalMovement, rhythmicComplexity, spatialFeel };
  return { ...slice, deepSignature: deepSignatureFromProfile(slice) };
}

export function buildMusicSemanticProfile(
  track: EnrichmentTrackInput,
  base: BaseSemantic,
): MusicSemanticProfile {
  const energy = safeNum(track.energy, 0.5);
  const valence = safeNum(track.valence, 0.5);
  const inst = safeNum(track.instrumentalness, 0.2);
  const speech = safeNum(track.speechiness, 0.05);
  const dance = safeNum(track.danceability, 0.5);
  const acoustic = safeNum(track.acousticness, 0.3);
  const tempo = safeNum(track.tempo, 120);
  const corpus = corpusText(track);

  const sonicTexture = inferSonicTexture(energy, valence, acoustic, inst, dance, corpus);
  const rhythmicComplexity = inferRhythmicComplexity(energy, dance, tempo, inst);
  const spatialFeel = inferSpatialFeel(energy, inst, acoustic, dance, base);
  const emotionalArcRole = inferArcRole(energy, valence, tempo);
  const emotionalMovement = inferEmotionalMovement(energy, valence, dance, emotionalArcRole);
  const culturalContextTags = inferCulturalContextTags(track, base, sonicTexture, rhythmicComplexity, spatialFeel, corpus);
  const sceneCompatibilityVectors = buildSceneCompatibility(base, culturalContextTags);
  const narrativeBase: BaseSemantic = {
    ...base,
    culturalTags: [...new Set([...base.culturalTags, ...culturalContextTags])],
  };

  const profile: MusicSemanticProfile = {
    culturalContextTags,
    sonicTexture,
    emotionalMovement,
    rhythmicComplexity,
    spatialFeel,
    sceneCompatibilityVectors,
    secondaryGenreHints: inferSecondaryGenreHints(track),
    narrativeTags: inferNarrativeTags(narrativeBase, energy, valence, inst, speech, dance),
    cinematicTags: inferCinematicTags(narrativeBase, inst, energy, spatialFeel, dance),
    culturalTags: [...new Set([...base.culturalTags, ...culturalContextTags.slice(0, 4)])],
    situationalTags: inferSituationalTags(base, energy, inst),
    emotionalArcRole,
    intensityCurve: inferIntensityCurve(energy, dance),
    temporalFeeling: inferTemporalFeeling(base.scene, energy),
    sceneAffinityVectors: sceneCompatibilityVectors,
    musicSignature: "",
    deepSignature: "",
  };
  profile.deepSignature = deepSignatureFromProfile(profile);
  profile.musicSignature = musicSignatureFromProfile(profile);
  return profile;
}
