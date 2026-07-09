/**
 * Contextual Uniqueness Penalty (CUP) — primary-path scoring adjunct.
 *
 * Penalises tracks that have recently won across many unrelated playlist identity
 * contexts. Complements count-based cross-playlist novelty.
 */

import type { EmotionProfile } from "./emotion";
import type { CuratorIdentityType } from "./curator-identity";
import { detectPromptCentralArtists } from "./session-artist-gravity";
import { detectPromptExplicitAlbum } from "./playlist-identity-distance";

export const CUP_MIN_CONTEXT_SPREAD = 3;
export const CUP_MAX_PENALTY = 0.15;
export const CUP_WINNER_TOP_K = 20;

export type PlaylistContextFingerprint = {
  category: string;
  curatorType: string;
  primaryGenreFamily: string;
  activity: string;
  energyBand: string;
};

export type PriorWinningPlaylist = {
  trackIds: string[];
  context: PlaylistContextFingerprint;
};

export type ContextualTrackMemory = {
  trackWinningContexts: Map<string, Set<string>>;
  trackArtists: Map<string, string>;
  priorPlaylistCount: number;
};

export type ContextualUniquenessConfig = {
  enabled: boolean;
  memory: ContextualTrackMemory;
  thinLibraryRelaxed?: boolean;
  explicitArtistOrAlbumPrompt?: boolean;
  minSpread?: number;
  maxPenalty?: number;
};

export type ContextualUniquenessDiagnosticEntry = {
  track: string;
  artist: string;
  contextSpread: number;
  contexts: string[];
  penaltyApplied: number;
  bypassReason: string | null;
};

export type ContextualUniquenessDiagnostics = {
  priorPlaylistCount: number;
  penalisedTracks: ContextualUniquenessDiagnosticEntry[];
  enabled: boolean;
  relaxedDueToThinLibrary: boolean;
  explicitPromptBypass: boolean;
};

export function energyBand(
  energy: "low" | "medium" | "high" | null | undefined,
  emotionEnergy?: number | null,
): string {
  if (energy === "low") return "low-energy";
  if (energy === "medium") return "medium-energy";
  if (energy === "high") return "high-energy";
  if (typeof emotionEnergy === "number" && Number.isFinite(emotionEnergy)) {
    if (emotionEnergy < 0.4) return "low-energy";
    if (emotionEnergy > 0.65) return "high-energy";
    return "medium-energy";
  }
  return "unknown-energy";
}

export function inferCategoryFromVibe(vibe: string): string {
  const lower = vibe.toLowerCase();
  if (/\b(?:gym|workout|lifting|cardio|run|running|pump)\b/.test(lower)) return "gym";
  if (/\b(?:focus|study|coding|deep work|homework|reading|office)\b/.test(lower)) return "focus";
  if (/\b(?:party|club|pre\s*drinks|night\s*out|rave|house party)\b/.test(lower)) return "party";
  if (/\b(?:chill|relax|calm|evening|unwind|cosy|cozy)\b/.test(lower)) return "chill";
  if (/\b(?:drive|driving|road|motorway|car|highway)\b/.test(lower)) return "drive";
  if (/\b(?:sleep|bedtime|rainy|morning)\b/.test(lower)) return "mood";
  return "general";
}

export function buildPlaylistContextFingerprint(input: {
  category?: string | null;
  curatorIdentityType: CuratorIdentityType | string;
  primaryGenreFamily?: string | null;
  activity?: string | null;
  energy?: "low" | "medium" | "high" | null;
  emotionProfile?: EmotionProfile | null;
}): PlaylistContextFingerprint {
  return {
    category: (input.category ?? "general").toLowerCase().trim() || "general",
    curatorType: String(input.curatorIdentityType ?? "balanced_curator"),
    primaryGenreFamily: (input.primaryGenreFamily ?? "unknown").toLowerCase().trim() || "unknown",
    activity: (input.activity ?? "none").toLowerCase().trim() || "none",
    energyBand: energyBand(input.energy ?? null, input.emotionProfile?.energy ?? null),
  };
}

export function formatContextFingerprint(fp: PlaylistContextFingerprint): string {
  return `${fp.category}|${fp.curatorType}|${fp.primaryGenreFamily}|${fp.activity}|${fp.energyBand}`;
}

export function winningTrackIds(trackIds: string[], topK = CUP_WINNER_TOP_K): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const id of trackIds) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    unique.push(trimmed);
    if (unique.length >= topK) break;
  }
  return unique;
}

