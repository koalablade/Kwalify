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

const FAST_SCAN_MAX = 600;

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
  }
>(opts: {
  tracks: T[];
  emotionProfile: EmotionProfile;
  playlistLength: number;
  maxPerArtist?: number;
  scene?: FastFallbackSceneContext;
}): T[] {
  const scene = opts.scene;
  const negatives = scene?.promptNegatives ?? parsePromptNegatives(scene?.vibe ?? "");
  const contradiction = scene?.vibe
    ? resolveContradiction(scene.vibe, opts.emotionProfile)
    : null;

  const pool =
    opts.tracks.length > FAST_SCAN_MAX
      ? sampleTracksForProfile(opts.tracks, FAST_SCAN_MAX, Date.now())
      : opts.tracks;

  const ranked = pool
    .map((t) => {
      if (scene?.hardFilterCtx) {
        const hf = applyHardFilters(
          {
            trackId: t.trackId,
            trackName: t.trackName,
            artistName: t.artistName,
            albumName: t.albumName,
            energy: t.energy,
            valence: t.valence,
            danceability: t.danceability ?? null,
            acousticness: t.acousticness ?? null,
          },
          scene.hardFilterCtx
        );
        if (!hf.pass) return { t, fit: -1 };
      }

      let fit = emotionFit(t, opts.emotionProfile);
      fit += exclusionPenalty(
        {
          energy: t.energy,
          valence: t.valence,
          danceability: t.danceability ?? null,
          acousticness: t.acousticness ?? null,
          speechiness: t.speechiness ?? null,
        },
        scene?.prototype ?? null,
        negatives.exclusionTags
      );
      fit += promptNegativeTrackPenalty(t, negatives);
      if (contradiction?.active) {
        fit += contradictionBridgeFit(t, contradiction) * 0.15;
      }
      return { t, fit };
    })
    .filter((row) => row.fit >= 0)
    .sort((a, b) => b.fit - a.fit);

  const maxPerArtist = opts.maxPerArtist ?? 4;
  const artistCount = new Map<string, number>();
  const out: T[] = [];

  for (const { t } of ranked) {
    if (out.length >= opts.playlistLength) break;
    const key = t.artistName.toLowerCase().trim();
    const n = artistCount.get(key) ?? 0;
    if (n >= maxPerArtist) continue;
    artistCount.set(key, n + 1);
    out.push(t);
  }

  if (out.length < opts.playlistLength) {
    for (const { t } of ranked) {
      if (out.length >= opts.playlistLength) break;
      if (out.includes(t)) continue;
      out.push(t);
    }
  }

  return out;
}
