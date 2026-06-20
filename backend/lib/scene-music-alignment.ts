/**
 * Scene knowledge → music semantic constraints (not genre picks).
 */

import { expandCulturalReferences } from "./cultural-reference-expansion";
import type { PromptSceneProfile } from "./track-semantic-types";
import {
  type EmotionalArcRole,
  type EmotionalMovement,
  type IntensityCurve,
  type MusicSemanticConstraints,
  type RhythmicComplexity,
  type SpatialFeel,
} from "./music-semantic-types";

type AtmosphereMusicHints = {
  narrative: string[];
  cinematic: string[];
  cultural: string[];
  situational: string[];
  arcs: EmotionalArcRole[];
  intensity: IntensityCurve[];
  temporal: string[];
  spatialFeel: SpatialFeel[];
  rhythmicComplexity: RhythmicComplexity[];
  emotionalMovement: EmotionalMovement[];
  textureDescriptors: string[];
};

const ATMOSPHERE_MUSIC_MAP: Record<string, Partial<AtmosphereMusicHints>> = {
  mystery: {
    narrative: ["tension-build", "subtle-reveal", "investigation-pacing"],
    cinematic: ["noir", "intimate-scene", "slow-pan"],
    cultural: ["late-night-lounge"],
    situational: ["reading", "thinking", "low-distraction"],
    arcs: ["sustain", "build"],
    intensity: ["low", "medium"],
    temporal: ["night", "rain"],
    spatialFeel: ["intimate", "atmospheric"],
    rhythmicComplexity: ["minimal", "syncopated"],
    emotionalMovement: ["static", "evolving"],
    textureDescriptors: ["sparse", "neutral"],
  },
  suspense: {
    narrative: ["tension-build", "emotional-weight"],
    cinematic: ["noir", "cinematic"],
    cultural: [],
    situational: ["thinking", "reading"],
    arcs: ["build", "sustain"],
    intensity: ["medium", "variable"],
    temporal: ["night"],
  },
  foreboding: {
    narrative: ["tension-build", "emotional-weight"],
    cinematic: ["noir", "intimate-scene"],
    cultural: [],
    situational: ["thinking"],
    arcs: ["build", "sustain"],
    intensity: ["low", "medium"],
    temporal: ["night"],
  },
  nocturnal: {
    narrative: ["nocturnal-narrative", "steady-flow"],
    cinematic: ["slow-pan", "intimate-scene"],
    cultural: ["urban-nightlife-feel", "spacious-minimal", "broken-beat", "uk-electronic-scene", "nocturnal-scene"],
    situational: ["walking-alone", "driving", "thinking"],
    arcs: ["sustain", "transition"],
    intensity: ["low", "medium"],
    temporal: ["night"],
    spatialFeel: ["wide", "atmospheric"],
    rhythmicComplexity: ["minimal", "broken"],
    emotionalMovement: ["static", "evolving"],
    textureDescriptors: ["sparse", "grainy"],
  },
  club: {
    narrative: ["momentum", "motion-continuity"],
    cinematic: ["strobe-cut", "cinematic"],
    cultural: ["club-scene", "berlin-club-texture"],
    situational: ["party", "dancing"],
    arcs: ["build", "release"],
    intensity: ["high", "variable"],
    temporal: ["night"],
    spatialFeel: ["tight", "immersive"],
    rhythmicComplexity: ["straight", "polyrhythmic"],
    emotionalMovement: ["pulse", "arc"],
    textureDescriptors: ["dense", "percussive"],
  },
  epic: {
    narrative: ["momentum", "uplift-thread"],
    cinematic: ["wide-landscape", "cinematic"],
    cultural: [],
    situational: ["driving"],
    arcs: ["build", "release"],
    intensity: ["high", "variable"],
    temporal: [],
  },
  wonder: {
    narrative: ["uplift-thread", "momentum"],
    cinematic: ["wide-landscape", "cinematic"],
    cultural: [],
    situational: ["background-listening"],
    arcs: ["build", "release"],
    intensity: ["medium", "high"],
    temporal: ["dawn"],
  },
  melancholy: {
    narrative: ["melancholy-thread", "emotional-weight"],
    cinematic: ["intimate-scene"],
    cultural: [],
    situational: ["walking-alone", "thinking"],
    arcs: ["sustain"],
    intensity: ["low"],
    temporal: ["rain", "night"],
  },
  romantic: {
    narrative: ["steady-flow", "emotional-weight"],
    cinematic: ["intimate-scene"],
    cultural: ["late-night-lounge"],
    situational: ["reading", "background-listening"],
    arcs: ["sustain", "transition"],
    intensity: ["low", "medium"],
    temporal: ["dusk", "rain"],
  },
  industrial: {
    narrative: ["motion-continuity"],
    cinematic: ["strobe-cut", "cinematic"],
    cultural: ["berlin-club-texture"],
    situational: ["driving", "garage-work"],
    arcs: ["build", "sustain"],
    intensity: ["medium", "high"],
    temporal: ["night"],
  },
  futuristic: {
    narrative: ["steady-flow", "nocturnal-narrative"],
    cinematic: ["cinematic", "slow-pan"],
    cultural: ["spacious-minimal", "urban-nightlife-feel"],
    situational: ["driving", "thinking"],
    arcs: ["sustain", "transition"],
    intensity: ["low", "medium"],
    temporal: ["night"],
  },
  cozy: {
    narrative: ["steady-flow"],
    cinematic: ["intimate-scene"],
    cultural: [],
    situational: ["reading", "low-distraction", "background-listening"],
    arcs: ["sustain"],
    intensity: ["low"],
    temporal: [],
  },
  adventure: {
    narrative: ["momentum", "motion-continuity"],
    cinematic: ["travel-montage", "wide-landscape"],
    cultural: [],
    situational: ["driving"],
    arcs: ["build", "release"],
    intensity: ["medium", "high"],
    temporal: [],
  },
};

