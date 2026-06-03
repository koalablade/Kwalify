/**
 * Explain why each song scored — deterministic, no black box.
 */

import type { IntentDecodeResult } from "./intent-decoder";
import type { CanonicalSceneResult } from "./scene-canonicalizer";
import type { ScenePrototype } from "./scene-prototypes";
import type { EmotionalTrajectory } from "./emotional-physics";
import type { TemporalMemoryState } from "./temporal-memory";
import type { GraphPropagationHop } from "./knowledge-graph";

export interface TrackScoreExplanation {
  trackId: string;
  reasons: string[];
}

export function explainTrackScore(opts: {
  trackId: string;
  baseFit: number;
  sonicBonus: number;
  exclusionPenalty: number;
  temporal: TemporalMemoryState | null;
  rediscoveryScore: number;
  canonical: CanonicalSceneResult | null;
  intent: IntentDecodeResult;
  narrativeRole?: string;
}): TrackScoreExplanation {
  const reasons: string[] = [];

  if (opts.canonical) {
    reasons.push(`scene:${opts.canonical.sceneId}`);
  }
  reasons.push(`intent:${opts.intent.intent}`);
  if (opts.baseFit > 0.65) reasons.push("strong_emotional_fit");
  if (opts.sonicBonus > 0.08) reasons.push("sonic_profile_match");
  if (opts.rediscoveryScore > 0.5) reasons.push("rediscovery_boost");
  if (opts.temporal && opts.temporal.scoreModifier > 0.05) {
    reasons.push(`memory:${opts.temporal.phase}`);
  }
  if (opts.temporal && opts.temporal.scoreModifier < -0.05) {
    reasons.push(`memory_penalty:${opts.temporal.phase}`);
  }
  if (opts.exclusionPenalty < -0.05) reasons.push("excluded_incompatible_mood");
  if (opts.narrativeRole) reasons.push(`role:${opts.narrativeRole}`);

  return { trackId: opts.trackId, reasons };
}

export function summarizePipeline(opts: {
  canonical: CanonicalSceneResult | null;
  prototype: ScenePrototype | null;
  intent: IntentDecodeResult;
  physics: EmotionalTrajectory;
  graphPaths: GraphPropagationHop[];
}): Record<string, unknown> {
  return {
    scene: opts.canonical?.sceneId ?? null,
    prototype: opts.prototype?.id ?? null,
    intent: opts.intent.intent,
    emotionTrajectory: opts.physics.emotionTrajectory,
    forces: opts.physics.forces,
    graphHops: opts.graphPaths.slice(0, 8).map((h) => `${h.from} -${h.type}(${h.hop})→ ${h.to}`),
  };
}
