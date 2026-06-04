/**
 * Scene Fidelity Score — rates 0–100 how faithfully the final playlist
 * honours the detected semantic scene.
 *
 * Components:
 *   35 pts — Ecosystem compliance (% of tracks from scene genres)
 *   25 pts — Anti-genre purity (absence of banned genres)
 *   25 pts — Energy fit (avg track energy vs scene energy target)
 *   15 pts — Composition target adherence (primary/adjacent/other ratios)
 */

import type { SemanticSceneVector } from "./semantic-scene-engine";
import type { TrackGenreClassification } from "./genre-taxonomy";

export interface SceneFidelityResult {
  score: number;
  grade: "S" | "A" | "B" | "C" | "D" | "F";
  components: {
    ecosystemCompliance: number;
    antiGenrePurity: number;
    energyFit: number;
    compositionTarget: number;
  };
  reasons: string[];
  dominated: boolean;
}

interface TrackStub {
  trackId: string;
  genrePrimary?: string | null;
  energy?: number | null;
  finalScore?: number;
}

function gradeFromScore(score: number): SceneFidelityResult["grade"] {
  if (score >= 90) return "S";
  if (score >= 78) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  if (score >= 35) return "D";
  return "F";
}

/**
 * Compute the fidelity of the final playlist against the detected scene.
 */
export function computeSceneFidelity(
  tracks: TrackStub[],
  classifications: Map<string, TrackGenreClassification>,
  scene: SemanticSceneVector
): SceneFidelityResult {
  if (!tracks.length) {
    return {
      score: 0,
      grade: "F",
      components: { ecosystemCompliance: 0, antiGenrePurity: 0, energyFit: 0, compositionTarget: 0 },
      reasons: ["No tracks to evaluate"],
      dominated: false,
    };
  }

  const reasons: string[] = [];
  const sceneGenres = new Set<string>(scene.genreEcosystem.map((g) => g.genre));
  const antiGenres = new Set<string>(scene.antiGenres ?? []);

  // ── 1. Ecosystem compliance (35 pts) ──────────────────────────────────────
  let inEcosystem = 0;
  for (const track of tracks) {
    const cls = classifications.get(track.trackId);
    const genre = cls?.genrePrimary ?? track.genrePrimary ?? "";
    if (sceneGenres.has(genre)) inEcosystem++;
  }
  const ecosystemRatio = inEcosystem / tracks.length;
  const floorRequired = scene.ecosystemFloor ?? 0.65;
  // Full marks if at or above floor; partial credit if below
  const ecosystemPts = Math.min(35, Math.round((ecosystemRatio / floorRequired) * 35));
  if (ecosystemRatio < floorRequired) {
    reasons.push(
      `Ecosystem compliance ${Math.round(ecosystemRatio * 100)}% — target ≥${Math.round(floorRequired * 100)}%`
    );
  }

  // ── 2. Anti-genre purity (25 pts) ─────────────────────────────────────────
  let leaked = 0;
  for (const track of tracks) {
    const cls = classifications.get(track.trackId);
    const genre = cls?.genrePrimary ?? track.genrePrimary ?? "";
    if (antiGenres.has(genre)) leaked++;
  }
  const leakRatio = leaked / tracks.length;
  // 0 leaks = 25 pts; every 1% leak costs ~0.5 pts, floor at 0
  const antiGenrePts = Math.max(0, Math.round(25 - leakRatio * 250));
  if (leaked > 0) {
    reasons.push(`${leaked} anti-genre track${leaked !== 1 ? "s" : ""} leaked into playlist`);
  }

  // ── 3. Energy fit (25 pts) ────────────────────────────────────────────────
  const tracksWithEnergy = tracks.filter((t) => t.energy != null);
  let energyPts = 12; // neutral when no data
  if (tracksWithEnergy.length >= 3) {
    const avgEnergy =
      tracksWithEnergy.reduce((s, t) => s + (t.energy ?? 0), 0) / tracksWithEnergy.length;
    const target = scene.energy.target;
    const range = scene.energy.max - scene.energy.min;
    const deviation = Math.abs(avgEnergy - target);
    // Within range = full marks; deviation beyond range scores down
    const relativeDeviation = deviation / (range / 2 + 0.01);
    energyPts = Math.max(0, Math.round(25 * (1 - Math.min(1, relativeDeviation))));
    if (deviation > range / 2) {
      reasons.push(
        `Avg energy ${Math.round(avgEnergy * 100)}% vs scene target ${Math.round(target * 100)}%`
      );
    }
  }

  // ── 4. Composition target (15 pts) ────────────────────────────────────────
  const compTarget = scene.compositionTarget;
  let compositionPts = 15;
  if (compTarget) {
    // Compute primary genre share
    const genreCount: Record<string, number> = {};
    for (const track of tracks) {
      const cls = classifications.get(track.trackId);
      const genre = cls?.genrePrimary ?? track.genrePrimary ?? "unknown";
      genreCount[genre] = (genreCount[genre] ?? 0) + 1;
    }
    const entries = Object.entries(genreCount).sort((a, b) => b[1] - a[1]);
    const primaryShare = entries.length > 0 ? entries[0][1] / tracks.length : 0;
    const shortfall = Math.max(0, compTarget.primaryMin - primaryShare);
    compositionPts = Math.max(0, Math.round(15 * (1 - shortfall / 0.3)));
    if (primaryShare < compTarget.primaryMin) {
      reasons.push(
        `Primary genre ${Math.round(primaryShare * 100)}% — target ≥${Math.round(compTarget.primaryMin * 100)}%`
      );
    }
  }

  // ── Final score ───────────────────────────────────────────────────────────
  const raw = ecosystemPts + antiGenrePts + energyPts + compositionPts;
  const score = Math.min(100, Math.max(0, raw));

  if (reasons.length === 0) {
    reasons.push(`Scene faithfully honoured — ${scene.label}`);
  }

  return {
    score,
    grade: gradeFromScore(score),
    components: {
      ecosystemCompliance: ecosystemPts,
      antiGenrePurity: antiGenrePts,
      energyFit: energyPts,
      compositionTarget: compositionPts,
    },
    reasons,
    dominated: ecosystemRatio >= floorRequired && leaked === 0,
  };
}