const SCENE_ID_MUSIC_MAP: Record<string, Partial<AtmosphereMusicHints>> = {
  "cozy-mystery": ATMOSPHERE_MUSIC_MAP.mystery!,
  "victorian-detective": ATMOSPHERE_MUSIC_MAP.mystery!,
  "horror-suspense": ATMOSPHERE_MUSIC_MAP.foreboding!,
  "tokyo-night": ATMOSPHERE_MUSIC_MAP.nocturnal!,
  "berlin-warehouse": ATMOSPHERE_MUSIC_MAP.club!,
  "paris-cafe": ATMOSPHERE_MUSIC_MAP.romantic!,
  "garage-midnight": {
    narrative: ["steady-flow"],
    cinematic: ["intimate-scene"],
    cultural: [],
    situational: ["garage-work", "thinking"],
    arcs: ["sustain"],
    intensity: ["low", "medium"],
    temporal: ["night"],
  },
  "last-train": {
    narrative: ["transit-loneliness", "melancholy-thread"],
    cinematic: ["intimate-scene"],
    cultural: ["urban-nightlife-feel"],
    situational: ["walking-alone"],
    arcs: ["sustain"],
    intensity: ["low"],
    temporal: ["night"],
  },
  "cyberpunk-night": ATMOSPHERE_MUSIC_MAP.futuristic!,
  "desert-epic": ATMOSPHERE_MUSIC_MAP.epic!,
  "epic-fantasy": ATMOSPHERE_MUSIC_MAP.wonder!,
  "literary-reading": ATMOSPHERE_MUSIC_MAP.cozy!,
  "france-atmosphere": ATMOSPHERE_MUSIC_MAP.adventure!,
  "road-trip": ATMOSPHERE_MUSIC_MAP.adventure!,
  "night-shift": ATMOSPHERE_MUSIC_MAP.nocturnal!,
};

function mergeHints(target: AtmosphereMusicHints, source: Partial<AtmosphereMusicHints>): AtmosphereMusicHints {
  const s: AtmosphereMusicHints = { ...emptyHints(), ...source };
  return {
    narrative: [...new Set([...target.narrative, ...s.narrative])],
    cinematic: [...new Set([...target.cinematic, ...s.cinematic])],
    cultural: [...new Set([...target.cultural, ...s.cultural])],
    situational: [...new Set([...target.situational, ...s.situational])],
    arcs: [...new Set([...target.arcs, ...s.arcs])],
    intensity: [...new Set([...target.intensity, ...s.intensity])],
    temporal: [...new Set([...target.temporal, ...s.temporal])],
    spatialFeel: [...new Set([...target.spatialFeel, ...s.spatialFeel])],
    rhythmicComplexity: [...new Set([...target.rhythmicComplexity, ...s.rhythmicComplexity])],
    emotionalMovement: [...new Set([...target.emotionalMovement, ...s.emotionalMovement])],
    textureDescriptors: [...new Set([...target.textureDescriptors, ...s.textureDescriptors])],
  };
}

function emptyHints(): AtmosphereMusicHints {
  return {
    narrative: [], cinematic: [], cultural: [], situational: [], arcs: [], intensity: [], temporal: [],
    spatialFeel: [], rhythmicComplexity: [], emotionalMovement: [], textureDescriptors: [],
  };
}

