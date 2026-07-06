import type { PromptConfidenceTier } from "./prompt-confidence";

export const MIN_PROMPT_WORDS_FOR_VAGUE = 4;

export interface PromptReadinessResult {
  ready: boolean;
  code?: "PROMPT_TOO_VAGUE";
  message?: string;
}

/** Gate vague prompts unless user locked a scene, added detail, or supplied a reference. */
export function evaluatePromptReadiness(opts: {
  vibe: string;
  tier: PromptConfidenceTier;
  sceneId?: string | null;
  referencePlaylist?: string | null;
}): PromptReadinessResult {
  if (opts.referencePlaylist?.trim()) return { ready: true };
  if (opts.sceneId?.trim()) return { ready: true };
  if (opts.tier !== "low") return { ready: true };

  const words = opts.vibe.trim().split(/\s+/).filter(Boolean);
  if (words.length >= MIN_PROMPT_WORDS_FOR_VAGUE) return { ready: true };

  return {
    ready: false,
    code: "PROMPT_TOO_VAGUE",
    message:
      "Add when, where, or what you're doing — pick a suggestion below, paste a reference playlist, or use at least four words.",
  };
}