export function buildContextualTrackMemory(
  priorPlaylists: PriorWinningPlaylist[],
  trackIdToArtist?: Map<string, string>,
  topK = CUP_WINNER_TOP_K,
): ContextualTrackMemory {
  const trackWinningContexts = new Map<string, Set<string>>();
  const trackArtists = new Map<string, string>();

  for (const playlist of priorPlaylists) {
    const contextKey = formatContextFingerprint(playlist.context);
    for (const trackId of winningTrackIds(playlist.trackIds, topK)) {
      const contexts = trackWinningContexts.get(trackId) ?? new Set<string>();
      contexts.add(contextKey);
      trackWinningContexts.set(trackId, contexts);
      if (trackIdToArtist?.has(trackId)) {
        trackArtists.set(trackId, trackIdToArtist.get(trackId)!);
      }
    }
  }

  return {
    trackWinningContexts,
    trackArtists,
    priorPlaylistCount: priorPlaylists.length,
  };
}

export function buildContextualTrackMemoryFromHistoryRows(
  rows: Array<{ vibe: string; trackIds?: string[] | null; emotionProfile?: EmotionProfile | null }>,
  trackIdToArtist: Map<string, string>,
  resolveContext?: (row: { vibe: string; emotionProfile?: EmotionProfile | null }) => PlaylistContextFingerprint,
): ContextualTrackMemory {
  const priorPlaylists: PriorWinningPlaylist[] = rows
    .filter((row) => Array.isArray(row.trackIds) && row.trackIds.length > 0)
    .map((row) => ({
      trackIds: row.trackIds as string[],
      context: resolveContext
        ? resolveContext(row)
        : buildPlaylistContextFingerprint({
            category: inferCategoryFromVibe(row.vibe),
            curatorIdentityType: inferCuratorTypeFromVibe(row.vibe),
            primaryGenreFamily: "unknown",
            activity: inferActivityFromVibe(row.vibe),
            emotionProfile: row.emotionProfile ?? null,
          }),
    }));
  return buildContextualTrackMemory(priorPlaylists, trackIdToArtist);
}

function inferCuratorTypeFromVibe(vibe: string): CuratorIdentityType | string {
  const lower = vibe.toLowerCase();
  if (/\b(?:gym|workout|lifting|cardio|run|running|pump)\b/.test(lower)) return "gym_beast";
  if (/\b(?:focus|study|coding|deep work|homework|reading|office)\b/.test(lower)) return "focus_minimalist";
  if (/\b(?:party|club|pre\s*drinks|night\s*out|rave|house party)\b/.test(lower)) return "party_social";
  if (/\b(?:drive|driving|road|motorway|car|highway)\b/.test(lower)) return "drive_nostalgic";
  if (/\b(?:chill|relax|calm|evening|unwind|cosy|cozy)\b/.test(lower)) return "chill_warm";
  return "balanced_curator";
}

function inferActivityFromVibe(vibe: string): string {
  const lower = vibe.toLowerCase();
  if (/\b(?:gym|workout|lifting|cardio|run|running|pump)\b/.test(lower)) return "gym";
  if (/\b(?:focus|study|coding|deep work|homework|reading|office)\b/.test(lower)) return "focus";
  if (/\b(?:party|club|pre\s*drinks|night\s*out|rave|house party)\b/.test(lower)) return "party";
  if (/\b(?:drive|driving|road|motorway|car|highway)\b/.test(lower)) return "driving";
  if (/\b(?:chill|relax|calm|evening|unwind|cosy|cozy)\b/.test(lower)) return "chill";
  return "none";
}

export function contextSpreadForTrack(memory: ContextualTrackMemory, trackId: string): number {
  return memory.trackWinningContexts.get(trackId)?.size ?? 0;
}

export function contextsForTrack(memory: ContextualTrackMemory, trackId: string): string[] {
  const contexts = memory.trackWinningContexts.get(trackId);
  return contexts ? [...contexts].sort() : [];
}

export function contextualUniquenessPenalty(
  contextSpread: number,
  opts?: { minSpread?: number; maxPenalty?: number },
): number {
  const minSpread = opts?.minSpread ?? CUP_MIN_CONTEXT_SPREAD;
  const maxPenalty = opts?.maxPenalty ?? CUP_MAX_PENALTY;
  if (contextSpread < minSpread) return 0;
  const excess = contextSpread - minSpread + 1;
  return Math.round(Math.min(maxPenalty, 0.05 + excess * 0.025) * 1000) / 1000;
}

export function isExplicitArtistOrAlbumPrompt(vibe: string): boolean {
  return detectPromptCentralArtists(vibe).size > 0 || detectPromptExplicitAlbum(vibe);
}

