import type { PromptConfidenceTier } from "./prompt-confidence";
import { resolveVagueWorldCommit } from "./vague-world-commit";

export const MIN_PROMPT_WORDS_FOR_VAGUE = 4;

export interface PromptReadinessResult {
  ready: boolean;
  code?: "PROMPT_TOO_VAGUE";
  message?: string;
  /** When ready via auto-commit, surface the committed world for logging/UX. */
  vagueCommit?: ReturnType<typeof resolveVagueWorldCommit>;
}

/**
 * Gate vague prompts unless:
 * - user locked a scene / reference playlist
 * - prompt confidence is high with named detail, OR
 * - we can auto-commit to one everyday musical world
 *
 * No longer bypasses solely because the prompt has ≥4 words.
 */
export function evaluatePromptReadiness(opts: {
  vibe: string;
  tier: PromptConfidenceTier;
  score?: number;
  sceneId?: string | null;
  referencePlaylist?: string | null;
}): PromptReadinessResult {
  if (opts.referencePlaylist?.trim()) return { ready: true };
  if (opts.sceneId?.trim()) return { ready: true };

  const commit = resolveVagueWorldCommit(opts.vibe, {
    tier: opts.tier,
    promptConfidenceScore: opts.score,
    sceneIdLocked: opts.sceneId,
  });

  if (commit.action === "passthrough") return { ready: true, vagueCommit: commit };
  if (commit.action === "commit") return { ready: true, vagueCommit: commit };

  // clarify — near-tie or empty
  return {
    ready: false,
    code: "PROMPT_TOO_VAGUE",
    vagueCommit: commit,
    message:
      commit.label
        ? `That could be a few different playlists — pick one: more like "${commit.label}", or choose a suggestion below.`
        : "Add when, where, or what you're doing — pick a suggestion below, paste a reference playlist, or name a mood/scene.",
  };
}
