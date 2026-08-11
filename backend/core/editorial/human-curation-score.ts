/**
 * Human Curation Score — 100-point listenability evaluator with evidence.
 * Primary KPI for playlist quality; not KEEP count or purity.
 */

import {
  applyHumanCurationSequencing,
  inferHumanCurationActivity,
  isObscureDeepCutOpener,
  scorePositionFit,
  detectListenabilityFailures,
  type HumanCurationTrack,
} from "./human-curation-sequencer";
import { isAnchorArtistForProfile, resolveCulturalProfileForCommitted, scoreTrackWorldIdentity } from "./world-identity-score";
import { resolveCommittedWorld } from "../committed-world";
import { humanPlausibilityScore } from "./human-playlist-patterns";
import {
  classifySaveabilityDeliveryTier,
  deriveWouldSaveVerdict,
  type SaveabilityDeliveryTier,
} from "./saveability-verdict";
import { deriveWouldShareVerdict } from "./shareability-verdict";

export type HumanCurationVerdict = "YES" | "MAYBE" | "NO";
export type AiObviousness = "LOW" | "MEDIUM" | "HIGH";

export type TrackLevelDiagnostic = {
  trackName: string;
  artistName: string;
  promptFit: number;
  momentFit: number;
  positionFit: number;
  humanPlausibility: number;
  contribution: number;
  notes: string[];
};

export type HumanCurationScoreResult = {
  totalScore: number;
  dimensions: {
    momentUnderstanding: { score: number; max: 25; evidence: string[] };
    cohesion: { score: number; max: 20; evidence: string[] };
    sequencing: { score: number; max: 20; evidence: string[] };
    humanPlausibility: { score: number; max: 15; evidence: string[] };
    variety: { score: number; max: 10; evidence: string[] };
    canonicalAnchors: { score: number; max: 5; evidence: string[] };
    interestingChoices: { score: number; max: 5; evidence: string[] };
  };
  wouldPressPlay: HumanCurationVerdict;
  wouldSave: HumanCurationVerdict;
  /** Delivery tier used for tier-aware Save verdict (Experiment D). */
  saveabilityDeliveryTier: SaveabilityDeliveryTier;
  wouldShare: HumanCurationVerdict;
  wouldBelieveHumanMade: HumanCurationVerdict;
  aiObviousness: AiObviousness;
  trackDiagnostics: TrackLevelDiagnostic[];
};

function artistKey(track: HumanCurationTrack): string {
  return String(track.artistName ?? "").toLowerCase().trim();
}

function energyOf(track: HumanCurationTrack): number {
  const e = track.energy;
  return typeof e === "number" && Number.isFinite(e) ? e : 0.5;
}

function findArtistRuns(tracks: HumanCurationTrack[], minRun: number): number {
  let maxRun = 1;
  let run = 1;
  for (let i = 1; i < tracks.length; i += 1) {
    if (artistKey(tracks[i]!) === artistKey(tracks[i - 1]!)) {
      run += 1;
      maxRun = Math.max(maxRun, run);
    } else {
      run = 1;
    }
  }
  return maxRun >= minRun ? maxRun : 0;
}

function toPatternTracks(tracks: HumanCurationTrack[]): Array<HumanCurationTrack & { trackId: string }> {
  return tracks.map((t, i) => ({
    ...t,
    trackId: `${t.artistName ?? "?"}|${t.trackName ?? i}`,
  }));
}

function countUniqueArtists(tracks: HumanCurationTrack[]): number {
  return new Set(tracks.map(artistKey).filter(Boolean)).size;
}

function worstTransitionIndex(tracks: HumanCurationTrack[], activity: ReturnType<typeof inferHumanCurationActivity>): number {
  let worst = -1;
  let worstDrop = 0;
  for (let i = 1; i < tracks.length; i += 1) {
    const prevFit = scorePositionFit(tracks[i - 1]!, i - 1, tracks.length, activity);
    const currFit = scorePositionFit(tracks[i]!, i, tracks.length, activity);
    const drop = prevFit - currFit;
    if (drop > worstDrop) {
      worstDrop = drop;
      worst = i;
    }
    if (artistKey(tracks[i]!) === artistKey(tracks[i - 1]!)) {
      worst = i;
      break;
    }
  }
  return worst;
}

