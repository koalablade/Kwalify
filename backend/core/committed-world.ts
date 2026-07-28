/**
 * Single authoritative committed musical world after prompt interpretation.
 * Explicit genre/scene beats vague mood. Downstream stages must obey this.
 */

import type { SceneLockStatus } from "./scene-lock-mode";
import { resolveWorldBoundary, type WorldBoundary } from "./world-boundary";
import { inferWorldIdentityIdsFromPrompt } from "./editorial/world-identity-gate";

export type CommittedWorldSource =
  | "explicit_genre"
  | "scene_lock"
  | "inferred"
  | "vague";

export type CommittedWorld = {
  id: string;
  hardLock: boolean;
  confidence: number;
  source: CommittedWorldSource;
  reason: string;
  worldIds: string[];
  boundary: WorldBoundary;
};

const EXPLICIT_GENRE_WORLD: Array<{ pattern: RegExp; id: string }> = [
  { pattern: /\bdad\s*'?s?\s+rock\b|\bdad\s+rock\b/i, id: "classic_rock_world" },
  { pattern: /\byacht\s+rock\b/i, id: "yacht_rock_world" },
  { pattern: /\barena\s+rock\b/i, id: "classic_rock_world" },
  { pattern: /\bclassic\s+rock\b|\b70s?\s+rock\b|\b80s?\s+rock\b/i, id: "classic_rock_world" },
  { pattern: /\b(?:70s?|seventies)\s+disco\b|\bdisco\b.*\b(?:party|rooftop|dance)\b/i, id: "disco_party_world" },
  { pattern: /\b(?:heavy|aggressive)\s+(?:gym|workout)\b|\bgym\b.*\baggressive\b|\baggressive\b.*\b(?:gym|workout|pump)\b/i, id: "angry_rock_world" },
  { pattern: /\bgym\s+rock\b|\bheavy\s+gym\b|\bgym\s+pump\b.*\brock\b|\brock\b.*\bgym\b/i, id: "gym_rock_world" },
  { pattern: /\bgrunge\b/i, id: "grunge_world" },
  { pattern: /\bgoth\b|\bgothic\b/i, id: "goth_world" },
  { pattern: /\bpop[-\s]?punk\b/i, id: "pop_punk_world" },
  { pattern: /\bmetal\b/i, id: "angry_rock_world" },
];

const EXPLICIT_SCENE_WORLD: Array<{ pattern: RegExp; id: string }> = [
  {
    pattern:
      /\b(?:empty\s+)?motorway\b.*\b(?:midnight|rain|windscreen)\b|\b(?:midnight|rain)\b.*\b(?:empty\s+)?motorway\b|\bempty\s+motorway\s+at\s+midnight\b/i,
    id: "rainy_drive_world",
  },
  {
    pattern: /\b(?:motorway|highway)\s+at\s+(?:night|midnight)\b|\bnight\s+drive\b|\b(?:empty|night)\s+(?:motorway|highway)\b/i,
    id: "night_drive_world",
  },
];

function explicitGenreWorld(prompt: string): string | null {
  for (const row of EXPLICIT_GENRE_WORLD) {
    if (row.pattern.test(prompt)) return row.id;
  }
  return null;
}

function explicitSceneWorld(prompt: string): string | null {
  for (const row of EXPLICIT_SCENE_WORLD) {
    if (row.pattern.test(prompt)) return row.id;
  }
  return null;
}

function sourceFromBoundary(
  boundary: WorldBoundary,
  explicitGenre: string | null,
  explicitScene: string | null,
  sceneLock: SceneLockStatus | null,
): CommittedWorldSource {
  if (explicitGenre) return "explicit_genre";
  if (explicitScene) return "inferred";
  if (sceneLock?.active) return "scene_lock";
  if (boundary.reason?.startsWith("world_purity_lock:")) return "inferred";
  if (boundary.active) return "inferred";
  return "vague";
}

function confidenceFor(
  source: CommittedWorldSource,
  hardLock: boolean,
  worldIds: string[],
): number {
  if (worldIds.length === 0) return 0.2;
  if (source === "explicit_genre" && hardLock) return 0.95;
  if (source === "scene_lock" && hardLock) return 0.92;
  if (hardLock) return 0.85;
  if (source === "inferred") return 0.72;
  return 0.45;
}

/** Resolve the single committed world contract for a generation request. */
export function resolveCommittedWorld(opts: {
  prompt?: string;
  vibe?: string;
  sceneLock?: SceneLockStatus | null;
  sceneAliases?: string[];
  scenePrediction?: Record<string, number>;
  primaryGenres?: string[];
  lockedIntent?: { primaryGenres?: string[]; genreFamilies?: string[] } | null;
  editorialWorldTag?: string | null;
}): CommittedWorld | null {
  const prompt = (opts.prompt ?? opts.vibe ?? "").trim();
  if (!prompt) return null;

  const lockedGenres = [
    ...(opts.primaryGenres ?? []),
    ...(opts.lockedIntent?.primaryGenres ?? []),
    ...(opts.lockedIntent?.genreFamilies ?? []),
  ];

  const boundary = resolveWorldBoundary({
    sceneLock: opts.sceneLock ?? null,
    sceneAliases: opts.sceneAliases ?? [],
    scenePrediction: opts.scenePrediction ?? {},
    prompt,
  });

  const explicitGenre = explicitGenreWorld(prompt);
  const explicitScene = explicitSceneWorld(prompt);
  const inferred = inferWorldIdentityIdsFromPrompt(prompt);

  let id: string | null = explicitGenre ?? explicitScene ?? null;
  if (!id && boundary.lockAnchors?.length) {
    id = boundary.lockAnchors[0] ?? null;
  }
  if (!id && inferred.length > 0) {
    id = inferred[0] ?? null;
  }
  if (!id && lockedGenres.includes("rock")) {
    id = "classic_rock_world";
  }
  if (!id) return null;

  const worldIds = [...new Set([id, ...inferred, ...(boundary.lockAnchors ?? [])])];
  const source = sourceFromBoundary(boundary, explicitGenre, explicitScene, opts.sceneLock ?? null);
  const hardLock =
    Boolean(explicitGenre || explicitScene) ||
    boundary.hardLock === true ||
    (opts.sceneLock?.active === true && source !== "vague");

  const reason =
    explicitGenre != null
      ? `committed_world:explicit_genre:${id}`
      : explicitScene != null
        ? `committed_world:explicit_scene:${id}`
        : boundary.reason ?? `committed_world:${id}`;

  return {
    id,
    hardLock,
    confidence: confidenceFor(source, hardLock, worldIds),
    source,
    reason,
    worldIds,
    boundary,
  };
}

export function committedWorldHonestPartialCap(requestedLength: number): number {
  return Math.min(12, Math.max(6, Math.ceil(requestedLength * 0.4)));
}
