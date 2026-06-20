/**
 * Playlist composition — selection and ordering only (no scoring formula changes).
 *
 * v2 additions:
 *   - Signature Track Layer: 5–10 anchor tracks locked as backbone
 *   - Cross-phase artist distribution: same artist never in consecutive phases
 *   - Genre Bridge smoothing applied within each phase
 *   - Discovery injection formalised at 10–15%
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
import { assignNarrativeRoles, roleForIndex, type TrackNarrativeRole, type PlaylistPhase } from "../../lib/narrative-roles";
import type { JourneyArc } from "../../lib/emotion-destination";
import type { IntentDecodeResult } from "../../lib/intent-decoder";
import type { HumanIntent } from "../../lib/intent-decoder";
import type { SurpriseMix } from "../../lib/human-surprise";
import { modeWildcardScale } from "../../lib/vibe-match-guards";
import type { CanonicalSceneResult } from "../../lib/scene-canonicalizer";
import type { WorldBoundary } from "../world-boundary";
import { isTrackInWorld, trackGenreFamilyForBoundary } from "../world-boundary";
import { placeEmotionalPeak } from "./emotional-peak";
import { applyEmotionalGradientFlow } from "./emotional-gradient-flow";
import type { TrackGravityProfile } from "../scoring-engine/taste-gravity";
import { selectSignatureTracks, signatureTrackIds } from "../../lib/signature-tracks";
import { smoothGenreTransitions } from "../../lib/genre-bridge";
import type { RootGenre } from "../../lib/genre-taxonomy";
import type { SemanticSceneVector } from "../../lib/semantic-scene-engine";
import { isHardAntiGenre } from "../../lib/semantic-scene-engine";
import { classifyTrack } from "../../lib/genre-taxonomy";

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
  /** Tracks from recent playlists — deprioritized so back-to-back gens don't clone. */
  recentTrackPenalty?: Map<string, number>;
  /** When scene lock is active, filter discovery pool to ecosystem-compliant tracks only */
  ecosystemVector?: SemanticSceneVector;
  /** Hard world boundary — blocks off-scene surprise injection */
  worldBoundary?: WorldBoundary | null;
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

type ComposedTrack<T extends ComposePoolTrack> = T & {
  narrativeRole: TrackNarrativeRole;
  playlistPhase: PlaylistPhase;
};

export interface ComposePlaylistResult<T extends ComposePoolTrack> {
  finalTracks: ComposedTrack<T>[];
  structured: T[];
  poolTarget: number;
  afterDeadZone: T[];
  afterSmoothing: T[];
  afterArtistSep: T[];
  afterArc: T[];
  emotionalPeakTrackId: string | null;
  emotionalPeakIndex: number | null;
  gradientPhases: { start: number; explore: number; peak: number; resolve: number };
  /** v2: IDs of the 5–10 backbone anchor tracks */
  signatureTrackIds: Set<string>;
}

