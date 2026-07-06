import type { DestinationParse } from "./emotion-destination";
import type { CanonicalSceneResult } from "./scene-canonicalizer";
import type { ContradictionProfile } from "../core/scene-intelligence/contradiction-handler";
import type { IntentDecodeResult } from "./intent-decoder";

function label(id: string): string {
  return id.replace(/_/g, " ");
}

/** One-line user-facing summary of what Kwalify understood. */
export function buildMomentUnderstandingLine(opts: {
  vibe: string;
  dominantMomentLabel: string;
  canonicalScene: CanonicalSceneResult | null;
  contradiction: ContradictionProfile;
  destParse: DestinationParse;
  intent: IntentDecodeResult;
}): string {
  const parts: string[] = [];

  if (opts.canonicalScene && opts.canonicalScene.confidence >= 0.55) {
    parts.push(`I read this as: ${label(opts.canonicalScene.sceneId)}`);
  } else if (opts.dominantMomentLabel) {
    parts.push(`I read this as: ${opts.dominantMomentLabel}`);
  }

  if (opts.contradiction.active && opts.contradiction.label) {
    parts.push(`mixed mood (${label(opts.contradiction.label)})`);
  }

  if (opts.destParse.desired) {
    parts.push(`heading toward ${opts.destParse.desired}`);
  } else if (opts.intent.intent && opts.intent.intent !== "neutral") {
    parts.push(`intent: ${opts.intent.intent.replace(/_/g, " ")}`);
  }

  if (!parts.length) {
    return "Tell me a bit more about the moment for a tighter match.";
  }

  return parts.join(" · ");
}
