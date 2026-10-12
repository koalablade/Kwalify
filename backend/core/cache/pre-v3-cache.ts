import { createHash } from "crypto";

export type PreV3CacheStageName =
  | "dbSessionLoad"
  | "genreProfileBuild"
  | "userHistoryFetch"
  | "librarySignalLoad"
  | "promptNormalization"
  | "embeddingPrep";

export type PreV3StageProfile = {
  stage: PreV3CacheStageName;
  durationMs: number;
  cacheHit: boolean;
  inputSize: number;
  outputSize: number;
};

export type PreV3CacheEntry<T> = {
  value: T;
  createdAt: number;
  stageProfiles: PreV3StageProfile[];
  recomputationCount: number;
};

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 250;
const cache = new Map<string, PreV3CacheEntry<unknown>>();

export function preV3PromptHash(prompt: string): string {
  return createHash("sha1").update(prompt.trim().toLowerCase()).digest("hex").slice(0, 16);
}

export function preV3CacheKey(opts: {
  userId: string;
  sessionId?: string | null;
  prompt: string;
  libraryFingerprint?: string | null;
}): string {
  return [
    "pre-v3-v1",
    opts.userId,
    opts.sessionId ?? "sessionless",
    preV3PromptHash(opts.prompt),
    opts.libraryFingerprint ?? "libraryless",
  ].join(":");
}

export function getPreV3Cache<T>(key: string, ttlMs = DEFAULT_TTL_MS): PreV3CacheEntry<T> | null {
  const entry = cache.get(key) as PreV3CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() - entry.createdAt > ttlMs) {
    cache.delete(key);
    return null;
  }
  return entry;
}

export function setPreV3Cache<T>(
  key: string,
  value: T,
  stageProfiles: PreV3StageProfile[],
  recomputationCount: number
): void {
  cache.set(key, {
    value,
    createdAt: Date.now(),
    stageProfiles,
    recomputationCount,
  });
  while (cache.size > MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}