// ---------------------------------------------------------------------------
// Cross-phase artist distribution (v2 spec)
// Same artist must not appear in consecutive phases.
// Applies a best-effort swap using remaining tracks from the pool.
// ---------------------------------------------------------------------------
function distributeArtistsAcrossPhases<T extends { trackId: string; artistName: string }>(
  tracks: T[],
  phases: { start: number; explore: number; peak: number; resolve: number },
  fallbackPool: T[]
): T[] {
  const len = tracks.length;
  if (len < 8) return tracks;

  // Build inclusive index ranges per phase
  const p1End = phases.start;
  const p2End = p1End + phases.explore;
  const p3End = p2End + phases.peak;
  const phaseOf = (i: number): number => {
    if (i < p1End) return 0;
    if (i < p2End) return 1;
    if (i < p3End) return 2;
    return 3;
  };

  const result = [...tracks];
  const usedIds = new Set(result.map((t) => t.trackId));

  // Collect phase-artist occupancy
  const phaseArtists: Set<string>[] = [new Set(), new Set(), new Set(), new Set()];
  for (let i = 0; i < result.length; i++) {
    const artist = (result[i]!.artistName ?? "").toLowerCase();
    if (artist) phaseArtists[phaseOf(i)]!.add(artist);
  }

  // Find swappable replacement from fallback pool (not already in playlist)
  const unusedPool = fallbackPool.filter((t) => !usedIds.has(t.trackId));

  for (let i = 0; i < result.length; i++) {
    const track = result[i]!;
    const artist = (track.artistName ?? "").toLowerCase();
    if (!artist) continue;

    const myPhase = phaseOf(i);
    const prevPhase = myPhase - 1;
    const nextPhase = myPhase + 1;

    const conflictsPrev = prevPhase >= 0 && phaseArtists[prevPhase]!.has(artist);
    const conflictsNext = nextPhase <= 3 && phaseArtists[nextPhase]!.has(artist);

    if (!conflictsPrev && !conflictsNext) continue;

    // Try to find a swap candidate from unused pool that fits this phase
    const swapIdx = unusedPool.findIndex((candidate) => {
      const ca = (candidate.artistName ?? "").toLowerCase();
      if (!ca) return false;
      if (phaseArtists[myPhase]!.has(ca)) return false;
      if (prevPhase >= 0 && phaseArtists[prevPhase]!.has(ca)) return false;
      if (nextPhase <= 3 && phaseArtists[nextPhase]!.has(ca)) return false;
      return true;
    });

    if (swapIdx >= 0) {
      const swap = unusedPool.splice(swapIdx, 1)[0]!;
      usedIds.add(swap.trackId);
      phaseArtists[myPhase]!.delete(artist);
      phaseArtists[myPhase]!.add((swap.artistName ?? "").toLowerCase());
      result[i] = swap as T;
    }
  }

  return result;
}

function smoothAdjacentEnergySteps<T extends { energy: number | null; score: number }>(
  tracks: T[],
  maxJump = 0.30,
): T[] {
  if (tracks.length < 3) return tracks;
  const out = [...tracks];
  for (let i = 1; i < out.length; i++) {
    const prevEnergy = out[i - 1]!.energy ?? 0.5;
    const currEnergy = out[i]!.energy ?? 0.5;
    if (Math.abs(currEnergy - prevEnergy) <= maxJump) continue;
    let swapIdx = -1;
    for (let j = i + 1; j < Math.min(out.length, i + 7); j++) {
      const candidateEnergy = out[j]!.energy ?? 0.5;
      const nextEnergy = out[i + 1]?.energy ?? candidateEnergy;
      if (
        Math.abs(candidateEnergy - prevEnergy) <= maxJump &&
        Math.abs(nextEnergy - candidateEnergy) <= maxJump
      ) {
        swapIdx = j;
        break;
      }
    }
    if (swapIdx >= 0) {
      const tmp = out[i]!;
      out[i] = out[swapIdx]!;
      out[swapIdx] = tmp;
    }
  }
  return out;
}

function moodAxisForTrack(track: { energy: number | null; valence: number | null }): string {
  const v = track.valence ?? 0.5;
  if (v >= 0.55) return "bright";
  if (v <= 0.42) return "dark";
  return "neutral";
}

function energyBandLabel(track: { energy: number | null }): string {
  const e = track.energy ?? 0.5;
  if (e <= 0.42) return "low";
  if (e >= 0.55) return "high";
  return "mid";
}

function tracksShareAdjacencyContext(
  a: { energy: number | null; valence: number | null },
  b: { energy: number | null; valence: number | null },
): boolean {
  return energyBandLabel(a) === energyBandLabel(b) || moodAxisForTrack(a) === moodAxisForTrack(b);
}

function smoothContextualAdjacency<T extends { energy: number | null; valence: number | null; score: number }>(
  tracks: T[],
): T[] {
  if (tracks.length < 3) return tracks;
  const out = [...tracks];
  for (let i = 1; i < out.length; i++) {
    if (tracksShareAdjacencyContext(out[i - 1]!, out[i]!)) continue;
    for (let j = i + 1; j < Math.min(out.length, i + 8); j++) {
      if (
        tracksShareAdjacencyContext(out[i - 1]!, out[j]!) &&
        (j === out.length - 1 || tracksShareAdjacencyContext(out[j]!, out[i]!))
      ) {
        const tmp = out[i]!;
        out[i] = out[j]!;
        out[j] = tmp;
        break;
      }
    }
  }
  return out;
}

