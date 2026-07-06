/**
 * Extract structured fields + deterministic scores for live generate responses.
 * Measurement only — no production imports that mutate state.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { classifyArcDirection, classifyMomentLabel } from "../lib/emotional-invariance";
import { PERCEPTION_FIXED_PHASES } from "../lib/perception-fixture";
import type { BenchmarkRecord, BenchmarkScores } from "./benchmark-human-retention";
import { BENCHMARK_PROMPTS } from "./benchmark-human-retention";

export type SoakScenarioKind =
  | "generate"
  | "cache_hit"
  | "regenerate"
  | "regenerate_followup";

export interface LiveGenerateResponse {
  ok: boolean;
  status: number;
  latencyMs: number;
  cached?: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
  body: Record<string, unknown>;
}

export interface ExtractedSoakRecord {
  prompt: string;
  scenario: SoakScenarioKind;
  partial: boolean;
  primaryNarrative: {
    momentLabel: string;
    summary: string;
    arcSummary: string;
  };
  emotionalConsistencyScore: number | null;
  syncQualityLabel: string | null;
  momentSignature: string | null;
  trackCount: number;
  generationMs: number | null;
  spotifyPlaylistUrl: string | null;
  cached: boolean;
  trackIds: string[];
  matchStrengths: number[];
}

export interface BehaviouralProxies {
  regenerateRate: number;
  saveProxyRate: number;
  continuationProxyRate: number;
  skipProxyMean: number;
}

export interface DivergenceMetrics {
  momentLabelClassStable: boolean;
  arcDirectionStable: boolean;
  trackJaccard: number;
  momentLabelChanged: boolean;
  hrpsDelta: number;
}

const BASELINE_PATH = join(__dirname, "benchmark-baseline.snapshot.json");

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function loadBaselineForPrompt(prompt: string): BenchmarkRecord | null {
  if (!existsSync(BASELINE_PATH)) return null;
  const raw = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as {
    records: BenchmarkRecord[];
  };
  return raw.records?.find((r) => r.prompt === prompt) ?? null;
}

export function extractSoakRecord(
  prompt: string,
  scenario: SoakScenarioKind,
  response: LiveGenerateResponse
): ExtractedSoakRecord {
  const body = response.body;
  const ux = body.uxSignals as Record<string, unknown> | undefined;
  const narrative = (ux?.primaryNarrative ?? null) as Record<string, string> | null;
  const playlistWhy = body.playlistWhy as Record<string, unknown> | undefined;
  const debug = body.debugSignals as Record<string, unknown> | undefined;

  const tracks = Array.isArray(body.tracks) ? body.tracks : [];
  const trackIds = tracks
    .map((t) => (t as { id?: string; trackId?: string }).id ?? (t as { trackId?: string }).trackId)
    .filter((id): id is string => typeof id === "string");
  const matchStrengths = tracks
    .map((t) => (t as { matchStrength?: number }).matchStrength)
    .filter((v): v is number => typeof v === "number");

  const partial = !narrative && !playlistWhy;

  return {
    prompt,
    scenario,
    partial,
    primaryNarrative: {
      momentLabel:
        narrative?.momentLabel ??
        (playlistWhy?.dominantMomentLabel as string) ??
        (body.dominantMomentLabel as string) ??
        "",
      summary:
        narrative?.summary ??
        (playlistWhy?.summary as string) ??
        "",
      arcSummary:
        narrative?.arcSummary ??
        (playlistWhy?.structureExplanation as string) ??
        "",
    },
    emotionalConsistencyScore:
      (ux?.emotionalConsistencyScore as number) ??
      (body.emotionalConsistencyScore as number) ??
      null,
    syncQualityLabel:
      (ux?.syncQualityLabel as string) ??
      (body.syncQualityLabel as string) ??
      null,
    momentSignature:
      (debug?.identitySignature as string) ??
      (body.momentSignature as string) ??
      null,
    trackCount:
      (body.count as number) ??
      (body.totalTracks as number) ??
      trackIds.length,
    generationMs: (body.generationMs as number) ?? null,
    spotifyPlaylistUrl:
      (body.spotifyPlaylistUrl as string) ??
      (body.playlistUrl as string) ??
      null,
    cached: !!(body.cached ?? response.cached),
    trackIds,
    matchStrengths,
  };
}

function toBenchmarkRecord(extracted: ExtractedSoakRecord): BenchmarkRecord {
  return {
    prompt: extracted.prompt,
    primaryNarrative: extracted.primaryNarrative,
    emotionalConsistencyScore: extracted.emotionalConsistencyScore ?? 0,
    syncQualityLabel: extracted.syncQualityLabel,
    momentSignature: extracted.momentSignature,
    trackCount: extracted.trackCount,
  };
}

// ── Scoring (mirrors benchmark-human-retention deterministically) ─────────────

function scoreNarrativeClarity(record: BenchmarkRecord): number {
  let score = 0;
  const label = record.primaryNarrative.momentLabel.trim();
  if (label.length > 2) score += 2;
  if (label.split(/\s+/).length >= 3) score += 2;
  const arc = classifyArcDirection(record.primaryNarrative.arcSummary, PERCEPTION_FIXED_PHASES);
  if (arc === "rise_peak_fall") score += 4;
  else if (arc === "rise" || arc === "fall") score += 2.5;
  else score += 1;
  if (record.primaryNarrative.summary.length > 20) score += 1.5;
  return Math.min(10, round(score));
}

function scoreSpecificity(record: BenchmarkRecord): number {
  const label = record.primaryNarrative.momentLabel.trim().toLowerCase();
  const generic = [
    /^chill vibes?$/i,
    /^relaxing music$/i,
    /^good vibes$/i,
    /^focus playlist$/i,
    /^sad songs$/i,
    /^party vibes$/i,
  ];
  if (generic.some((p) => p.test(label))) return 2;
  const words = label.split(/\s+/).filter((w) => w.length > 1);
  return Math.min(10, round(2 + Math.min(4, words.length * 0.9)));
}

function scoreHRPS(record: BenchmarkRecord): number {
  const specificity = scoreSpecificity(record);
  const label = record.primaryNarrative.momentLabel.toLowerCase();
  let relatable = 3;
  if (label.split(/\s+/).length >= 3) relatable += 2;
  const identityFit = Math.min(10, round(specificity * 0.55 + relatable));
  const replayUtility = /focus|work|gym|chill|calm|stress|nostalgic/.test(label) ? 8 : 5.5;
  const arc = classifyArcDirection(record.primaryNarrative.arcSummary, PERCEPTION_FIXED_PHASES);
  const spike = arc === "rise_peak_fall" ? 9 : arc === "flat" ? 2.5 : 6;
  return round(identityFit * 0.4 + replayUtility * 0.3 + spike * 0.3);
}

export function scoreExtractedRecord(extracted: ExtractedSoakRecord): BenchmarkScores {
  const record = toBenchmarkRecord(extracted);
  return {
    clarity: scoreNarrativeClarity(record),
    coherence: record.emotionalConsistencyScore
      ? round((record.emotionalConsistencyScore / 100) * 10)
      : 0,
    specificity: scoreSpecificity(record),
    stability: extracted.momentSignature && !extracted.momentSignature.startsWith("baseline") ? 8 : 5,
    hrps: scoreHRPS(record),
  };
}

export function trackJaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (!setA.size && !setB.size) return 1;
  let inter = 0;
  for (const id of setA) if (setB.has(id)) inter++;
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? round(inter / union) : 0;
}

export function computeDivergence(
  first: ExtractedSoakRecord,
  second: ExtractedSoakRecord
): DivergenceMetrics {
  const hrpsA = scoreExtractedRecord(first).hrps;
  const hrpsB = scoreExtractedRecord(second).hrps;
  return {
    momentLabelClassStable:
      classifyMomentLabel(first.primaryNarrative.momentLabel) ===
      classifyMomentLabel(second.primaryNarrative.momentLabel),
    arcDirectionStable:
      classifyArcDirection(first.primaryNarrative.arcSummary, PERCEPTION_FIXED_PHASES) ===
      classifyArcDirection(second.primaryNarrative.arcSummary, PERCEPTION_FIXED_PHASES),
    trackJaccard: trackJaccard(first.trackIds, second.trackIds),
    momentLabelChanged:
      first.primaryNarrative.momentLabel !== second.primaryNarrative.momentLabel,
    hrpsDelta: round(hrpsB - hrpsA),
  };
}

export function computeBehaviouralProxies(
  events: ExtractedSoakRecord[],
  sessionGenerateCount: number
): BehaviouralProxies {
  const successes = events.filter((e) => e.trackCount > 0);
  const regenScenarios = events.filter(
    (e) => e.scenario === "regenerate" || e.scenario === "regenerate_followup"
  );
  const totalGenerates = events.filter((e) => e.scenario === "generate" || e.scenario === "regenerate").length;

  const saveProxy = successes.filter(
    (e) =>
      e.spotifyPlaylistUrl &&
      (e.emotionalConsistencyScore ?? 0) >= 70 &&
      !e.partial
  );

  const bottomQuartileSkip = successes.flatMap((e) => {
    if (!e.matchStrengths.length) return [];
    const sorted = [...e.matchStrengths].sort((a, b) => a - b);
    const q = Math.max(1, Math.floor(sorted.length / 4));
    return sorted.slice(0, q).map((s) => 1 - s);
  });

  return {
    regenerateRate: totalGenerates > 0 ? round(regenScenarios.length / totalGenerates) : 0,
    saveProxyRate: successes.length > 0 ? round(saveProxy.length / successes.length) : 0,
    continuationProxyRate: sessionGenerateCount >= 2 ? 1 : 0,
    skipProxyMean:
      bottomQuartileSkip.length > 0
        ? round(bottomQuartileSkip.reduce((a, b) => a + b, 0) / bottomQuartileSkip.length)
        : 0,
  };
}

export function listBenchmarkPrompts(): readonly string[] {
  return BENCHMARK_PROMPTS;
}
