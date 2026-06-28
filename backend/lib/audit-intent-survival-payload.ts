/**
 * Ensures audit / benchmark responses always include intent survival diagnostics
 * on successful playlist delivery — independent of which response path fired.
 */

import type { LockedIntent } from "../core/v3/intent";
import type { IntentUnderstandingDiagnostics } from "./intent-understanding-diagnostics";
import {
  buildIntentSurvivalDiagnostics,
  type IntentSurvivalDiagnostics,
  type SurvivalTrack,
  type TrackClassification,
} from "./intent-survival-diagnostics";

export type GenerateContextLike = Record<string, unknown> | null | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function incrementDistribution(
  acc: Record<string, number>,
  key: string | null | undefined,
): Record<string, number> {
  const normalized = (key ?? "unknown").trim() || "unknown";
  acc[normalized] = (acc[normalized] ?? 0) + 1;
  return acc;
}

function eraBucket(year: number | null | undefined): string {
  if (year == null || !Number.isFinite(year)) return "unknown";
  if (year < 1970) return "pre-70s";
  if (year < 1980) return "70s";
  if (year < 1990) return "80s";
  if (year < 2000) return "90s";
  if (year < 2010) return "00s";
  if (year < 2020) return "10s";
  return "20s";
}

function moodBucket(energy: number | null | undefined, valence: number | null | undefined): string {
  const e = typeof energy === "number" ? energy : 0.5;
  const v = typeof valence === "number" ? valence : 0.5;
  if (e >= 0.72 && v >= 0.55) return "energetic_positive";
  if (e >= 0.72) return "energetic";
  if (v <= 0.35) return "melancholic";
  if (e <= 0.35) return "calm";
  return "balanced";
}

function energyBucket(energy: number | null | undefined): string {
  if (typeof energy !== "number") return "unknown";
  if (energy < 0.35) return "low";
  if (energy < 0.72) return "medium";
  return "high";
}

export function apiTracksToSurvivalTracks(tracks: unknown[]): SurvivalTrack[] {
  return tracks.map((raw) => {
    const track = raw as Record<string, unknown>;
    const genres = Array.isArray(track.genres) ? track.genres.map(String) : null;
    return {
      trackId: String(track.id ?? track.trackId ?? ""),
      trackName: (track.name ?? track.trackName ?? null) as string | null,
      artistName: (track.artist ?? track.artistName ?? null) as string | null,
      albumName: (track.albumName ?? null) as string | null,
      genrePrimary: (track.genrePrimary ?? genres?.[0] ?? null) as string | null,
      genreFamily: (track.genreFamily ?? track.genrePrimary ?? genres?.[0] ?? null) as string | null,
      genres,
      releaseYear: typeof track.releaseYear === "number" ? track.releaseYear : null,
      energy: typeof track.energy === "number" ? track.energy : null,
      valence: typeof track.valence === "number" ? track.valence : null,
      tempo: typeof track.tempo === "number" ? track.tempo : null,
      danceability: typeof track.danceability === "number" ? track.danceability : null,
      acousticness: typeof track.acousticness === "number" ? track.acousticness : null,
      sourceLane: (track.sourceLane ?? track.laneId ?? null) as string | null,
      laneId: (track.laneId ?? track.sourceLane ?? null) as string | null,
      clusterId: (track.clusterId ?? null) as string | null,
    };
  }).filter((track) => track.trackId.length > 0);
}

function distributionFromApiTracks(
  tracks: unknown[],
  pick: (track: Record<string, unknown>) => string | null | undefined,
): Record<string, number> {
  return tracks.reduce<Record<string, number>>((acc, raw) => {
    const track = raw as Record<string, unknown>;
    return incrementDistribution(acc, pick(track));
  }, {});
}

export function intentSurvivalPayloadComplete(payload: Record<string, unknown>): boolean {
  const intentSurvival = payload.intentSurvival;
  if (!isRecord(intentSurvival)) return false;
  const scores = intentSurvival.scores;
  if (!isRecord(scores)) return false;
  if (typeof scores.overallIntentSurvival !== "number") return false;
  if (typeof scores.emotionSurvival !== "number") return false;
  if (typeof scores.subgenreSurvival !== "number") return false;
  const emotionSurvival = intentSurvival.emotionSurvival;
  if (!isRecord(emotionSurvival)) return false;
  if (typeof emotionSurvival.survivalPercent !== "number") return false;
  return true;
}

function resolveV3PipelineRecord(ctx: GenerateContextLike): Record<string, unknown> | null {
  if (!isRecord(ctx?.v3Diagnostics)) return null;
  const raw = ctx.v3Diagnostics as Record<string, unknown>;
  const pipeline = raw.v3Pipeline;
  return isRecord(pipeline) ? pipeline : raw;
}

function resolvePromptSurvivability(ctx: GenerateContextLike): Record<string, unknown> | null {
  const pipeline = resolveV3PipelineRecord(ctx);
  if (!pipeline) return null;
  const guard = pipeline.intentContractGuard;
  if (!isRecord(guard)) return null;
  const promptSurvivability = guard.promptSurvivability;
  return isRecord(promptSurvivability) ? promptSurvivability : null;
}

