/**
 * Audio-feature provenance: tell real Spotify measurements apart from
 * metadata-inferred values.
 *
 * Spotify's /audio-features endpoint is blocked for this app, so sync and the
 * backfill job store metadata-inferred values (genre prior + title modifiers +
 * per-track hash noise) in the same liked_songs columns as real values, with no
 * source flag. Measured against the user's real Spotify export (9,657 tracks),
 * the inferred values are uncorrelated with the real ones (energy r=0.07,
 * valence r=0.01, tempo r=0.04).
 *
 * Detection is a pure function of the stored values (detectAudioFeatureSource),
 * so it needs no schema change and keeps working when the genre taxonomy changes.
 *
 * Behaviour is deliberately NOT changed here: real-library tests showed that
 * neutralising inferred values (in hard gates or in the scoring embedding channel)
 * made calm prompts worse, because the inferred values still carry a little
 * title signal ("- Acoustic", "Piano", "Slow") that nothing else replaces.
 * Real feature values are what fixes this; when they arrive they are detected
 * as "spotify" automatically.
 */

import { detectAudioFeatureSource, type AudioFeatureSource } from "./metadata-audio-feature-inference";

export type AudioFeatureProvenanceSummary = Record<AudioFeatureSource, number> & { total: number };

export function summariseAudioFeatureProvenance(
  rows: Array<{ trackId: string; energy?: number | null; valence?: number | null; tempo?: number | null; loudness?: number | null }>,
): AudioFeatureProvenanceSummary {
  const summary: AudioFeatureProvenanceSummary = { total: rows.length, spotify: 0, inferred: 0, missing: 0 };
  for (const row of rows) summary[detectAudioFeatureSource(row)] += 1;
  return summary;
}
