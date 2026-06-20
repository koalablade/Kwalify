/**
 * Scene collision resolver — distinct signatures, pools, and emotional vectors for near-duplicate scenes.
 */

import type { ExpandedCulturalContext } from "./cultural-reference-expansion";
import type { PromptSceneProfile } from "./track-semantic-types";
import { signatureFromTags } from "./track-semantic-types";

export type SceneDifferentiation = {
  axis: string;
  collisionGroup: string;
  overlapScore: number;
  differentiatedTags: string[];
  retrievalSignature: string;
  emotionalVectorDelta: Record<string, number>;
};

type SceneCollisionSpec = {
  group: string;
  prompts: string[];
  axes: Record<string, string>;
  emotionalDelta: Record<string, Record<string, number>>;
};

const COLLISION_SPECS: SceneCollisionSpec[] = [
  {
    group: "cozy-mystery-literary",
    prompts: ["Reading Agatha Christie", "Reading Sherlock Holmes", "Victorian detective story"],
    axes: {
      "Reading Agatha Christie": "cozy-village-mystery",
      "Reading Sherlock Holmes": "deductive-noir-precision",
      "Victorian detective story": "gaslight-investigation",
    },
    emotionalDelta: {
      "Reading Agatha Christie": { cozy: 0.15, suspense: 0.08 },
      "Reading Sherlock Holmes": { intellectual: 0.18, tense: 0.12 },
      "Victorian detective story": { vintage: 0.14, mystery: 0.1 },
    },
  },
  {
    group: "nocturnal-urban-future",
    prompts: ["Tokyo at 3am", "Cyberpunk dystopia", "Tokyo after midnight"],
    axes: {
      "Tokyo at 3am": "neon-transit-loneliness",
      "Cyberpunk dystopia": "industrial-dystopia-sprawl",
      "Tokyo after midnight": "late-train-afterglow",
    },
    emotionalDelta: {
      "Tokyo at 3am": { lonely: 0.16, nocturnal: 0.14 },
      "Cyberpunk dystopia": { industrial: 0.18, foreboding: 0.12 },
      "Tokyo after midnight": { transit: 0.14, dreamlike: 0.1 },
    },
  },
  {
    group: "horror-literary",
    prompts: ["Small-town horror novel", "Reading Stephen King", "Reading Lovecraft"],
    axes: {
      "Small-town horror novel": "pastoral-dread-smalltown",
      "Reading Stephen King": "domestic-american-horror",
      "Reading Lovecraft": "cosmic-abstract-dread",
    },
    emotionalDelta: {
      "Small-town horror novel": { foreboding: 0.14, vintage: 0.1 },
      "Reading Stephen King": { tense: 0.16, suspense: 0.12 },
      "Reading Lovecraft": { cosmic: 0.18, mystery: 0.1 },
    },
  },
];

export const SCENE_COLLISION_OVERLAP_THRESHOLD = 0.72;

function tokenSet(signature: string): Set<string> {
  return new Set(signature.split("|").filter(Boolean));
}