export function buildIntentSurvivalOptsFromGenerateContext(opts: {
  ctx: GenerateContextLike;
  prompt: string;
  apiTracks: unknown[];
  generationDiagnostics?: Record<string, unknown> | null;
  finalizationDiagnostics?: Record<string, unknown> | null;
  strictGenreEvidence?: Record<string, unknown> | null;
  strictEraEvidence?: Record<string, unknown> | null;
}): Parameters<typeof buildIntentSurvivalDiagnostics>[0] | null {
  const survivalTracks = apiTracksToSurvivalTracks(opts.apiTracks);
  if (survivalTracks.length === 0) return null;

  const ctx = opts.ctx;
  const lockedIntent = (isRecord(ctx?.lockedIntent) ? ctx.lockedIntent : undefined) as Partial<LockedIntent> | undefined;
  const classMap = ctx?.classMap instanceof Map
    ? ctx.classMap as Map<string, TrackClassification>
    : undefined;
  const v3Pipeline = resolveV3PipelineRecord(ctx);

  return {
    prompt: opts.prompt,
    lockedIntent,
    constraintLayer: isRecord(ctx?.constraintLayer) ? ctx.constraintLayer : null,
    emotionProfile: isRecord(ctx?.emotionProfile) ? ctx.emotionProfile as never : null,
    finalTracks: survivalTracks,
    classMap,
    v3Diagnostics: v3Pipeline,
    generationDiagnostics: opts.generationDiagnostics ?? (isRecord(ctx?.generationDiagnostics) ? ctx.generationDiagnostics : null),
    finalizationDiagnostics: opts.finalizationDiagnostics ?? null,
    strictGenreEvidence: opts.strictGenreEvidence ?? null,
    strictEraEvidence: opts.strictEraEvidence ?? null,
    finalGenreDistribution: distributionFromApiTracks(opts.apiTracks, (track) =>
      (track.genrePrimary ?? track.genreFamily ?? (Array.isArray(track.genres) ? track.genres[0] : null)) as string | null),
    finalEraDistribution: distributionFromApiTracks(opts.apiTracks, (track) =>
      eraBucket(typeof track.releaseYear === "number" ? track.releaseYear : null)),
    finalMoodDistribution: distributionFromApiTracks(opts.apiTracks, (track) =>
      moodBucket(
        typeof track.energy === "number" ? track.energy : null,
        typeof track.valence === "number" ? track.valence : null,
      )),
    finalEnergyDistribution: distributionFromApiTracks(opts.apiTracks, (track) =>
      energyBucket(typeof track.energy === "number" ? track.energy : null)),
    intentUnderstanding: (isRecord(ctx?.intentUnderstanding)
      ? ctx.intentUnderstanding
      : null) as IntentUnderstandingDiagnostics | null,
  };
}

export function attachIntentSurvivalToSuccessPayload(opts: {
  payload: Record<string, unknown>;
  ctx: GenerateContextLike;
  prompt: string;
  apiTracks: unknown[];
  finalizationDiagnostics?: Record<string, unknown> | null;
  strictGenreEvidence?: Record<string, unknown> | null;
  strictEraEvidence?: Record<string, unknown> | null;
}): Record<string, unknown> {
  if (intentSurvivalPayloadComplete(opts.payload)) {
    return enrichGenerationDiagnosticsFromContext(opts.payload, opts.ctx);
  }

  const buildOpts = buildIntentSurvivalOptsFromGenerateContext({
    ctx: opts.ctx,
    prompt: opts.prompt,
    apiTracks: opts.apiTracks,
    generationDiagnostics: isRecord(opts.payload.generationDiagnostics)
      ? opts.payload.generationDiagnostics
      : null,
    finalizationDiagnostics: opts.finalizationDiagnostics ?? null,
    strictGenreEvidence: opts.strictGenreEvidence ?? null,
    strictEraEvidence: opts.strictEraEvidence ?? null,
  });
  if (!buildOpts) return opts.payload;

  const intentSurvivalDiagnostics: IntentSurvivalDiagnostics = buildIntentSurvivalDiagnostics(buildOpts);
  const v3Diagnostics = isRecord(opts.payload.v3Diagnostics) ? opts.payload.v3Diagnostics : {};
  const generationDiagnostics = isRecord(opts.payload.generationDiagnostics)
    ? { ...opts.payload.generationDiagnostics }
    : {};

  return enrichGenerationDiagnosticsFromContext({
    ...opts.payload,
    intentSurvival: intentSurvivalDiagnostics,
    v3Diagnostics: {
      ...v3Diagnostics,
      intentSurvival: intentSurvivalDiagnostics,
    },
    generationDiagnostics,
  }, opts.ctx);
}

function enrichGenerationDiagnosticsFromContext(
  payload: Record<string, unknown>,
  ctx: GenerateContextLike,
): Record<string, unknown> {
  const promptSurvivability = resolvePromptSurvivability(ctx);
  if (!promptSurvivability) return payload;
  const generationDiagnostics = isRecord(payload.generationDiagnostics)
    ? { ...payload.generationDiagnostics }
    : {};
  if (isRecord(generationDiagnostics.promptSurvivability)) return payload;
  return {
    ...payload,
    generationDiagnostics: {
      ...generationDiagnostics,
      promptSurvivability,
    },
  };
}
