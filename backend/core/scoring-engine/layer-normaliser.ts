/**
 * Layer contribution normaliser — no silent layer may exceed 55% of explained score mass.
 */

export interface LayerContributions {
  genre: number;
  scene: number;
  emotion: number;
  library: number;
  forecast: number;
  memory: number;
  graph: number;
  discovery: number;
  penalty: number;
  sceneRouting: number;
  ecosystem: number;
}

export const MAX_LAYER_DOMINANCE = 0.55;

export interface LayerNormaliseResult {
  contributions: LayerContributions;
  dominantLayer: keyof LayerContributions | null;
  dominanceShare: number;
  rebalanceApplied: boolean;
  driftWarning: boolean;
}

export function sumPositiveLayers(c: LayerContributions): number {
  return Math.max(
    0.001,
    Math.abs(c.genre) +
      Math.abs(c.scene) +
      Math.abs(c.emotion) +
      Math.abs(c.library) +
      Math.abs(c.forecast) +
      Math.abs(c.memory) +
      Math.abs(c.graph) +
      Math.abs(c.discovery) +
      Math.abs(c.penalty) +
      Math.abs(c.sceneRouting) +
      Math.abs(c.ecosystem)
  );
}

export function normaliseLayerContributions(
  raw: LayerContributions,
  opts: { rebalance?: boolean } = {}
): LayerNormaliseResult {
  const entries = Object.entries(raw) as [keyof LayerContributions, number][];
  const total = sumPositiveLayers(raw);

  const shares: [keyof LayerContributions, number][] = entries.map(([k, v]) => [
    k,
    Math.abs(v) / total,
  ]);

  shares.sort((a, b) => b[1] - a[1]);
  const [dominantLayer, dominanceShare] = shares[0] ?? [null, 0];
  const driftWarning = dominanceShare > MAX_LAYER_DOMINANCE;

  let contributions = { ...raw };
  let rebalanceApplied = false;

  if (opts.rebalance && driftWarning && dominantLayer) {
    rebalanceApplied = true;
    const scale = MAX_LAYER_DOMINANCE / dominanceShare;
    contributions = {
      ...contributions,
      [dominantLayer]: (contributions[dominantLayer] ?? 0) * scale,
    } as LayerContributions;
  }

  return {
    contributions,
    dominantLayer,
    dominanceShare: Math.round(dominanceShare * 1000) / 1000,
    rebalanceApplied,
    driftWarning,
  };
}

export function summariseLayerContributions(
  traces: { contributions: LayerContributions }[]
): Record<string, number> {
  const sum: Partial<Record<keyof LayerContributions, number>> = {};
  for (const t of traces) {
    for (const [k, v] of Object.entries(t.contributions) as [keyof LayerContributions, number][]) {
      sum[k] = (sum[k] ?? 0) + Math.abs(v);
    }
  }
  const total = Object.values(sum).reduce((a, b) => a + b, 0) || 1;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(sum) as [keyof LayerContributions, number][]) {
    out[k] = Math.round((v / total) * 1000) / 1000;
  }
  return out;
}
