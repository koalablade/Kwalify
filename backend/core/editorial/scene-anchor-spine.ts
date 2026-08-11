/**
 * V18 generic scene-anchor spine — world-agnostic canonical anchor evidence.
 * Uses PRIORITY_ANCHOR_ORDER / anchorArtistNames from cultural profiles.
 */

import type { CulturalWorldProfile } from "./cultural-identity-profile";
import { getPriorityAnchorOrder } from "./cultural-identity-profile";

export type SceneAnchorTrack = {
  artistName?: string | null;
  trackName?: string | null;
};

function normArtist(name: string): string {
  return name.toLowerCase().trim();
}

/** Match artist to a priority anchor name (substring, case-insensitive). */
export function matchPriorityAnchor(artistName: string, anchorName: string): boolean {
  const a = normArtist(artistName);
  const n = normArtist(anchorName);
  if (!a || !n) return false;
  return a.includes(n) || n.includes(a);
}

/** Tier 0–1 within profile priority list (1 = highest scene-spine evidence). */
export function sceneAnchorTier(profile: CulturalWorldProfile, artistName: string): number {
  const order = getPriorityAnchorOrder(profile);
  if (order.length === 0) return 0;
  for (let i = 0; i < order.length; i += 1) {
    if (matchPriorityAnchor(artistName, order[i]!)) {
      return (order.length - i) / order.length;
    }
  }
  return 0;
}

/** World-identity score modifier for anchor tier (generic, not prompt-specific). */
export function sceneAnchorIdentityBonus(profile: CulturalWorldProfile, artistName: string): number {
  const tier = sceneAnchorTier(profile, artistName);
  if (tier <= 0) return 0;
  return tier * 0.12;
}

/** Priority anchor names not yet represented in selected tracks. */
export function missingPriorityAnchors<T extends SceneAnchorTrack>(
  selected: T[],
  pool: T[],
  profile: CulturalWorldProfile,
  spineDepth = 2,
): string[] {
  const order = getPriorityAnchorOrder(profile).slice(0, spineDepth);
  const missing: string[] = [];
  for (const anchor of order) {
    const inSelected = selected.some((t) => matchPriorityAnchor(String(t.artistName ?? ""), anchor));
    if (inSelected) continue;
    const inPool = pool.some((t) => matchPriorityAnchor(String(t.artistName ?? ""), anchor));
    if (inPool) missing.push(anchor);
  }
  return missing;
}

/** Promote underrepresented priority anchors toward early slots (within existing tracks). */
export function promoteSceneAnchorsInPlaylist<T extends SceneAnchorTrack>(
  tracks: T[],
  profile: CulturalWorldProfile,
  earlySlots = 3,
): { tracks: T[]; promotions: number } {
  if (tracks.length < 2) return { tracks: tracks.slice(), promotions: 0 };
  const order = getPriorityAnchorOrder(profile);
  if (order.length === 0) return { tracks: tracks.slice(), promotions: 0 };

  const result = tracks.slice();
  let promotions = 0;

  for (let slot = 0; slot < Math.min(earlySlots, result.length); slot += 1) {
    const targetAnchor = order[Math.min(slot, order.length - 1)]!;
    const alreadySeated = result
      .slice(0, slot + 1)
      .some((t) => matchPriorityAnchor(String(t.artistName ?? ""), targetAnchor));
    if (alreadySeated) continue;

    let bestIdx = -1;
    let bestTier = 0;
    for (let j = slot + 1; j < result.length; j += 1) {
      const artist = String(result[j]!.artistName ?? "");
      const matchesTarget = matchPriorityAnchor(artist, targetAnchor);
      const tier = sceneAnchorTier(profile, artist);
      if (matchesTarget) {
        bestIdx = j;
        bestTier = tier;
        break;
      }
      if (tier > bestTier) {
        bestTier = tier;
        bestIdx = j;
      }
    }
    if (bestIdx > slot) {
      const tmp = result[slot]!;
      result[slot] = result[bestIdx]!;
      result[bestIdx] = tmp;
      promotions += 1;
    }
  }

  return { tracks: result, promotions };
}

/** Penalize over-dominance of a single high-popularity anchor when spine anchors are absent. */
export function dominantAnchorShare<T extends SceneAnchorTrack>(
  tracks: T[],
  profile: CulturalWorldProfile,
): { artist: string; share: number; tier: number } | null {
  if (tracks.length === 0) return null;
  const counts = new Map<string, number>();
  for (const t of tracks) {
    const a = normArtist(String(t.artistName ?? ""));
    counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  let best: { artist: string; share: number; tier: number } | null = null;
  for (const [artist, count] of counts) {
    const share = count / tracks.length;
    const tier = sceneAnchorTier(profile, artist);
    if (!best || share > best.share) {
      best = { artist, share, tier };
    }
  }
  return best;
}