export function signatureOverlap(a: string, b: string): number {
  const setA = tokenSet(a);
  const setB = tokenSet(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function findCollisionSpec(prompt: string): SceneCollisionSpec | null {
  const normalized = prompt.trim();
  for (const spec of COLLISION_SPECS) {
    if (spec.prompts.some((p) => p.toLowerCase() === normalized.toLowerCase())) return spec;
  }
  return null;
}

function baseRetrievalSignature(profile: PromptSceneProfile, expansion: ExpandedCulturalContext): string {
  const tags = [
    ...profile.atmospheres,
    ...profile.culturalTags.slice(0, 4),
    ...profile.sceneConcepts.slice(0, 3),
    ...profile.themes.slice(0, 2),
    expansion.sceneId ?? "",
    expansion.atmosphereSignature,
  ].filter(Boolean);
  return signatureFromTags(tags);
}

export function applySceneDifferentiation(
  prompt: string,
  profile: PromptSceneProfile,
  expansion: ExpandedCulturalContext,
): SceneDifferentiation {
  const baseSignature = baseRetrievalSignature(profile, expansion);
  const spec = findCollisionSpec(prompt);

  if (!spec) {
    return {
      axis: "",
      collisionGroup: "",
      overlapScore: 0,
      differentiatedTags: [],
      retrievalSignature: profile.retrievalSignature || baseSignature,
      emotionalVectorDelta: {},
    };
  }

  const siblings = spec.prompts.filter((p) => p.toLowerCase() !== prompt.trim().toLowerCase());
  let maxOverlap = 0;
  for (const sibling of siblings) {
    const siblingProfile = buildSiblingSignature(sibling);
    maxOverlap = Math.max(maxOverlap, signatureOverlap(baseSignature, siblingProfile));
  }

  const axis = spec.axes[prompt.trim()] ?? spec.axes[prompt] ?? "";
  const differentiatedTags = axis ? [axis, spec.group] : [spec.group];
  const emotionalVectorDelta = spec.emotionalDelta[prompt.trim()] ?? spec.emotionalDelta[prompt] ?? {};

  let retrievalSignature = profile.retrievalSignature || baseSignature;
  if (axis) {
    retrievalSignature = signatureFromTags([axis, spec.group, retrievalSignature]);
  } else if (maxOverlap >= SCENE_COLLISION_OVERLAP_THRESHOLD) {
    retrievalSignature = signatureFromTags([...differentiatedTags, retrievalSignature]);
  }

  return {
    axis,
    collisionGroup: spec.group,
    overlapScore: Math.round(maxOverlap * 1000) / 1000,
    differentiatedTags,
    retrievalSignature,
    emotionalVectorDelta,
  };
}

function buildSiblingSignature(prompt: string): string {
  const lower = prompt.toLowerCase();
  if (lower.includes("agatha")) return "cozy|mystery|suspense|vintage|intellectual";
  if (lower.includes("sherlock")) return "mystery|suspense|vintage|intellectual|detective";
  if (lower.includes("tokyo")) return "nocturnal|urban|cinematic|dreamlike|lonely";
  if (lower.includes("cyberpunk")) return "futuristic|nocturnal|industrial|dystopian";
  if (lower.includes("stephen king")) return "horror|suspense|tense|foreboding";
  if (lower.includes("small-town horror")) return "horror|foreboding|vintage|mystery";
  return signatureFromTags(prompt.toLowerCase().split(/\s+/));
}

export function compareSceneCollisionPair(
  promptA: string,
  promptB: string,
): {
  overlap: number;
  distinctSignatures: boolean;
  distinctEmotionalVectors: boolean;
  axisA: string;
  axisB: string;
} {
  const emptyExpansion: ExpandedCulturalContext = {
    matchedIds: [],
    culturalRefs: [],
    sceneId: null,
    atmospheres: [],
    themes: [],
    sceneConcepts: [],
    culturalTags: [],
    scene: { places: [], times: [], activities: [], weather: [], atmospheres: [] },
    genreFamilies: [],
    eraRange: null,
    dominantEmotion: null,
    atmosphereOverActivity: false,
    culturalDominance: 0.5,
    atmosphereSignature: "",
  };
  const profileA = { retrievalSignature: "", atmospheres: [], culturalTags: [], sceneConcepts: [], themes: [], places: [], times: [], activities: [], weather: [] } as PromptSceneProfile;
  const profileB = { ...profileA };
  const diffA = applySceneDifferentiation(promptA, profileA, emptyExpansion);
  const diffB = applySceneDifferentiation(promptB, profileB, emptyExpansion);
  const overlap = signatureOverlap(diffA.retrievalSignature, diffB.retrievalSignature);

  const emotionalA = diffA.emotionalVectorDelta;
  const emotionalB = diffB.emotionalVectorDelta;
  const emotionalKeys = new Set([...Object.keys(emotionalA), ...Object.keys(emotionalB)]);
  let emotionalDiff = 0;
  for (const key of emotionalKeys) {
    emotionalDiff += Math.abs((emotionalA[key] ?? 0) - (emotionalB[key] ?? 0));
  }

  return {
    overlap: Math.round(overlap * 1000) / 1000,
    distinctSignatures: diffA.retrievalSignature !== diffB.retrievalSignature,
    distinctEmotionalVectors: emotionalDiff >= 0.08 || diffA.axis !== diffB.axis,
    axisA: diffA.axis,
    axisB: diffB.axis,
  };
}
