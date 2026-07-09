/**
 * Negative example detector — flags obvious playlist failures using failure corpus.
 */

import { humanPlausibilityScore } from "../../core/editorial/human-playlist-patterns";
import type { PatternScoringTrack } from "../../core/editorial/human-playlist-patterns";
import { loadNegativeExamples } from "./hall-of-fame-loader";
import type { NegativeDetectionResult, NegativeExampleCategory } from "./types";

function trackEnergyProfile(tracks: PatternScoringTrack[]): { mean: number; spread: number } {
  const energies = tracks.map((t) => t.energy ?? 0.5);
  const mean = energies.reduce((a, b) => a + b, 0) / Math.max(1, energies.length);
  const spread = energies.length > 1
    ? Math.sqrt(energies.reduce((s, e) => s + (e - mean) ** 2, 0) / energies.length)
    : 0;
  return { mean, spread };
}

function shapeSimilarity(a: PatternScoringTrack[], b: PatternScoringTrack[]): number {
  const pa = humanPlausibilityScore(a);
  const pb = humanPlausibilityScore(b);
  const ea = trackEnergyProfile(a);
  const eb = trackEnergyProfile(b);
  const energyDelta = Math.abs(ea.mean - eb.mean);
  const plausibilityDelta = Math.abs(pa - pb);
  return Math.max(0, 1 - energyDelta * 0.8 - plausibilityDelta * 0.5);
}

function inferCategory(prompt: string): NegativeExampleCategory | null {
  if (/\b(?:gym|workout|lifting|cardio)\b/i.test(prompt)) return "gym";
  if (/\b(?:focus|coding|study|concentrat|deep\s+work)\b/i.test(prompt)) return "focus";
  if (/\b(?:party|pregame|going\s+out|club)\b/i.test(prompt)) return "party";
  return null;
}

export function detectNegativeFailure(opts: {
  prompt: string;
  tracks: PatternScoringTrack[];
}): NegativeDetectionResult {
  const category = inferCategory(opts.prompt);
  if (!category) {
    return { detected: false, matchedExamples: [], failureTypes: [], similarityScore: 0 };
  }

  const examples = loadNegativeExamples().filter((ex) => ex.category === category);

  const matchedExamples: string[] = [];
  const failureTypes: string[] = [];
  let bestSimilarity = 0;

  for (const example of examples) {
    const similarity = shapeSimilarity(opts.tracks.slice(0, 5), example.tracks.slice(0, 5));
    if (similarity >= 0.72) {
      matchedExamples.push(example.id);
      failureTypes.push(example.failureType);
      bestSimilarity = Math.max(bestSimilarity, similarity);
    }
  }

  const opening = opts.tracks.slice(0, 5);
  const openerEnergy = opening[0]?.energy ?? 0.5;
  if (category === "gym" && openerEnergy < 0.5) {
    failureTypes.push("gym_opener_too_slow");
  }
  if (category === "focus" && openerEnergy > 0.62) {
    failureTypes.push("focus_opener_too_hype");
  }
  if (category === "party" && openerEnergy < 0.58) {
    failureTypes.push("party_opener_too_mellow");
  }

  const detected = matchedExamples.length > 0 || failureTypes.length > 0;

  return {
    detected,
    matchedExamples,
    failureTypes: [...new Set(failureTypes)],
    similarityScore: Math.round(bestSimilarity * 100) / 100,
  };
}

export function evaluateNegativeCorpusSelfTest(): { pass: boolean; failures: string[] } {
  const examples = loadNegativeExamples();
  const failures: string[] = [];
  for (const example of examples) {
    const result = detectNegativeFailure({ prompt: example.prompt, tracks: example.tracks });
    if (!result.detected) {
      failures.push(`negative corpus example not self-detected: ${example.id}`);
    }
  }
  return { pass: failures.length === 0, failures };
}