function hintsToConstraints(hints: Partial<AtmosphereMusicHints>, sceneAffinity: Record<string, number>): MusicSemanticConstraints {
  const merged = { ...emptyHints(), ...hints };
  const narrativeTags = merged.narrative;
  const cinematicTags = merged.cinematic;
  const richness =
    narrativeTags.length * 0.2 +
    cinematicTags.length * 0.2 +
    merged.cultural.length * 0.15 +
    merged.situational.length * 0.1 +
    Object.keys(sceneAffinity).length * 0.15;

  const constraintSignature = [
    ...narrativeTags,
    ...cinematicTags,
    ...merged.cultural.slice(0, 3),
    ...merged.situational.slice(0, 3),
    ...merged.spatialFeel.slice(0, 2),
  ].sort().join("|");

  return {
    narrativeTags,
    cinematicTags,
    culturalTags: merged.cultural,
    situationalTags: merged.situational,
    emotionalArcRoles: merged.arcs,
    intensityCurves: merged.intensity,
    temporalFeeling: merged.temporal,
    sceneAffinityVectors: sceneAffinity,
    spatialFeel: merged.spatialFeel,
    rhythmicComplexity: merged.rhythmicComplexity,
    emotionalMovement: merged.emotionalMovement,
    textureDescriptors: merged.textureDescriptors,
    constraintSignature,
    richness: Math.min(1, richness),
  };
}

export function buildMusicSemanticConstraintsFromPrompt(prompt: string): MusicSemanticConstraints {
  const expansion = expandCulturalReferences(prompt);
  const sceneProfile = buildMusicSemanticConstraintsFromSceneProfile({
    places: expansion.scene.places,
    times: expansion.scene.times,
    activities: expansion.scene.activities,
    weather: expansion.scene.weather,
    atmospheres: [...expansion.atmospheres, ...expansion.scene.atmospheres],
    culturalTags: expansion.culturalTags,
    themes: expansion.themes,
    sceneConcepts: expansion.sceneConcepts,
    retrievalSignature: expansion.atmosphereSignature,
  }, expansion.sceneId);
  return sceneProfile;
}

export function buildMusicSemanticConstraintsFromSceneProfile(
  profile: PromptSceneProfile,
  sceneId?: string | null,
): MusicSemanticConstraints {
  let hints = emptyHints();

  for (const atmosphere of profile.atmospheres) {
    const mapped = ATMOSPHERE_MUSIC_MAP[atmosphere];
    if (mapped) hints = mergeHints(hints, mapped);
  }

  if (sceneId && SCENE_ID_MUSIC_MAP[sceneId]) {
    hints = mergeHints(hints, SCENE_ID_MUSIC_MAP[sceneId]!);
  }

  for (const concept of profile.sceneConcepts) {
    if (concept.includes("train")) hints = mergeHints(hints, SCENE_ID_MUSIC_MAP["last-train"]!);
    if (concept.includes("garage") || concept.includes("road")) {
      hints.situational.push("driving");
    }
  }

  for (const tag of profile.culturalTags) {
    if (tag.includes("tokyo") || tag.includes("neon")) {
      hints.cultural.push("tokyo-nightlife-feel", "urban-nightlife-feel");
    }
    if (tag.includes("rave") || tag.includes("warehouse") || tag.includes("club")) {
      hints = mergeHints(hints, ATMOSPHERE_MUSIC_MAP.club!);
    }
    if (tag.includes("detective") || tag.includes("mystery")) {
      hints = mergeHints(hints, ATMOSPHERE_MUSIC_MAP.mystery!);
    }
    if (tag.includes("cyber") || tag.includes("dystop")) {
      hints = mergeHints(hints, ATMOSPHERE_MUSIC_MAP.futuristic!);
    }
  }

  if (profile.times.some((t) => t.includes("night"))) hints.temporal.push("night");
  if (profile.weather.includes("rain")) hints.temporal.push("rain");

  const sceneAffinity: Record<string, number> = {};
  if (sceneId) sceneAffinity[sceneId] = 0.55;
  for (const concept of profile.sceneConcepts.slice(0, 3)) {
    sceneAffinity[concept] = 0.35;
  }

  return hintsToConstraints(hints, sceneAffinity);
}

export function isRichMusicSemanticPrompt(constraints: MusicSemanticConstraints): boolean {
  return constraints.richness >= 0.35
    && (constraints.narrativeTags.length >= 1 || constraints.cinematicTags.length >= 1);
}
