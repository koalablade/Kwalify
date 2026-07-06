import { createHash } from "crypto";
import { normalizePrompt } from "./generate-cache-key";
import type { EmotionalSequencePhases } from "./emotional-sequencing";

/** Identity signature — stable across track swaps; excludes energy curve. */
export function computeIdentitySignature(opts: {
  momentLabel: string;
  sceneId: string | null;
  arcSummary: string;
}): string {
  const payload = JSON.stringify({
    label: opts.momentLabel.trim().toLowerCase(),
    scene: opts.sceneId ?? "open",
    arc: opts.arcSummary.trim().toLowerCase().slice(0, 120),
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

/** Selection signature — track order/identity only; used for diversity detection. */
export function computeSelectionSignature(trackIds: string[]): string {
  const payload = trackIds.join("|");
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

/** @deprecated use computeIdentitySignature + computeSelectionSignature */
export function computeMomentSignature(opts: {
  momentLabel: string;
  sceneId: string | null;
  energies: number[];
}): string {
  return computeIdentitySignature({
    momentLabel: opts.momentLabel,
    sceneId: opts.sceneId,
    arcSummary: opts.energies.map((e) => Math.round(e * 100)).join("-"),
  });
}

const lastSelectionByUserPrompt = new Map<string, string>();

/**
 * Varies track order/selection within phases only.
 * Does not alter identity (moment label / arc summary).
 */
export function applyMomentSignatureDiversity<T extends { trackId: string }>(
  userId: string,
  vibe: string,
  selectionSignature: string,
  tracks: T[],
  phases: EmotionalSequencePhases
): {
  tracks: T[];
  diversified: boolean;
  selectionSignature: string;
} {
  const key = `${userId}:${normalizePrompt(vibe)}`;
  const previous = lastSelectionByUserPrompt.get(key);
  lastSelectionByUserPrompt.set(key, selectionSignature);

  if (!previous || previous !== selectionSignature || tracks.length < 4) {
    return { tracks, diversified: false, selectionSignature };
  }

  const result = [...tracks];
  const peakStart = phases.intro + phases.build;
  const peakLen = phases.peak;

  if (peakLen >= 2 && peakStart + 1 < result.length) {
    const a = peakStart;
    const b = peakStart + 1;
    const tmp = result[a]!;
    result[a] = result[b]!;
    result[b] = tmp;
    return {
      tracks: result,
      diversified: true,
      selectionSignature: computeSelectionSignature(result.map((t) => t.trackId)),
    };
  }

  const buildStart = phases.intro;
  if (phases.build >= 2 && buildStart + 1 < result.length) {
    const a = buildStart;
    const b = buildStart + phases.build - 1;
    const tmp = result[a]!;
    result[a] = result[b]!;
    result[b] = tmp;
    return {
      tracks: result,
      diversified: true,
      selectionSignature: computeSelectionSignature(result.map((t) => t.trackId)),
    };
  }

  const first = result[0]!;
  result[0] = result[result.length - 1]!;
  result[result.length - 1] = first;
  return {
    tracks: result,
    diversified: true,
    selectionSignature: computeSelectionSignature(result.map((t) => t.trackId)),
  };
}