function classifyTrackEmotionalPhase(track: { energy: number | null; valence: number | null }): TrackNarrativeRole {
  const e = track.energy ?? 0.5;
  const v = track.valence ?? 0.5;
  if (e >= 0.72) return "peak";
  if (e <= 0.38 && v <= 0.5) return "introduction";
  if (e <= 0.45 && v >= 0.55) return "resolution";
  if (e <= 0.48) return "early_build";
  if (v <= 0.45 && e >= 0.5) return "reflection";
  return "momentum";
}

function reorderForEmotionalArc<T extends { trackId: string; energy: number | null; valence: number | null; score: number }>(
  tracks: T[],
): T[] {
  if (tracks.length < 8) return tracks;
  const n = tracks.length;
  const roles: TrackNarrativeRole[] = [
    "introduction", "early_build", "momentum", "peak", "reflection", "resolution",
  ];
  const rolePools = new Map<TrackNarrativeRole, T[]>();
  for (const role of roles) rolePools.set(role, []);
  for (const track of tracks) {
    rolePools.get(classifyTrackEmotionalPhase(track))!.push(track);
  }
  for (const pool of rolePools.values()) pool.sort((a, b) => b.score - a.score);

  const result: T[] = [];
  const used = new Set<string>();
  for (let i = 0; i < n; i++) {
    const targetRole = roleForIndex(i, n);
    let pick = rolePools.get(targetRole)!.find((track) => !used.has(track.trackId));
    if (!pick) {
      for (const role of roles) {
        pick = rolePools.get(role)!.find((track) => !used.has(track.trackId));
        if (pick) break;
      }
    }
    if (!pick) break;
    used.add(pick.trackId);
    result.push(pick);
  }
  for (const track of tracks) {
    if (result.length >= n) break;
    if (used.has(track.trackId)) continue;
    used.add(track.trackId);
    result.push(track);
  }
  return result.slice(0, n);
}

