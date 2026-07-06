/**
 * In-memory scene mismatch memory from thumbs-down feedback.
 * Penalises vibe → scene mappings that users rejected.
 */

import { normalizePrompt } from "./generate-cache-key";

type SceneDownvote = { sceneId: string; count: number };

const downvotesByUser = new Map<string, Map<string, SceneDownvote>>();

const MAX_USERS = 500;
const PENALTY_PER_DOWNVOTE = 0.08;
const MAX_PENALTY = 0.22;

function userMap(userId: string): Map<string, SceneDownvote> {
  let m = downvotesByUser.get(userId);
  if (!m) {
    m = new Map();
    downvotesByUser.set(userId, m);
    if (downvotesByUser.size > MAX_USERS) {
      const first = downvotesByUser.keys().next().value;
      if (first) downvotesByUser.delete(first);
    }
  }
  return m;
}

export function recordSceneFeedbackDown(
  userId: string,
  vibe: string,
  sceneId: string | null | undefined
): void {
  if (!sceneId?.trim()) return;
  const key = normalizePrompt(vibe);
  const m = userMap(userId);
  const existing = m.get(key);
  if (existing?.sceneId === sceneId) {
    existing.count += 1;
  } else {
    m.set(key, { sceneId, count: 1 });
  }
}

export function getSceneFeedbackPenalty(
  userId: string,
  vibe: string,
  sceneId: string | null | undefined
): number {
  if (!sceneId?.trim()) return 0;
  const entry = downvotesByUser.get(userId)?.get(normalizePrompt(vibe));
  if (!entry || entry.sceneId !== sceneId) return 0;
  return -Math.min(MAX_PENALTY, entry.count * PENALTY_PER_DOWNVOTE);
}