export function applyContextualUniquenessPenalty(
  score: number,
  trackId: string,
  artistName: string,
  config: ContextualUniquenessConfig | undefined,
): {
  score: number;
  penalty: number;
  contextSpread: number;
  contexts: string[];
  bypassReason: string | null;
} {
  const spread = config?.enabled ? contextSpreadForTrack(config.memory, trackId) : 0;
  const contexts = config?.enabled ? contextsForTrack(config.memory, trackId) : [];

  if (!config?.enabled || config.memory.priorPlaylistCount === 0) {
    return { score, penalty: 0, contextSpread: spread, contexts, bypassReason: "no_context_memory" };
  }
  if (config.thinLibraryRelaxed) {
    return { score, penalty: 0, contextSpread: spread, contexts, bypassReason: "thin_library_relaxed" };
  }
  if (config.explicitArtistOrAlbumPrompt) {
    return { score, penalty: 0, contextSpread: spread, contexts, bypassReason: "explicit_artist_or_album_prompt" };
  }

  const penalty = contextualUniquenessPenalty(spread, {
    minSpread: config.minSpread,
    maxPenalty: config.maxPenalty,
  });
  if (penalty <= 0) {
    return { score, penalty: 0, contextSpread: spread, contexts, bypassReason: "spread_below_threshold" };
  }

  return {
    score: Math.max(0.05, score - penalty),
    penalty,
    contextSpread: spread,
    contexts,
    bypassReason: null,
  };
}

export function buildContextualUniquenessDiagnostics(
  entries: ContextualUniquenessDiagnosticEntry[],
  config: ContextualUniquenessConfig | undefined,
): ContextualUniquenessDiagnostics {
  return {
    priorPlaylistCount: config?.memory.priorPlaylistCount ?? 0,
    penalisedTracks: entries
      .filter((entry) => entry.penaltyApplied > 0 || entry.contextSpread >= (config?.minSpread ?? CUP_MIN_CONTEXT_SPREAD))
      .sort((a, b) => b.penaltyApplied - a.penaltyApplied || b.contextSpread - a.contextSpread)
      .slice(0, 24),
    enabled: config?.enabled === true,
    relaxedDueToThinLibrary: config?.thinLibraryRelaxed === true,
    explicitPromptBypass: config?.explicitArtistOrAlbumPrompt === true,
  };
}

export function resolveContextualUniquenessDiagnostics(
  scoringDiagnostics: Record<string, unknown> | undefined,
): ContextualUniquenessDiagnostics | null {
  const direct = scoringDiagnostics?.contextualUniquenessDiagnostics;
  if (direct && typeof direct === "object") {
    return direct as ContextualUniquenessDiagnostics;
  }
  const audit = scoringDiagnostics?.contextualUniquenessAuditSample;
  if (Array.isArray(audit) && audit.length > 0) {
    return {
      priorPlaylistCount: 0,
      penalisedTracks: audit as ContextualUniquenessDiagnosticEntry[],
      enabled: true,
      relaxedDueToThinLibrary: false,
      explicitPromptBypass: false,
    };
  }
  return null;
}

export type EvaluationPlaylistContextRow = {
  trackIds: string[];
  context: PlaylistContextFingerprint;
};

export function parseEvaluationPlaylistContexts(
  rawBody: Record<string, unknown>,
  auditMode: boolean,
): EvaluationPlaylistContextRow[] {
  if (!auditMode) return [];
  const memory = rawBody["evaluationSessionMemory"];
  if (!memory || typeof memory !== "object" || Array.isArray(memory)) return [];
  const contexts = (memory as Record<string, unknown>)["previousPlaylistContexts"];
  if (!Array.isArray(contexts)) return [];

  const rows: EvaluationPlaylistContextRow[] = [];
  for (const entry of contexts) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const trackIds = Array.isArray(row["trackIds"])
      ? row["trackIds"].filter((id): id is string => typeof id === "string" && id.trim().length > 0).map((id) => id.trim())
      : [];
    const context = row["context"];
    if (trackIds.length === 0 || !context || typeof context !== "object") continue;
    const ctx = context as Record<string, unknown>;
    rows.push({
      trackIds,
      context: {
        category: String(ctx["category"] ?? "general"),
        curatorType: String(ctx["curatorType"] ?? "balanced_curator"),
        primaryGenreFamily: String(ctx["primaryGenreFamily"] ?? "unknown"),
        activity: String(ctx["activity"] ?? "none"),
        energyBand: String(ctx["energyBand"] ?? "unknown-energy"),
      },
    });
  }
  return rows.slice(0, 20);
}
