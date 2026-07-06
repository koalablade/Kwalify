/**
 * Degraded but valid playlist when the main pipeline exceeds time budget.
 * Uses scene prototype exclusions and hard filters when available.
 */

import type { EmotionProfile } from "./emotion";
import type { ScenePrototype } from "./scene-prototypes";
import { sampleTracksForProfile } from "./library-sample";
import { applyHardFilters, type HardFilterContext } from "./hard-filters";
import { exclusionPenalty } from "./negative-tags";
import {
  parsePromptNegatives,
  promptNegativeTrackPenalty,
  type PromptNegatives,
} from "./prompt-negatives";
import { resolveContradiction, contradictionBridgeFit } from "../core/scene-intelligence/contradiction-handler";

export const FAST_SCAN_MAX = 1200;

export interface FastFallbackSceneContext {
  emotionProfile: EmotionProfile;
  prototype: ScenePrototype | null;
  hardFilterCtx: HardFilterContext | null;
  promptNegatives: PromptNegatives;
  vibe: string;
}

function emotionFit(
  track: { energy: number | null; valence: number | null },
  profile: EmotionProfile
): number {
  const e = track.energy ?? 0.5;
  const v = track.valence ?? 0.5;
  return 1 - (Math.abs(e - profile.energy) + Math.abs(v - profile.valence)) / 2;
}

function fallbackTransitionCost(
  a: { energy: number | null; valence: number | null },
  b: { energy: number | null; valence: number | null }
): number {
  return Math.abs((a.energy ?? 0.5) - (b.energy ?? 0.5)) * 0.65 +
    Math.abs((a.valence ?? 0.5) - (b.valence ?? 0.5)) * 0.35;
}

function orderFallbackCoherently<T extends { energy: number | null; valence: number | null }>(tracks: T[]): T[] {
  if (tracks.length <= 2) return tracks;
  const remaining = [...tracks];
  const first = remaining.shift()!;
  const ordered = [first];
  while (remaining.length > 0) {
    const current = ordered[ordered.length - 1];
    let bestIndex = 0;
    let bestCost = Number.POSITIVE_INFINITY;
    for (let index = 0; index < remaining.length; index++) {
      const cost = fallbackTransitionCost(current, remaining[index]) + index * 0.006;
      if (cost < bestCost) {
        bestCost = cost;
        bestIndex = index;
      }
    }
    ordered.push(remaining.splice(bestIndex, 1)[0]);
  }
  return ordered;
}

function sceneAwareFit<T extends {
  trackId: string;
  trackName: string;
  artistName: string;
  albumName: string;
  energy: number | null;
  valence: number | null;
  danceability?: number | null;
  acousticness?: number | null;
  speechiness?: number | null;
  score?: number;
}>(
  track: T,
  profile: EmotionProfile,
  scene: FastFallbackSceneContext | undefined,
  contradiction: ReturnType<typeof resolveContradiction> | null,
  index: number,
  poolSize: number,
  recentTrackPenalty?: Map<string, number>,
  artistReusePenalty?: Map<string, number>,
): number {
  if (scene?.hardFilterCtx) {
    const hf = applyHardFilters(
      {
        trackId: track.trackId,
        trackName: track.trackName,
        artistName: track.artistName,
        albumName: track.albumName,
        energy: track.energy,
        valence: track.valence,
        danceability: track.danceability ?? null,
        acousticness: track.acousticness ?? null,
      },
      scene.hardFilterCtx,
    );
    if (!hf.pass) return -1;
  }

  let fit = emotionFit(track, profile) * 0.72 +
    Math.max(0, Math.min(1, track.score ?? 0.5)) * 0.20 +
    (1 - index / Math.max(1, poolSize)) * 0.08;

  if (scene) {
    fit += exclusionPenalty(
      {
        energy: track.energy,
        valence: track.valence,
        danceability: track.danceability ?? null,
        acousticness: track.acousticness ?? null,
        speechiness: track.speechiness ?? null,
      },
      scene.prototype ?? null,
      scene.promptNegatives.exclusionTags,
    );
    fit += promptNegativeTrackPenalty(track, scene.promptNegatives);
    if (contradiction?.active) {
      fit += contradictionBridgeFit(track, contradiction) * 0.15;
    }
  }

  fit -= Math.max(0, Math.min(0.32, recentTrackPenalty?.get(track.trackId) ?? 0)) * 0.42;
  fit -= Math.max(0, Math.min(0.94, artistReusePenalty?.get(track.artistName.toLowerCase().trim()) ?? 0)) * 0.30;
  return fit;
}

export function buildFastFallbackPlaylist<
  T extends {
    trackId: string;
    trackName: string;
    artistName: string;
    albumName: string;
    energy: number | null;
    valence: number | null;
    danceability?: number | null;
    acousticness?: number | null;
    speechiness?: number | null;
    score?: number;
  }
>(opts: {
  tracks: T[];
  emotionProfile: EmotionProfile;
  playlistLength: number;
  maxPerArtist?: number;
  recentTrackPenalty?: Map<string, number>;
  artistReusePenalty?: Map<string, number>;
  scene?: FastFallbackSceneContext;
}): T[] {
  const scene = opts.scene;
  const contradiction = scene?.vibe
    ? resolveContradiction(scene.vibe, opts.emotionProfile)
    : null;

  const pool =
    opts.tracks.length > FAST_SCAN_MAX
      ? sampleTracksForProfile(opts.tracks, FAST_SCAN_MAX)
      : opts.tracks;

  const ranked = pool
    .map((t, index) => ({
      t,
      fit: sceneAwareFit(
        t,
        opts.emotionProfile,
        scene,
        contradiction,
        index,
        pool.length,
        opts.recentTrackPenalty,
        opts.artistReusePenalty,
      ),
    }))
    .filter((row) => row.fit >= 0)
    .sort((a, b) => b.fit - a.fit);

  const maxPerArtist = opts.maxPerArtist ?? 4;
  const artistCount = new Map<string, number>();
  const usedTrackIds = new Set<string>();
  const out: T[] = [];

  const tryAdd = (t: T, artistLimit: number | null): boolean => {
    if (out.length >= opts.playlistLength) return false;
    if (usedTrackIds.has(t.trackId)) return false;
    const key = t.artistName.toLowerCase().trim();
    const n = artistCount.get(key) ?? 0;
    if (artistLimit !== null && n >= artistLimit) return false;
    artistCount.set(key, n + 1);
    usedTrackIds.add(t.trackId);
    out.push(t);
    return true;
  };

  for (const { t } of ranked) {
    if (out.length >= opts.playlistLength) break;
    tryAdd(t, maxPerArtist);
  }

  if (out.length < opts.playlistLength) {
    const relaxedMaxPerArtist = Number.isFinite(maxPerArtist) ? maxPerArtist + 1 : maxPerArtist;
    for (const { t } of ranked) {
      if (out.length >= opts.playlistLength) break;
      tryAdd(t, relaxedMaxPerArtist);
    }
  }

  if (out.length < opts.playlistLength) {
    const emergencyMaxPerArtist = Number.isFinite(maxPerArtist)
      ? maxPerArtist + Math.max(1, Math.ceil(opts.playlistLength * 0.05))
      : maxPerArtist;
    for (const { t } of ranked) {
      if (out.length >= opts.playlistLength) break;
      tryAdd(t, emergencyMaxPerArtist);
    }
  }

  return orderFallbackCoherently(out);
}