/** Score a delivered playlist on human curation dimensions. */
export function evaluateHumanCurationScore(
  prompt: string,
  tracks: HumanCurationTrack[],
): HumanCurationScoreResult {
  const activity = inferHumanCurationActivity(prompt);
  const committed = resolveCommittedWorld({ prompt });
  const profile = resolveCulturalProfileForCommitted(committed);
  const listenabilityFailures = detectListenabilityFailures(tracks, prompt);

  const momentEvidence: string[] = [];
  const cohesionEvidence: string[] = [];
  const sequencingEvidence: string[] = [];
  const plausibilityEvidence: string[] = [];
  const varietyEvidence: string[] = [];
  const anchorEvidence: string[] = [];
  const interestingEvidence: string[] = [];

  if (tracks.length === 0) {
    return {
      totalScore: 0,
      dimensions: {
        momentUnderstanding: { score: 0, max: 25, evidence: ["Empty playlist — no moment delivered."] },
        cohesion: { score: 0, max: 20, evidence: ["No tracks."] },
        sequencing: { score: 0, max: 20, evidence: ["No tracks."] },
        humanPlausibility: { score: 0, max: 15, evidence: ["No tracks."] },
        variety: { score: 0, max: 10, evidence: ["No tracks."] },
        canonicalAnchors: { score: 0, max: 5, evidence: ["No tracks."] },
        interestingChoices: { score: 0, max: 5, evidence: ["No tracks."] },
      },
      wouldPressPlay: "NO",
      wouldSave: "NO",
      saveabilityDeliveryTier: "STUB",
      wouldShare: "NO",
      wouldBelieveHumanMade: "NO",
      aiObviousness: "HIGH",
      trackDiagnostics: [],
    };
  }

  // Moment understanding /25
  let momentScore = 25;
  {
    const positionFits = tracks.map((t, i) => scorePositionFit(t, i, tracks.length, activity));
    const avgFit = positionFits.reduce((a, b) => a + b, 0) / positionFits.length;
    if (avgFit < 0.45) {
      momentScore -= 12;
      momentEvidence.push(`Low average position fit (${avgFit.toFixed(2)}) for ${activity ?? "general"} context.`);
    } else if (avgFit < 0.55) {
      momentScore -= 6;
      momentEvidence.push(`Moderate position fit (${avgFit.toFixed(2)}).`);
    } else {
      momentEvidence.push(`Strong position fit (${avgFit.toFixed(2)}) for prompt activity.`);
    }
    const weakSlots = positionFits.filter((f) => f < 0.35).length;
    if (weakSlots >= 2) {
      momentScore -= Math.min(8, weakSlots * 2);
      momentEvidence.push(`${weakSlots} tracks with poor moment fit (<0.35).`);
    }
    if (tracks.length === 1) {
      momentScore -= 15;
      momentEvidence.push("Single-track delivery cannot sustain a moment arc.");
    }
  }

  // Cohesion /20
  let cohesionScore = 20;
  if (profile && tracks.length > 0) {
    const worldScores = tracks.map((t) => scoreTrackWorldIdentity(t, profile));
    const avgWorld = worldScores.reduce((a, b) => a + b, 0) / worldScores.length;
    if (avgWorld < 0.65) {
      cohesionScore -= 10;
      cohesionEvidence.push(`Weak world cohesion (avg identity ${avgWorld.toFixed(2)}).`);
    } else if (avgWorld < 0.78) {
      cohesionScore -= 4;
      cohesionEvidence.push(`Acceptable world cohesion (${avgWorld.toFixed(2)}).`);
    } else {
      cohesionEvidence.push(`Believable single world (${avgWorld.toFixed(2)}).`);
    }
    const offWorld = worldScores.filter((s) => s < 0.5).length;
    if (offWorld > 0) {
      cohesionScore -= Math.min(8, offWorld * 3);
      cohesionEvidence.push(`${offWorld} off-world track(s) break immersion.`);
    }
  } else if (tracks.length > 0) {
    cohesionEvidence.push("No committed world — cohesion judged on plausibility only.");
    cohesionScore -= 4;
  } else {
    cohesionScore = 0;
    cohesionEvidence.push("No tracks.");
  }

  // Sequencing /20
  let sequencingScore = 20;
  const maxRun = findArtistRuns(tracks, 3);
  if (maxRun >= 3) {
    sequencingScore -= 10;
    sequencingEvidence.push(`${maxRun} consecutive tracks from same artist — amateur sequencing.`);
  } else if (findArtistRuns(tracks, 2) >= 2) {
    sequencingScore -= 4;
    sequencingEvidence.push("Some back-to-back same-artist pairs.");
  } else {
    sequencingEvidence.push("No excessive artist clustering.");
  }
  const badTransition = worstTransitionIndex(tracks, activity);
  if (badTransition >= 0) {
    sequencingScore -= 3;
    const t = tracks[badTransition]!;
    sequencingEvidence.push(
      `Weak transition into #${badTransition + 1}: ${t.artistName} — ${t.trackName}.`,
    );
  }
  if (tracks[0] && isObscureDeepCutOpener(tracks[0], 0)) {
    sequencingScore -= 6;
    sequencingEvidence.push(`Obscure deep cut opens: ${tracks[0].artistName} — ${tracks[0].trackName}.`);
  }

  // Human plausibility /15
  let plausibilityScore = 15;
  const plaus = tracks.length > 0 ? humanPlausibilityScore(toPatternTracks(tracks)) : 0;
  if (plaus < 0.45) {
    plausibilityScore -= 10;
    plausibilityEvidence.push(`Low human plausibility (${plaus.toFixed(2)}).`);
  } else if (plaus < 0.6) {
    plausibilityScore -= 4;
    plausibilityEvidence.push(`Moderate plausibility (${plaus.toFixed(2)}).`);
  } else {
    plausibilityEvidence.push(`Believable curation (${plaus.toFixed(2)}).`);
  }

  // Variety /10
  let varietyScore = 10;
  const uniqueArtists = countUniqueArtists(tracks);
  if (tracks.length >= 5) {
    const ratio = uniqueArtists / tracks.length;
    if (ratio < 0.45) {
      varietyScore -= 6;
      varietyEvidence.push(`Low artist diversity (${uniqueArtists}/${tracks.length}).`);
    } else if (ratio < 0.6) {
      varietyScore -= 2;
      varietyEvidence.push(`Moderate diversity (${uniqueArtists} artists).`);
    } else {
      varietyEvidence.push(`Good artist spread (${uniqueArtists} artists).`);
    }
  } else if (tracks.length > 0) {
    varietyScore -= 5;
    varietyEvidence.push(`Thin playlist (${tracks.length} tracks) limits variety assessment.`);
  } else {
    varietyScore = 0;
  }

  // Canonical anchors /5
  let anchorScore = 5;
  if (profile && tracks.length > 0) {
    const anchorHits = tracks.filter((t) => isAnchorArtistForProfile(t.artistName, profile)).length;
    const expectedMin = activity === "madchester" ? 2 : activity === "disco" ? 1 : 0;
    if (expectedMin > 0 && anchorHits < expectedMin) {
      anchorScore -= expectedMin === 2 ? 4 : 3;
      anchorEvidence.push(`Missing canonical anchors (found ${anchorHits}, expected ≥${expectedMin}).`);
    } else if (anchorHits > 0) {
      anchorEvidence.push(`${anchorHits} roster anchor artist(s) present.`);
    } else {
      anchorScore -= 2;
      anchorEvidence.push("No roster anchor artists detected.");
    }
  } else {
    anchorScore = tracks.length > 0 ? 3 : 0;
    anchorEvidence.push("No world profile for anchor check.");
  }

  // Interesting choices /5
  let interestingScore = 5;
  const deepCuts = tracks.filter((t) => (t.popularity ?? 50) < 35).length;
  if (tracks.length >= 8 && deepCuts === 0) {
    interestingScore -= 2;
    interestingEvidence.push("All mainstream — no dig-deeper texture.");
  } else if (deepCuts > tracks.length * 0.5) {
    interestingScore -= 3;
    interestingEvidence.push("Too many obscurities — feels algorithmic.");
  } else if (deepCuts >= 1 && deepCuts <= 3) {
    interestingEvidence.push(`${deepCuts} earned deep cut(s) add character.`);
  } else {
    interestingEvidence.push("Balanced familiarity mix.");
  }

  for (const f of listenabilityFailures) {
    const penalty = f.severity === "major" ? 8 : 4;
    if (
      f.code.includes("ballad") ||
      f.code.includes("bbq") ||
      f.code.includes("motorway") ||
      f.code.includes("stub") ||
      f.code.includes("thin")
    ) {
      momentScore -= penalty;
      momentEvidence.push(f.detail);
    }
    if (f.code.includes("opener") || f.code.includes("artist_run") || f.code.includes("oasis")) {
      sequencingScore -= penalty;
      sequencingEvidence.push(f.detail);
    }
    if (f.code.includes("canonical") || f.code.includes("missing")) {
      anchorScore -= Math.min(4, penalty);
      anchorEvidence.push(f.detail);
    }
  }

  const clamp = (n: number, max: number) => Math.max(0, Math.min(max, Math.round(n)));
  const dimensions: HumanCurationScoreResult["dimensions"] = {
    momentUnderstanding: { score: clamp(momentScore, 25), max: 25, evidence: momentEvidence },
    cohesion: { score: clamp(cohesionScore, 20), max: 20, evidence: cohesionEvidence },
    sequencing: { score: clamp(sequencingScore, 20), max: 20, evidence: sequencingEvidence },
    humanPlausibility: { score: clamp(plausibilityScore, 15), max: 15, evidence: plausibilityEvidence },
    variety: { score: clamp(varietyScore, 10), max: 10, evidence: varietyEvidence },
    canonicalAnchors: { score: clamp(anchorScore, 5), max: 5, evidence: anchorEvidence },
    interestingChoices: { score: clamp(interestingScore, 5), max: 5, evidence: interestingEvidence },
  };

  const totalScore =
    dimensions.momentUnderstanding.score +
    dimensions.cohesion.score +
    dimensions.sequencing.score +
    dimensions.humanPlausibility.score +
    dimensions.variety.score +
    dimensions.canonicalAnchors.score +
    dimensions.interestingChoices.score;

  const trackDiagnostics: TrackLevelDiagnostic[] = tracks.map((t, i) => {
    const promptFit = profile ? scoreTrackWorldIdentity(t, profile) * 10 : 5;
    const momentFit = scorePositionFit(t, i, tracks.length, activity) * 10;
    const positionFit = momentFit;
    const humanP = humanPlausibilityScore(toPatternTracks([t])) * 10;
    const contribution = (promptFit + momentFit + humanP) / 3;
    const notes: string[] = [];
    if (isObscureDeepCutOpener(t, i)) notes.push("obscure for this slot");
    if (i > 0 && artistKey(t) === artistKey(tracks[i - 1]!)) notes.push("adjacent same artist");
    return {
      trackName: String(t.trackName ?? "?"),
      artistName: String(t.artistName ?? "?"),
      promptFit: Math.round(promptFit * 10) / 10,
      momentFit: Math.round(momentFit * 10) / 10,
      positionFit: Math.round(positionFit * 10) / 10,
      humanPlausibility: Math.round(humanP * 10) / 10,
      contribution: Math.round(contribution * 10) / 10,
      notes,
    };
  });

  const saveabilityDeliveryTier = classifySaveabilityDeliveryTier(tracks.length, listenabilityFailures);

  const wouldPressPlay: HumanCurationVerdict =
    totalScore >= 65 && tracks.length >= 3 ? "YES" : totalScore >= 45 ? "MAYBE" : "NO";
  const wouldSave: HumanCurationVerdict = deriveWouldSaveVerdict({
    totalScore,
    trackCount: tracks.length,
    momentScore: dimensions.momentUnderstanding.score,
    listenabilityFailures,
  });
  const wouldShare: HumanCurationVerdict = deriveWouldShareVerdict({
    totalScore,
    trackCount: tracks.length,
    sequencingScore: dimensions.sequencing.score,
    momentScore: dimensions.momentUnderstanding.score,
    cohesionScore: dimensions.cohesion.score,
    plausibilityScore: dimensions.humanPlausibility.score,
    listenabilityFailures,
    deliveryTier: saveabilityDeliveryTier,
  });
  const wouldBelieveHumanMade: HumanCurationVerdict =
    dimensions.humanPlausibility.score >= 11 && dimensions.sequencing.score >= 14
      ? "YES"
      : totalScore >= 55
        ? "MAYBE"
        : "NO";
  const aiObviousness: AiObviousness =
    totalScore >= 75 && maxRun < 3
      ? "LOW"
      : totalScore >= 50
        ? "MEDIUM"
        : "HIGH";

  return {
    totalScore,
    dimensions,
    wouldPressPlay,
    wouldSave,
    saveabilityDeliveryTier,
    wouldShare,
    wouldBelieveHumanMade,
    aiObviousness,
    trackDiagnostics,
  };
}

/** Summarise benchmark run across prompts. */
export function summariseHumanCurationBenchmark(
  results: Array<{ id: string; score: HumanCurationScoreResult; trackCount: number }>,
): {
  averageScore: number;
  humanLevelCount: number;
  pressPlayYes: number;
  saveYes: number;
  shareYes: number;
  humanMadeYes: number;
  lowAiCount: number;
} {
  const n = results.length || 1;
  return {
    averageScore: Math.round(results.reduce((s, r) => s + r.score.totalScore, 0) / n),
    humanLevelCount: results.filter((r) => r.score.totalScore >= 80).length,
    pressPlayYes: results.filter((r) => r.score.wouldPressPlay === "YES").length,
    saveYes: results.filter((r) => r.score.wouldSave === "YES").length,
    shareYes: results.filter((r) => r.score.wouldShare === "YES").length,
    humanMadeYes: results.filter((r) => r.score.wouldBelieveHumanMade === "YES").length,
    lowAiCount: results.filter((r) => r.score.aiObviousness === "LOW").length,
  };
}

export { applyHumanCurationSequencing, inferHumanCurationActivity };
