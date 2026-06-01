/**
 * Emotional leap — controlled chaos (5–12% of playlist) via small score nudges.
 */

import type { RootGenre, TrackGenreClassification } from "../../lib/genre-taxonomy";
import type { EmotionProfile } from "../../lib/emotion";
import type { SceneGenreRouting } from "../scene-intelligence/scene-genre-routing";
import { scenePoolMultiplier } from "../scene-intelligence/scene-genre-routing";
import type { TruthAnchorStore } from "../genre-intelligence/genre-truth-anchor";
import { getTruthAnchor } from "../genre-intelligence/genre-truth-anchor";
import { graphRelatedGenres } from "../../shared/embeddings/genre-similarity-graph";
import type { ContradictionProfile } from "../scene-intelligence/contradiction-handler";
import { contradictionBridgeFit } from "../scene-intelligence/contradiction-handler";
import {
  resolveSceneContext,
  sceneMatchScore,
  toSceneAudioTrack,
  type SceneContext,
} from "../../lib/scene-validation";
import type { HybridScoreResult } from "../../lib/hybrid-scoring";
import type { CanonicalSceneResult } from "../../lib/scene-canonicalizer";
import { ecosystemOf } from "../genre-intelligence/genre-ecosystems";

export type LeapType =
  | "cross_ecosystem_bridge"
  | "adjacent_genre_bridge"
  | "nostalgia_injection"
  | "contradiction_bridge";

export interface EmotionalLeapRecord {
  trackId: string;
  leapType: LeapType;
  scoreNudge: number;
  reason: string;
}

export interface EmotionalLeapContext {
  vibe: string;
  emotionProfile: EmotionProfile;
  canonical: CanonicalSceneResult | null;
  sceneRouting: SceneGenreRouting;
  truthAnchors: TruthAnchorStore;
  classifications: Map<string, TrackGenreClassification>;
  contradiction: ContradictionProfile;
  leapProbability: number;
  playlistLength: number;
  seed: number;
}

const LEAP_NUDGE_MIN = 0.05;
const LEAP_NUDGE_MAX = 0.1;

function seededUnit(seed: string, salt: number): number {
  let h = salt;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return ((h & 0xffff) / 0xffff);
}

function isGenreAllowedForLeap(
  fam: RootGenre,
  anchorFam: RootGenre | undefined,
  sceneRouting: SceneGenreRouting
): boolean {
  if (fam === "unknown" || fam === "christmas") return false;
  const mult = scenePoolMultiplier(fam, sceneRouting);
  if (mult < 0.75) return false;
  if (!anchorFam) return true;
  if (fam === anchorFam) return true;
  const anchorEco = ecosystemOf(anchorFam);
  const famEco = ecosystemOf(fam);
  if (anchorEco && famEco && anchorEco === famEco) return true;
  const related = graphRelatedGenres(anchorFam, 1);
  return related.includes(fam);
}

function pickLeapType(
  track: {
    trackId: string;
    energy: number | null;
    valence: number | null;
  },
  ctx: EmotionalLeapContext,
  anchorFam: RootGenre | undefined,
  sceneCtx: SceneContext
): { type: LeapType; reason: string } | null {
  const c = ctx.classifications.get(track.trackId);
  const fam = c?.genreFamily ?? "unknown";

  if (ctx.contradiction.active) {
    const bridge = contradictionBridgeFit(track, ctx.contradiction);
    if (bridge > 0.45 && isGenreAllowedForLeap(fam, anchorFam, ctx.sceneRouting)) {
      return { type: "contradiction_bridge", reason: ctx.contradiction.label ?? "contradiction" };
    }
  }

  const sceneFit = sceneMatchScore(sceneCtx, ctx.emotionProfile, toSceneAudioTrack(track));
  if (sceneFit < 0.42) return null;

  if (anchorFam && fam !== anchorFam) {
    const ae = ecosystemOf(anchorFam);
    const fe = ecosystemOf(fam);
    if (ae && fe && ae !== fe) {
      return { type: "cross_ecosystem_bridge", reason: `${ae}_to_${fe}` };
    }
    return { type: "adjacent_genre_bridge", reason: `${anchorFam}_to_${fam}` };
  }

  const r = seededUnit(track.trackId, ctx.seed);
  if (r > 0.7 && sceneFit > 0.5) {
    return { type: "nostalgia_injection", reason: "nostalgia_adjacent" };
  }

  return null;
}

