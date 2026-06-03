import type { ExtendedVibeKeyword } from "./vibe-keywords-extended";

type Weights = ExtendedVibeKeyword["weights"];
type Hints = ExtendedVibeKeyword["sceneHints"];

export function tagKw(
  terms: string | string[],
  weights: Weights = {},
  sceneHints?: Hints,
  artistOrGenreCue = false
): ExtendedVibeKeyword {
  const list = Array.isArray(terms) ? terms : [terms];
  return { terms: list, weights, sceneHints, artistOrGenreCue };
}

/** Build many single-phrase entries sharing weights/hints. */
export function tagBatch(
  phrases: string[],
  weights: Weights,
  sceneHints?: Hints,
  artistOrGenreCue = false
): ExtendedVibeKeyword[] {
  return phrases.map((p) => tagKw(p, weights, sceneHints, artistOrGenreCue));
}
