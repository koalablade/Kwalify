/**
 * Temporal memory — track lifecycle; same song = different meaning over time.
 */

import type { TrackLibrarySignal } from "./library-signals";

export type TrackLifePhase =
  | "fresh"
  | "active"
  | "excitement"
  | "saturated"
  | "forgotten"
  | "rediscovered"
  | "reembraced";

export interface TemporalMemoryState {
  phase: TrackLifePhase;
  overplayedScore: number;
  rediscoveryScore: number;
  scoreModifier: number;
  explanation: string;
}

export function computeTemporalMemory(signal: TrackLibrarySignal): TemporalMemoryState {
  const appearances = signal.playlistAppearances;
  const days = signal.daysSinceSurfaced;
  const ageYears = signal.dateLiked
    ? (Date.now() - signal.dateLiked.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
    : 0;

  let phase: TrackLifePhase = "active";
  let overplayedScore = Math.min(1, appearances / 5);
  let rediscoveryScore = 0;
  let scoreModifier = 0;
  let explanation = "neutral library phase";

  if (appearances >= 4) {
    phase = "saturated";
    overplayedScore = 0.85;
    scoreModifier = -0.1;
    explanation = "saturated — recently overused in playlists";
  } else if (appearances >= 2 && days != null && days < 14) {
    phase = "active";
    overplayedScore = 0.5;
    scoreModifier = -0.04;
    explanation = "active — appeared recently";
  } else if (appearances === 0 && ageYears > 2 && (days == null || days > 45)) {
    phase = "forgotten";
    rediscoveryScore = 0.85;
    scoreModifier = 0.12;
    explanation = "forgotten favourite — deep library, not surfaced lately";
  } else if (appearances === 0 && ageYears > 0.4) {
    phase = "excitement";
    rediscoveryScore = 0.55;
    scoreModifier = 0.06;
    explanation = "underused — good rediscovery candidate";
  } else if (appearances >= 2 && (days == null || days > 30)) {
    phase = "reembraced";
    rediscoveryScore = 0.4;
    scoreModifier = 0.04;
    explanation = "re-embraced after quiet period";
  } else if (appearances === 0) {
    phase = "fresh";
    scoreModifier = 0.02;
    explanation = "never in your Kwalify playlists yet";
  }

  if (phase === "forgotten" || phase === "excitement") {
    phase = appearances > 0 ? "rediscovered" : phase;
  }

  return { phase, overplayedScore, rediscoveryScore, scoreModifier, explanation };
}
