/**
 * Playlist composition — selection and ordering only (no scoring formula changes).
 */

import type { EmotionProfile, VibeKind } from "../../lib/emotion";
import {
  buildPlaylistStructure,
  filterDeadZones,
  smoothEnergyCurve,
  separateAdjacentArtists,
  enforceArc,
  limitArtistRepetition,
} from "../../lib/emotion";
import { applyRediscoveryPoolBias } from "../../lib/emotional-discovery";
import { injectControlledSurprise } from "../../lib/controlled-surprise";
import { assignNarrativeRoles, type TrackNarrativeRole } from "../../lib/narrative-roles";
import type { JourneyArc } from "../../lib/emotion-destination";
import type { IntentDecodeResult } from "../../lib/intent-decoder";
import type { HumanIntent } from "../../lib/intent-decoder";
import type { SurpriseMix } from "../../lib/human-surprise";
import type { CanonicalSceneResult } from "../../lib/scene-canonicalizer";
import { placeEmotionalPeak } from "./emotional-peak";
import { applyEmotionalGradientFlow } from "./emotional-gradient-flow";
import type { TrackGravityProfile } from "../scoring-engine/taste-gravity";

export interface ComposePlaylistInput<T extends {
  trackId: string;
  score: number;
  rediscoveryScore: number;
  gravityScore?: number;
  emotionalMass?: number;
  surpriseTier?: TrackGravityProfile["surpriseTier"];
  historicalAffinity?: number;
  explorationDistance?: number;
  resonanceStrength?: number;
  stickiness?: number;
}> {
  sortedPool: T[];
  playlistLength: number;
  mode: "strict" | "balanced" | "chaotic";
  maxPerArtist: number;
  emotionProfile: EmotionProfile;
  vibeKind: VibeKind;
  journeyArc: JourneyArc;
  surpriseMix: SurpriseMix;
  humanIntent: IntentDecodeResult;
  vibe: string;
  canonical: CanonicalSceneResult | null;
}

type ComposePoolTrack = {
  trackId: string;
  score: number;
  rediscoveryScore: number;
  energy: number | null;
  valence: number | null;
  artistName: string;
  gravityScore?: number;
  emotionalMass?: number;
  surpriseTier?: TrackGravityProfile["surpriseTier"];
  historicalAffinity?: number;
  explorationDistance?: number;
  resonanceStrength?: number;
  stickiness?: number;
};

type ComposedTrack<T extends ComposePoolTrack> = T & { narrativeRole: TrackNarrativeRole };

export interface ComposePlaylistResult<T> {
  finalTracks: T[];
  structured: T[];
  poolTarget: number;
  afterDeadZone: T[];
  afterSmoothing: T[];
  afterArtistSep: T[];
  afterArc: T[];
  emotionalPeakTrackId: string | null;
  emotionalPeakIndex: number | null;
  gradientPhases: { start: number; explore: number; peak: number; resolve: number };
}

export function composePlaylistFromPool<T extends ComposePoolTrack>(
  input: ComposePlaylistInput<T>
): ComposePlaylistResult<ComposedTrack<T>> {
  const {
    sortedPool,
    playlistLength,
    mode,
    maxPerArtist,
    emotionProfile,
    vibeKind,
    journeyArc,
    surpriseMix,
    humanIntent,
    vibe,
    canonical,
  } = input;

  const poolTarget = Math.max(Math.ceil(playlistLength * 3), 75);
  const poolBiased = applyRediscoveryPoolBias(sortedPool, surpriseMix, poolTarget * 2);
  const diversified = limitArtistRepetition(poolBiased, maxPerArtist);

  const structured = buildPlaylistStructure(
    diversified,
    poolTarget,
    mode
  );

  const pool = structured.slice(0, poolTarget);
  const halfLen = Math.floor(pool.length / 2);
  for (let i = halfLen - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]!];
  }
  const shuffledStructured = [...pool, ...structured.slice(poolTarget)];

  const afterDeadZone = filterDeadZones(shuffledStructured, playlistLength);
  const isSpecificLateScene =
    emotionProfile.timeOfDay === "late_night" &&
    (emotionProfile.environment === "urban" || emotionProfile.nostalgia > 0.45);
  const lowEnergyTarget = emotionProfile.energy < 0.25;
  const energyWindow =
    vibeKind === "sunny"
      ? 0.28
      : isSpecificLateScene
        ? 0.42
        : lowEnergyTarget
          ? 0.48
          : 0.5;
  const smoothMin = Math.max(0.05, emotionProfile.energy - energyWindow);
  const smoothMax = Math.min(0.95, emotionProfile.energy + energyWindow);
  let afterSmoothing = smoothEnergyCurve(afterDeadZone, smoothMin, smoothMax);
  if (afterSmoothing.length < playlistLength && afterDeadZone.length >= playlistLength) {
    afterSmoothing = afterDeadZone;
  }
  const afterArtistSep = separateAdjacentArtists(afterSmoothing);
  const afterArc = enforceArc(afterArtistSep, emotionProfile, journeyArc);

  let finalTracks: ComposedTrack<T>[] = assignNarrativeRoles(
    afterArc.slice(0, playlistLength),
    journeyArc
  );

  const wildcardPool = sortedPool.slice(0, Math.min(sortedPool.length, poolTarget * 3));
  finalTracks = assignNarrativeRoles(
    injectControlledSurprise(
      finalTracks,
      wildcardPool,
      emotionProfile,
      surpriseMix,
      humanIntent.intent as HumanIntent,
      playlistLength
    ),
    journeyArc
  );

  const peakPlacement = placeEmotionalPeak(finalTracks, wildcardPool, {
    vibe,
    emotionProfile,
    canonical,
    playlistLength,
  });
  finalTracks = peakPlacement.tracks as ComposedTrack<T>[];

  const gravityByTrackId = new Map<string, TrackGravityProfile>();
  for (const t of sortedPool) {
    if (t.gravityScore == null && t.emotionalMass == null) continue;
    gravityByTrackId.set(t.trackId, {
      trackId: t.trackId,
      gravityScore: t.gravityScore ?? 0,
      emotionalMass: t.emotionalMass ?? 0,
      sceneAffinity: 0.5,
      memoryStrength: 0.4,
      explorationDistance: t.explorationDistance ?? 0.4,
      historicalAffinity: t.historicalAffinity ?? 0.4,
      resonanceStrength: t.resonanceStrength ?? 0.5,
      stickiness: t.stickiness ?? 0,
      wellPull: 0,
      surpriseTier: t.surpriseTier ?? "grounded",
    });
  }

  const gradient =
    gravityByTrackId.size >= 4
      ? applyEmotionalGradientFlow({
          tracks: finalTracks,
          playlistLength,
          gravityByTrackId,
          peakTrackId: peakPlacement.peakTrackId,
        })
      : { tracks: finalTracks, phases: { start: 0, explore: 0, peak: 0, resolve: finalTracks.length } };

  finalTracks = assignNarrativeRoles(gradient.tracks, journeyArc);

  return {
    finalTracks,
    structured,
    poolTarget,
    afterDeadZone,
    afterSmoothing,
    afterArtistSep,
    afterArc,
    emotionalPeakTrackId: peakPlacement.peakTrackId,
    emotionalPeakIndex: peakPlacement.peakIndex,
    gradientPhases: gradient.phases,
  };
}
