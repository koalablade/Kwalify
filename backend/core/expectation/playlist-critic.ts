/**
 * Human Expectation Layer — Playlist Critic (the "human editor").
 *
 * Not another numeric validator: an editorial reasoning step that asks, of the
 * finished playlist, "if a professional curator saw this with this prompt,
 * would they approve it?" It evaluates the playlist as a JOURNEY (opening /
 * middle / ending), answers seven curator questions, and folds in the failure
 * taxonomy to produce a verdict (publish / repair / reject) plus an honest fit.
 */

import { detectFailureModes, failureModePresent } from "./failure-taxonomy";
import { evaluateTrackAdmissibility } from "./track-admissibility";
import type {
  EditorialQuestion,
  ExpectationContract,
  ExpectationTrack,
  FailureFinding,
  MomentInterpretation,
  PlaylistCritiqueResult,
  SectionCritique,
} from "./types";

function avg(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}

function sectionFit(tracks: ExpectationTrack[], contract: ExpectationContract): number {
  return avg(tracks.map((t) => evaluateTrackAdmissibility(t, contract).score));
}

export interface CritiqueOptions {
  now?: Date;
}

export function critiquePlaylist(
  tracks: ExpectationTrack[],
  contract: ExpectationContract,
  interpretation: MomentInterpretation,
  opts: CritiqueOptions = {},
): PlaylistCritiqueResult {
  const world = interpretation.candidates[0]?.label ?? contract.atmosphere.join(", ") ?? "the moment";
  const failureModes = detectFailureModes(tracks, contract, interpretation, opts.now ?? new Date());

  const n = tracks.length;
  const openTracks = tracks.slice(0, Math.min(5, n));
  const midTracks = n > 6 ? tracks.slice(Math.min(5, n), Math.max(Math.min(5, n), n - 3)) : tracks;
  const endTracks = n > 3 ? tracks.slice(Math.max(0, n - 3)) : tracks;

  const opening: SectionCritique = { fit: sectionFit(openTracks, contract) };
  const middle: SectionCritique = { fit: sectionFit(midTracks, contract) };
  const ending: SectionCritique = { fit: sectionFit(endTracks, contract) };

  if (failureModePresent(failureModes, "OPENING_MISREPRESENTS")) {
    opening.problem = "Opening tracks do not immediately communicate the moment.";
  }
  if (failureModePresent(failureModes, "IDENTITY_COLLAPSE")) {
    middle.problem = "Identity drifts through the middle of the playlist.";
  }
  const endingSpike = endTracks.some((t) => {
    const a = evaluateTrackAdmissibility(t, contract);
    return a.severity === "high" || a.violations.some((v) => /energy too high/.test(v));
  });
  if (endingSpike) ending.problem = "Ending breaks the emotional aftertaste (energy spike / off-vibe filler).";

  // Editorial reasoning — seven curator questions.
  const admissible = tracks.map((t) => evaluateTrackAdmissibility(t, contract));
  const admissibleRatio = avg(admissible.map((a) => (a.admissible ? 1 : 0)));
  const artists = new Set(tracks.map((t) => (t.artistName ?? "").trim().toLowerCase()).filter(Boolean));
  const uniqueArtistRatio = n === 0 ? 0 : artists.size / n;

  const editorial: Record<EditorialQuestion, { pass: boolean; note: string }> = {
    promptUnderstanding: {
      pass: opening.fit >= 0.6 && !failureModePresent(failureModes, "WRONG_WORLD"),
      note: `Opening fit ${opening.fit.toFixed(2)} for "${world}".`,
    },
    emotionalTruth: {
      pass: !failureModePresent(failureModes, "MOOD_INVERSION") && middle.fit >= 0.55,
      note: failureModePresent(failureModes, "MOOD_INVERSION") ? "Emotional tone is inverted in places." : "Emotional tone holds.",
    },
    immersion: {
      pass: admissibleRatio >= 0.8 && !failureModePresent(failureModes, "SEASON_MISMATCH"),
      note: `${Math.round(admissibleRatio * 100)}% of tracks stay inside the world.`,
    },
    coherence: {
      pass: !failureModePresent(failureModes, "IDENTITY_COLLAPSE") && Math.min(opening.fit, middle.fit, ending.fit) >= 0.45,
      note: `Section fits — open ${opening.fit.toFixed(2)}, mid ${middle.fit.toFixed(2)}, end ${ending.fit.toFixed(2)}.`,
    },
    artistBalance: {
      pass: !failureModePresent(failureModes, "ARTIST_FATIGUE") && uniqueArtistRatio >= 0.6,
      note: `${artists.size} artists across ${n} tracks.`,
    },
    discovery: {
      pass: !failureModePresent(failureModes, "TOO_GENERIC"),
      note: contract.discovery,
    },
    trust: {
      pass:
        admissibleRatio >= 0.85 &&
        !failureModes.some((f) => f.severity === "high"),
      note: "Would a first-time user trust this?",
    },
  };

  // Overall fit: journey-weighted, penalised by failures.
  let overallFit = (opening.fit * 0.35 + middle.fit * 0.4 + ending.fit * 0.25) * 100;
  for (const f of failureModes) {
    overallFit -= f.severity === "high" ? 22 : f.severity === "medium" ? 11 : 4;
  }
  overallFit = Math.max(0, Math.min(100, Math.round(overallFit)));

  const strengths: string[] = [];
  if (opening.fit >= 0.7) strengths.push("opening clearly establishes the moment");
  if (uniqueArtistRatio >= 0.75) strengths.push("healthy artist variety");
  if (admissibleRatio >= 0.9) strengths.push("strong atmospheric consistency");
  if (ending.fit >= 0.65 && !endingSpike) strengths.push("ending leaves the right aftertaste");
  if (strengths.length === 0) strengths.push("individually solid track choices");

  const problems: string[] = failureModes.map((f) => f.detail);

  const recommendedChanges: string[] = [];
  const hardFindings = failureModes.filter((f) => f.severity !== "low");
  for (const f of hardFindings) {
    if (f.mode === "MOOD_INVERSION" || f.mode === "ENERGY_MISMATCH") {
      recommendedChanges.push(`Replace ${f.trackIds.length} off-vibe track(s) with closer emotional matches.`);
    } else if (f.mode === "ARTIST_FATIGUE") {
      recommendedChanges.push(`Trim over-repeated artist to restore variety.`);
    } else if (f.mode === "SEASON_MISMATCH") {
      recommendedChanges.push(`Remove seasonal/holiday tracks that don't belong.`);
    } else if (f.mode === "OPENING_MISREPRESENTS") {
      recommendedChanges.push(`Swap the opening so the first tracks communicate the moment.`);
    } else if (f.mode === "IDENTITY_COLLAPSE") {
      recommendedChanges.push(`Rebuild the second half to hold the playlist identity.`);
    } else if (f.mode === "NEAR_DUPLICATE") {
      recommendedChanges.push(`Drop ${f.trackIds.length} near-duplicate recording(s) so the playlist stops repeating itself.`);
    }
  }

  // Verdict.
  const hasHigh = failureModes.some((f) => f.severity === "high");
  const openingBroken = failureModePresent(failureModes, "OPENING_MISREPRESENTS") && opening.fit < 0.4;
  let verdict: PlaylistCritiqueResult["verdict"];
  if (openingBroken || overallFit < 40) {
    verdict = "reject";
  } else if (hasHigh || hardFindings.length > 0 || overallFit < 70) {
    verdict = "repair";
  } else {
    verdict = "publish";
  }

  return {
    overallFit,
    verdict,
    world,
    opening,
    middle,
    ending,
    strengths,
    problems,
    failureModes,
    recommendedChanges,
    editorial,
  };
}

/** Compact form for logs / API diagnostics. */
export function compactCritique(c: PlaylistCritiqueResult) {
  return {
    overallFit: c.overallFit,
    verdict: c.verdict,
    world: c.world,
    sections: { opening: c.opening, middle: c.middle, ending: c.ending },
    failureModes: c.failureModes.map((f) => ({ mode: f.mode, severity: f.severity, detail: f.detail, count: f.trackIds.length })),
    strengths: c.strengths,
    recommendedChanges: c.recommendedChanges,
    editorial: c.editorial,
  };
}

/** Which findings should trigger track removal in repair (severity >= medium). */
export function findingsToRepair(findings: FailureFinding[]): FailureFinding[] {
  return findings.filter((f) => f.severity !== "low" && f.trackIds.length > 0);
}