function limitConsecutivePhaseRepeats<T extends { energy: number | null; valence: number | null; score: number }>(
  tracks: T[],
): T[] {
  if (tracks.length < 4) return tracks;
  const out = [...tracks];
  for (let i = 2; i < out.length; i++) {
    const r0 = classifyTrackEmotionalPhase(out[i - 2]!);
    const r1 = classifyTrackEmotionalPhase(out[i - 1]!);
    const r2 = classifyTrackEmotionalPhase(out[i]!);
    if (r0 !== r1 || r1 !== r2) continue;
    for (let j = i + 1; j < Math.min(out.length, i + 6); j++) {
      if (classifyTrackEmotionalPhase(out[j]!) === r2) continue;
      const tmp = out[i]!;
      out[i] = out[j]!;
      out[j] = tmp;
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Apply genre bridge smoothing within individual phases only.
// Reordering is local to each phase so the macro emotional arc is preserved.
// ---------------------------------------------------------------------------
function smoothGenresWithinPhases<T extends { trackId: string }>(
  tracks: T[],
  phases: { start: number; explore: number; peak: number; resolve: number }
): T[] {
  const boundaries = [
    0,
    phases.start,
    phases.start + phases.explore,
    phases.start + phases.explore + phases.peak,
    tracks.length,
  ];

  const result: T[] = [];
  for (let p = 0; p < boundaries.length - 1; p++) {
    const from = boundaries[p]!;
    const to = boundaries[p + 1]!;
    const segment = tracks.slice(from, to) as (T & { genrePrimary?: RootGenre })[];
    if (segment.length <= 2) {
      result.push(...segment);
    } else {
      result.push(...smoothGenreTransitions(segment) as T[]);
    }
  }
  return result;
}

export function composePlaylistFromPool<T extends ComposePoolTrack>(
  input: ComposePlaylistInput<T>
): ComposePlaylistResult<T> {
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
    recentTrackPenalty,
  } = input;

  // ── v2: Signature Track Layer ────────────────────────────────────────────
  // Select 5–10 anchor tracks that define the playlist's sonic identity.
  // Their IDs are locked and returned in the result for front-end highlighting.
  const signatures = selectSignatureTracks(sortedPool, {
    minCount: Math.min(5, sortedPool.length),
    maxCount: Math.min(10, Math.floor(playlistLength * 0.2)),
  });
  const sigIds = signatureTrackIds(signatures);
  // ────────────────────────────────────────────────────────────────────────

  const poolTarget = Math.max(Math.ceil(playlistLength * 3), 75);
  const deprioritized =
    recentTrackPenalty && recentTrackPenalty.size > 0
      ? [...sortedPool].sort((a, b) => {
          const pa = recentTrackPenalty.get(a.trackId) ?? 0;
          const pb = recentTrackPenalty.get(b.trackId) ?? 0;
          if (pa !== pb) return pa - pb;
          return b.score - a.score;
        })
      : sortedPool;
  const scaledSurprise: SurpriseMix = {
    ...surpriseMix,
    wildcardRatio:
      surpriseMix.wildcardRatio * modeWildcardScale(mode),
  };
  const poolBiased = applyRediscoveryPoolBias(deprioritized, scaledSurprise, poolTarget * 2);
  const diversified = limitArtistRepetition(poolBiased, maxPerArtist);

  const structured = buildPlaylistStructure(
    diversified,
    poolTarget,
    mode
  );

  const pool = structured.slice(0, poolTarget);
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
  const afterEnergySteps = smoothAdjacentEnergySteps(afterArtistSep);
  const afterArc = enforceArc(afterEnergySteps, emotionProfile, journeyArc);
  const afterSequencing = limitConsecutivePhaseRepeats(
    smoothContextualAdjacency(reorderForEmotionalArc(afterArc)),
  );

  let finalTracks: ComposedTrack<T>[] = assignNarrativeRoles(
    afterSequencing.slice(0, playlistLength),
    journeyArc
  );

  // When ecosystem lock is active, restrict discovery pool to ecosystem-compliant tracks only.
  // This prevents anti-genre tracks leaking in through the controlled-surprise injection path.
  const rawWildcardPool = sortedPool.slice(0, Math.min(sortedPool.length, poolTarget * 3));
  const wildcardPool = input.worldBoundary?.active
    ? rawWildcardPool.filter((t) => isTrackInWorld(
      {
        trackId: t.trackId,
        genreFamily: trackGenreFamilyForBoundary(t as { trackId: string; genrePrimary?: string | null }),
      },
      input.worldBoundary!,
    ))
    : input.ecosystemVector
    ? rawWildcardPool.filter((t) => {
        const classification = classifyTrack(t as unknown as { trackId: string; trackName: string; artistName: string; albumName: string; energy: number | null; valence: number | null; tempo: number | null; danceability: number | null; acousticness: number | null });
        return !isHardAntiGenre(classification, input.ecosystemVector!);
      })
    : rawWildcardPool;
  finalTracks = assignNarrativeRoles(
    input.worldBoundary?.hardLock
      ? finalTracks
      : injectControlledSurprise(
        finalTracks,
        wildcardPool,
        emotionProfile,
        scaledSurprise,
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

  // ── v2: Cross-phase artist distribution ─────────────────────────────────
  const crossPhased = distributeArtistsAcrossPhases(
    gradient.tracks,
    gradient.phases,
    sortedPool.filter((t) => !new Set(gradient.tracks.map((x) => x.trackId)).has(t.trackId))
  );

  // ── v2: Genre bridge smoothing (within each phase, preserving macro arc) ─
  const genreSmoothed = smoothGenresWithinPhases(crossPhased, gradient.phases);

  finalTracks = assignNarrativeRoles(genreSmoothed, journeyArc);

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
    signatureTrackIds: sigIds,
  };
}