export function applyEmotionalLeaps<T extends {
  trackId: string;
  score: number;
  energy: number | null;
  valence: number | null;
  acousticness?: number | null;
  danceability?: number | null;
}>(
  tracks: T[],
  ctx: EmotionalLeapContext
): { tracks: T[]; leaps: EmotionalLeapRecord[] } {
  const targetLeaps = Math.max(
    1,
    Math.min(
      Math.ceil(ctx.playlistLength * ctx.leapProbability),
      Math.ceil(tracks.length * 0.12)
    )
  );

  const sceneCtx = resolveSceneContext(ctx.vibe, ctx.canonical, ctx.emotionProfile, null);
  const candidates: { track: T; leap: { type: LeapType; reason: string }; priority: number }[] = [];

  for (const track of tracks) {
    const anchor = getTruthAnchor(ctx.truthAnchors, track.trackId);
    const anchorFam = anchor?.canonicalFamily;
    const leap = pickLeapType(track, ctx, anchorFam, sceneCtx);
    if (!leap) continue;

    const c = ctx.classifications.get(track.trackId);
    const fam = c?.genreFamily ?? "unknown";
    if (!isGenreAllowedForLeap(fam, anchorFam, ctx.sceneRouting)) continue;

    const sceneFit = sceneMatchScore(sceneCtx, ctx.emotionProfile, toSceneAudioTrack(track));
    const priority = sceneFit * 0.6 + seededUnit(track.trackId, ctx.seed + 7) * 0.4;
    candidates.push({ track, leap, priority });
  }

  candidates.sort((a, b) => b.priority - a.priority);
  const selected = candidates.slice(0, targetLeaps);
  const leaps: EmotionalLeapRecord[] = [];
  const out = tracks.map((t) => {
    const sel = selected.find((s) => s.track.trackId === t.trackId);
    if (!sel) return t;
    const nudge =
      LEAP_NUDGE_MIN +
      (LEAP_NUDGE_MAX - LEAP_NUDGE_MIN) * seededUnit(t.trackId, ctx.seed + 13);
    leaps.push({
      trackId: t.trackId,
      leapType: sel.leap.type,
      scoreNudge: Math.round(nudge * 1000) / 1000,
      reason: sel.leap.reason,
    });
    return { ...t, score: t.score + nudge };
  });

  return { tracks: out, leaps };
}

/** Apply leaps to hybrid results before post-score modifiers. */
export function applyEmotionalLeapsToHybridResults<T extends {
  trackId: string;
  energy: number | null;
  valence: number | null;
  acousticness?: number | null;
  danceability?: number | null;
}>(
  hybridResults: HybridScoreResult<T>[],
  ctx: EmotionalLeapContext
): { results: HybridScoreResult<T>[]; leaps: EmotionalLeapRecord[] } {
  const flat = hybridResults.map((r) => ({
    trackId: r.track.trackId,
    score: r.score,
    energy: r.track.energy,
    valence: r.track.valence,
    acousticness: r.track.acousticness ?? null,
    danceability: r.track.danceability ?? null,
  }));
  const { tracks, leaps } = applyEmotionalLeaps(flat, ctx);
  const scoreById = new Map(tracks.map((t) => [t.trackId, t.score]));
  const results = hybridResults.map((r) => {
    const next = scoreById.get(r.track.trackId);
    return next != null && next !== r.score ? { ...r, score: next } : r;
  });
  return { results, leaps };
}

export function tagMagicMomentCandidates<T extends {
  trackId: string;
  score: number;
  energy: number | null;
  valence: number | null;
  rediscoveryScore?: number;
}>(
  tracks: T[],
  opts: {
    sceneCtx: SceneContext;
    emotionProfile: EmotionProfile;
    librarySignals: import("../../lib/library-signals").LibrarySignals;
    leapTrackIds: Set<string>;
    classifications: Map<string, TrackGenreClassification>;
  }
): { trackId: string; magicMomentCandidate: boolean; resonance: number }[] {
  return tracks.map((t) => {
    const sceneFit = sceneMatchScore(opts.sceneCtx, opts.emotionProfile, toSceneAudioTrack(t));
    const emotionFit =
      1 -
      (Math.abs((t.energy ?? 0.5) - opts.emotionProfile.energy) +
        Math.abs((t.valence ?? 0.5) - opts.emotionProfile.valence)) /
        2;
    const resonance = sceneFit * 0.55 + emotionFit * 0.45;

    const signal = opts.librarySignals.tracks.get(t.trackId);
    const lowHistory =
      !signal || signal.playlistAppearances <= 1 || (signal.daysSinceSurfaced ?? 0) > 30;
    const surpriseAlign = opts.leapTrackIds.has(t.trackId) || (t.rediscoveryScore ?? 0) > 0.45;

    const magicMomentCandidate =
      resonance >= 0.62 && sceneFit >= 0.55 && lowHistory && surpriseAlign;

    return {
      trackId: t.trackId,
      magicMomentCandidate,
      resonance: Math.round(resonance * 1000) / 1000,
    };
  });
}
