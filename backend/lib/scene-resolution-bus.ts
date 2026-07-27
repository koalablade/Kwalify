/**
 * Single authority for scene resolution — canonical ID drives display and scoring.
 */

import {
  resolveCanonicalSceneFull,
  resolveMoodSceneById,
  type CanonicalSceneResult,
} from "./scene-canonicalizer";
import { interpretSemantics } from "./semantic-interpreter";
import { canonicalToSemanticSceneId } from "./scene-id-map";
import { resolveSemanticScene, type SemanticSceneResolution } from "./semantic-scene-engine";
import type { EmotionProfile } from "./emotion";

export type ResolvedSceneSource =
  | "mood_picker"
  | "compound_rule"
  | "canonical"
  | "semantic_fallback";

export interface ResolvedScene {
  sceneId: string | null;
  confidence: number;
  source: ResolvedSceneSource;
  prototypeId: string | null;
  semanticSceneId: string | null;
  matchedAlias: string | null;
  canonical: CanonicalSceneResult | null;
}

function fromCanonical(
  canonical: CanonicalSceneResult,
  source: ResolvedSceneSource
): ResolvedScene {
  return {
    sceneId: canonical.sceneId,
    confidence: canonical.confidence,
    source,
    prototypeId: canonical.prototypeId,
    semanticSceneId: canonicalToSemanticSceneId(canonical.sceneId),
    matchedAlias: canonical.matchedAlias,
    canonical,
  };
}

export function resolveSceneBus(
  prompt: string,
  opts?: { moodSceneId?: string | null }
): ResolvedScene {
  const text = prompt.trim();
  const moodSceneId = opts?.moodSceneId?.trim() || null;

  if (moodSceneId) {
    const mood = resolveMoodSceneById(moodSceneId);
    if (mood) return fromCanonical(mood, "mood_picker");
  }

  const semantic = interpretSemantics(text);
  let canonical = resolveCanonicalSceneFull(text);
  let source: ResolvedSceneSource = "canonical";

  if (canonical?.matchedVariants.some((v) => v.startsWith("compound:"))) {
    source = "compound_rule";
  }

  if (
    (!canonical || canonical.confidence < 0.55) &&
    semantic.confidence > 0.35 &&
    semantic.suggestedCanonical
  ) {
    const semanticCanonical =
      resolveMoodSceneById(semantic.suggestedCanonical) ??
      resolveCanonicalSceneFull(semantic.suggestedCanonical);
    if (semanticCanonical) {
      canonical = { ...semanticCanonical, confidence: Math.min(0.68, semantic.confidence) };
      source = "semantic_fallback";
    }
  }

  if (canonical) return fromCanonical(canonical, source);

  if (semantic.suggestedCanonical) {
    const semanticId = semantic.suggestedCanonical;
    return {
      sceneId: semanticId,
      confidence: semantic.confidence,
      source: "semantic_fallback",
      prototypeId: null,
      semanticSceneId: canonicalToSemanticSceneId(semanticId),
      matchedAlias: null,
      canonical: null,
    };
  }

  return {
    sceneId: null,
    confidence: 0,
    source: "semantic_fallback",
    prototypeId: null,
    semanticSceneId: null,
    matchedAlias: null,
    canonical: null,
  };
}

/** Resolve semantic scoring scene from bus — commits to mapped semantic ID when confident. */
export function resolveSemanticFromBus(
  vibe: string,
  profile: EmotionProfile,
  bus: ResolvedScene,
  opts?: { singleWorldCommit?: boolean; vagueCommitSceneId?: string | null }
): SemanticSceneResolution {
  const busSemantic =
    bus.semanticSceneId && bus.confidence >= 0.62 ? bus.semanticSceneId : null;
  const commitSceneId = busSemantic ?? opts?.vagueCommitSceneId ?? null;
  const singleWorldCommit = opts?.singleWorldCommit || !!commitSceneId;

  if (commitSceneId) {
    return resolveSemanticScene(vibe, profile, {
      singleWorldCommit,
      commitSceneId,
    });
  }

  return resolveSemanticScene(vibe, profile, {
    singleWorldCommit: opts?.singleWorldCommit,
    commitSceneId: opts?.vagueCommitSceneId ?? null,
  });
}
