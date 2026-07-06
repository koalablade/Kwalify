import type { PlaylistWhySummary } from "./playlist-why-summary";
import type { EmotionalConsistencyResult } from "./emotional-consistency-score";
import type { SyncQualityLabel } from "./sync-quality";
import { validatePrimaryNarrativeForResponse, type VersionedPrimaryNarrative } from "./primary-narrative-schema";
import { buildShareCardFromNarrative, type ShareCard } from "./share-card";
import { computeEmotionalClarityScore } from "./emotional-clarity-score";
import { buildPrimaryNarrative } from "./primary-narrative";

export interface UxSignals {
  primaryNarrative: VersionedPrimaryNarrative;
  emotionalConsistencyScore: number;
  emotionalConsistencyLabel: string;
  emotionalClarityScore: number;
  emotionalClarityLabel: string;
  syncQualityLabel?: SyncQualityLabel;
  syncQualityScore?: number;
  shareCard: ShareCard;
  narrativeDriftWarning?: string | null;
  /** @deprecated use primaryNarrative.momentLabel */
  dominantMomentLabel: string;
}

export function buildUxSignals(opts: {
  playlistWhy: PlaylistWhySummary;
  emotionalConsistency: EmotionalConsistencyResult;
  signatureStable: boolean;
  syncQualityLabel?: SyncQualityLabel;
  syncQualityScore?: number;
  previewTrackNames?: string[];
  narrativeDriftWarning?: string | null;
}): UxSignals {
  const primaryNarrative = buildPrimaryNarrative(opts.playlistWhy);

  const emotionalClarity = computeEmotionalClarityScore({
    primaryNarrative,
    emotionalConsistencyScore: opts.emotionalConsistency.score,
    signatureStable: opts.signatureStable,
  });

  const shareCard = buildShareCardFromNarrative(
    primaryNarrative,
    opts.previewTrackNames ?? []
  );

  const uxSignals: UxSignals = {
    primaryNarrative,
    emotionalConsistencyScore: opts.emotionalConsistency.score,
    emotionalConsistencyLabel: opts.emotionalConsistency.label,
    emotionalClarityScore: emotionalClarity.score,
    emotionalClarityLabel: emotionalClarity.label,
    ...(opts.syncQualityLabel != null
      ? {
          syncQualityLabel: opts.syncQualityLabel,
          syncQualityScore: opts.syncQualityScore,
        }
      : {}),
    shareCard,
    dominantMomentLabel: primaryNarrative.momentLabel,
    ...(opts.narrativeDriftWarning ? { narrativeDriftWarning: opts.narrativeDriftWarning } : {}),
  };

  validatePrimaryNarrativeForResponse(uxSignals.primaryNarrative);
  return uxSignals;
}

export function toLaunchUxSignals(uxSignals: UxSignals): UxSignals {
  validatePrimaryNarrativeForResponse(uxSignals.primaryNarrative);
  return {
    primaryNarrative: uxSignals.primaryNarrative,
    emotionalConsistencyScore: uxSignals.emotionalConsistencyScore,
    emotionalConsistencyLabel: uxSignals.emotionalConsistencyLabel,
    emotionalClarityScore: uxSignals.emotionalClarityScore,
    emotionalClarityLabel: uxSignals.emotionalClarityLabel,
    shareCard: uxSignals.shareCard,
    dominantMomentLabel: uxSignals.dominantMomentLabel,
    ...(uxSignals.narrativeDriftWarning
      ? { narrativeDriftWarning: uxSignals.narrativeDriftWarning }
      : {}),
  };
}
