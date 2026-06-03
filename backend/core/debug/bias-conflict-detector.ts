/**
 * Detect competing layer signals on the same genre.
 */

import type { RootGenre } from "../../lib/genre-taxonomy";

export type LayerSignal = "boost" | "suppress" | "neutral";

export interface LayerGenreSignal {
  layer: string;
  signal: LayerSignal;
  magnitude: number;
}

export interface BiasConflictReport {
  genre: string;
  conflictingLayers: string[];
  severityScore: number;
  resolutionStrategyApplied: string;
}

export function detectBiasConflicts(
  genreSignals: Map<string, LayerGenreSignal[]>
): BiasConflictReport[] {
  const reports: BiasConflictReport[] = [];

  for (const [genre, signals] of genreSignals) {
    const boosts = signals.filter((s) => s.signal === "boost" && s.magnitude > 0.04);
    const suppresses = signals.filter((s) => s.signal === "suppress" && s.magnitude > 0.04);

    if (boosts.length === 0 || suppresses.length === 0) continue;

    const conflictingLayers = [
      ...new Set([...boosts.map((b) => b.layer), ...suppresses.map((s) => s.layer)]),
    ];

    const boostMag = boosts.reduce((s, b) => s + b.magnitude, 0);
    const suppressMag = suppresses.reduce((s, b) => s + b.magnitude, 0);
    const severityScore = Math.min(
      1,
      Math.round((Math.min(boostMag, suppressMag) / Math.max(boostMag, suppressMag, 0.01)) * 1000) /
        1000
    );

    const resolutionStrategyApplied =
      boostMag > suppressMag * 1.2
        ? "net_boost_wins"
        : suppressMag > boostMag * 1.2
          ? "net_suppress_wins"
          : "genre_truth_anchor_priority";

    reports.push({
      genre,
      conflictingLayers,
      severityScore,
      resolutionStrategyApplied,
    });
  }

  return reports.sort((a, b) => b.severityScore - a.severityScore);
}

export function collectGenreSignalsFromPreScore(opts: {
  genre: RootGenre;
  forecastBoost: number;
  memoryBoost: number;
  graphBoost: number;
  sceneRoutingMult: number;
  forecastSuppress?: number;
}): LayerGenreSignal[] {
  const out: LayerGenreSignal[] = [];
  if (opts.forecastBoost > 0.02) {
    out.push({ layer: "forecast", signal: "boost", magnitude: opts.forecastBoost });
  }
  if ((opts.forecastSuppress ?? 0) > 0.02) {
    out.push({ layer: "forecast", signal: "suppress", magnitude: opts.forecastSuppress! });
  }
  if (opts.memoryBoost > 0.02) {
    out.push({ layer: "memory_trace", signal: "boost", magnitude: opts.memoryBoost });
  }
  if (opts.memoryBoost < -0.02) {
    out.push({ layer: "memory_trace", signal: "suppress", magnitude: Math.abs(opts.memoryBoost) });
  }
  if (opts.graphBoost > 0.02) {
    out.push({ layer: "dynamic_graph", signal: "boost", magnitude: opts.graphBoost });
  }
  if (opts.sceneRoutingMult > 1.04) {
    out.push({
      layer: "scene_routing",
      signal: "boost",
      magnitude: opts.sceneRoutingMult - 1,
    });
  }
  if (opts.sceneRoutingMult < 0.88) {
    out.push({
      layer: "scene_routing",
      signal: "suppress",
      magnitude: 1 - opts.sceneRoutingMult,
    });
  }
  return out;
}
