import type { PlaylistWhySummary } from "./playlist-why-summary";

import { isExperimentEnabled } from "./experiment-flags";

export interface DebugSignals {
  fallbackExplanation: string | null;
  sceneBreakdown: PlaylistWhySummary | null;
  emphasisAnchors: Array<{ trackId: string; name: string; artist: string }>;
  energyCurve: number[];
  momentTruthSentence?: string;
  identitySignature?: string;
  selectionSignature?: string;
  signatureDiversified?: boolean;
  expandedDiagnostics?: {
    trackCount: number;
    emphasisAnchorCount: number;
    energySpread: number;
  };
}

export function buildDebugSignals(opts: {
  fallbackExplanation: string | null;
  playlistWhy: PlaylistWhySummary;
  tracks: Array<{
    trackId: string;
    trackName?: string;
    name?: string;
    artistName?: string;
    artist?: string;
    energy?: number | null;
    emphasisAnchor?: boolean;
  }>;
  momentTruthSentence?: string;
  identitySignature?: string;
  selectionSignature?: string;
  signatureDiversified?: boolean;
}): DebugSignals {
  const energies = opts.tracks.map((t) => t.energy ?? 0.5);
  const base: DebugSignals = {
    fallbackExplanation: opts.fallbackExplanation,
    sceneBreakdown: opts.playlistWhy,
    emphasisAnchors: opts.tracks
      .filter((t) => t.emphasisAnchor)
      .map((t) => ({
        trackId: t.trackId,
        name: t.trackName ?? t.name ?? "Unknown",
        artist: t.artistName ?? t.artist ?? "Unknown",
      })),
    energyCurve: energies.map((e) =>
      Math.round(e * 1000) / 1000
    ),
    ...(opts.momentTruthSentence ? { momentTruthSentence: opts.momentTruthSentence } : {}),
    ...(opts.identitySignature ? { identitySignature: opts.identitySignature } : {}),
    ...(opts.selectionSignature ? { selectionSignature: opts.selectionSignature } : {}),
    ...(opts.signatureDiversified != null
      ? { signatureDiversified: opts.signatureDiversified }
      : {}),
  };

  if (!isExperimentEnabled("debug_signals_expansion")) {
    return base;
  }

  const minEnergy = energies.length ? Math.min(...energies) : 0;
  const maxEnergy = energies.length ? Math.max(...energies) : 0;

  return {
    ...base,
    expandedDiagnostics: {
      trackCount: opts.tracks.length,
      emphasisAnchorCount: opts.tracks.filter((t) => t.emphasisAnchor).length,
      energySpread: Math.round((maxEnergy - minEnergy) * 1000) / 1000,
    },
  };
}
