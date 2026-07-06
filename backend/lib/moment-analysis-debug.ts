import type { EmotionalSequencePhases } from "./emotional-sequencing";
import type { EmotionalConsistencyBreakdown } from "./emotional-consistency-score";
import { buildMomentTruthSentence } from "./moment-truth-sentence";
import type { PlaylistWhySummary } from "./playlist-why-summary";

export interface MomentAnalysisDebug {
  momentTruthSentence: string;
  emotionalConsistency: EmotionalConsistencyBreakdown;
  energyCurve: number[];
  phaseTransitions: Array<{
    index: number;
    phase: string;
    trackRole: string | null;
    energy: number;
    emphasisAnchor: boolean;
  }>;
}

export function buildMomentAnalysisDebug(opts: {
  playlistWhy: PlaylistWhySummary;
  phases: EmotionalSequencePhases;
  tracks: Array<{
    energy?: number | null;
    narrativeRole?: string | null;
    trackRole?: string | null;
    emphasisAnchor?: boolean;
  }>;
  consistency: EmotionalConsistencyBreakdown;
}): MomentAnalysisDebug {
  const energies = opts.tracks.map((t) => t.energy ?? 0.5);

  const phaseTransitions = opts.tracks.map((t, index) => ({
    index,
    phase: t.narrativeRole ?? "unknown",
    trackRole: t.trackRole ?? null,
    energy: Math.round((t.energy ?? 0.5) * 1000) / 1000,
    emphasisAnchor: !!t.emphasisAnchor,
  }));

  return {
    momentTruthSentence: buildMomentTruthSentence({
      topSceneMatch: opts.playlistWhy.topSceneMatch,
      dominantEmotion: opts.playlistWhy.dominantEmotion,
      energyProfile: opts.playlistWhy.energyProfile,
      sequencePhases: opts.phases,
    }),
    emotionalConsistency: opts.consistency,
    energyCurve: energies.map((e) => Math.round(e * 1000) / 1000),
    phaseTransitions,
  };
}
