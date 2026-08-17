/**
 * Automated playlist audit — composes existing evaluators as HYPOTHESES.
 * Does NOT modify generation or claim human authority.
 */

import { evaluateHumanCurationScore } from "../../core/editorial/human-curation-score";
import type { HumanCurationTrack } from "../../core/editorial/human-curation-sequencer";
import {
  parsePromptExpectation,
  verifyIndependentHumanQuality,
  type VerifierTrackInput,
} from "../../core/editorial/independent-human-quality-verifier";
import { analyzeSegments, detectTailCollapse } from "./segment-analysis";
import {
  EVALUATOR_VERSION,
  type AutomatedAuditResult,
  type ConstraintStatus,
  type FailureClass,
  type OutlierTrack,
  type PromptConstraint,
  type QualitativeBand,
  type RootCauseConfidence,
} from "./types";

export type AuditInput = {
  prompt: string;
  tracks: Array<{
    position: number;
    name: string;
    artist: string;
    album?: string | null;
    spotifyId?: string;
    releaseYear?: number | null;
    energy?: number | null;
    valence?: number | null;
    popularity?: number | null;
    acousticness?: number | null;
  }>;
  requestedCount?: number;
  deliveredCount?: number;
  /** False when requested length could not be read from the original request. */
  requestedKnown?: boolean;
  honestPartial?: boolean;
  outcome?: string;
  pipeline?: Record<string, unknown>;
};

function toHcsTrack(t: AuditInput["tracks"][number]): HumanCurationTrack {
  return {
    trackId: t.spotifyId ?? null,
    trackName: t.name,
    artistName: t.artist,
    energy: t.energy ?? null,
    valence: t.valence ?? null,
    popularity: t.popularity ?? null,
    acousticness: t.acousticness ?? null,
  };
}

function toVerifierTrack(t: AuditInput["tracks"][number]): VerifierTrackInput {
  return {
    trackName: t.name,
    artistName: t.artist,
    energy: t.energy ?? null,
    valence: t.valence ?? null,
    popularity: t.popularity ?? null,
    acousticness: t.acousticness ?? null,
    releaseYear: t.releaseYear ?? null,
  };
}

function scoreToBand(score: number, strongMin: number, mixedMin: number): QualitativeBand {
  if (score >= strongMin) return "strong";
  if (score >= mixedMin) return "mixed";
  return "weak";
}

function verifierToCoherence(verdict: string): QualitativeBand {
  if (verdict === "strong") return "strong";
  if (verdict === "mixed") return "mixed";
  return "weak";
}

function extractConstraints(prompt: string, verifierMisfits: number, trackCount: number): PromptConstraint[] {
  const exp = parsePromptExpectation(prompt);
  const constraints: PromptConstraint[] = [];

  for (const tag of exp.momentTags) {
    constraints.push({
      label: tag,
      kind: "mood",
      status: verifierMisfits / Math.max(trackCount, 1) > 0.35 ? "violated" : "partial",
      confidence: "possible",
      note: "Automated proxy via independent verifier misfit rate",
    });
  }
  for (const tag of exp.activityTags) {
    constraints.push({
      label: tag,
      kind: "activity",
      status: verifierMisfits / Math.max(trackCount, 1) > 0.35 ? "partial" : "satisfied",
      confidence: "possible",
    });
  }
  for (const tag of exp.atmosphereTags) {
    constraints.push({
      label: tag,
      kind: "atmosphere",
      status: verifierMisfits / Math.max(trackCount, 1) > 0.4 ? "violated" : "partial",
      confidence: "possible",
    });
  }
  for (const neg of exp.negations) {
    constraints.push({
      label: `not ${neg}`,
      kind: "negation",
      status: "not_measurable",
      confidence: "unknown",
      note: "Negative constraints require human review for reliable evaluation",
    });
  }
  for (const axis of exp.compoundAxes) {
    constraints.push({
      label: axis.label,
      kind: "compound",
      status: "partial",
      confidence: "possible",
      note: "Compound intent — verify with human listening",
    });
  }
  if (constraints.length === 0) {
    constraints.push({
      label: "dominant prompt intent",
      kind: "other",
      status: trackCount === 0 ? "violated" : "partial",
      confidence: "possible",
    });
  }
  return constraints;
}

function buildArtistDiversity(tracks: AuditInput["tracks"]): AutomatedAuditResult["artistDiversity"] {
  const counts = new Map<string, number>();
  for (const t of tracks) {
    const key = t.artist.trim().toLowerCase();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const repeated = [...counts.entries()]
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .map(([artist, count]) => ({ artist, count }));
  const maxPer = repeated.length > 0 ? repeated[0]!.count : counts.size > 0 ? 1 : 0;
  const suspicious = maxPer >= 4 || (tracks.length >= 15 && maxPer / tracks.length > 0.25);
  return {
    uniqueArtists: counts.size,
    maxPerArtist: maxPer,
    repeatedArtists: repeated,
    suspiciousRepetition: suspicious,
  };
}

function inferFailureClasses(input: {
  hcs: ReturnType<typeof evaluateHumanCurationScore>;
  verifier: ReturnType<typeof verifyIndependentHumanQuality>;
  underfill: AutomatedAuditResult["underfill"];
  tailCollapse: boolean;
  suspiciousRepetition: boolean;
  outcome: string;
}): AutomatedAuditResult["failureClasses"] {
  const classes: AutomatedAuditResult["failureClasses"] = [];
  const add = (cls: FailureClass, confidence: RootCauseConfidence, evidence: string) => {
    classes.push({ class: cls, confidence, evidence });
  };

  if (input.outcome === "failure") {
    add("reliability", "probable", "Generation delivered no/failed playlist");
  }
  if (input.underfill.honestPartial || input.underfill.delivered < input.underfill.requested) {
    add("underfill", "probable", `${input.underfill.delivered}/${input.underfill.requested} tracks delivered`);
  }
  if (input.verifier.compoundSummary.isCompound && input.verifier.compoundSummary.weakIntersectionShare > 0.3) {
    add("compound_intent", "possible", `Weak compound intersection share ${input.verifier.compoundSummary.weakIntersectionShare.toFixed(2)}`);
  }
  if (input.verifier.tracks.filter((t) => t.flag === "misfit").length >= 3) {
    add("world_atmosphere", "possible", `${input.verifier.tracks.filter((t) => t.flag === "misfit").length} misfit tracks (independent verifier)`);
  }
  if (input.tailCollapse) add("tail", "possible", "Tail segment misfit rate elevated vs opening");
  if (input.suspiciousRepetition) add("artist_repetition", "probable", "Suspicious artist concentration detected");
  if (input.hcs.dimensions.sequencing.score < input.hcs.dimensions.sequencing.max * 0.45) {
    add("sequencing", "possible", `Low HCS sequencing score (${input.hcs.dimensions.sequencing.score}/${input.hcs.dimensions.sequencing.max})`);
  }
  if (input.hcs.wouldSave === "NO" && input.hcs.totalScore < 55) {
    add("trust", "possible", "Automated saveability hypothesis weak — requires human validation");
  }
  return classes;
}

/** Run automated audit — output is a HYPOTHESIS until human-validated. */
export function auditPlaylistAutomated(input: AuditInput): AutomatedAuditResult {
  const tracks = input.tracks;
  const hcsTracks = tracks.map(toHcsTrack);
  const verifierTracks = tracks.map(toVerifierTrack);

  const hcs = evaluateHumanCurationScore(input.prompt, hcsTracks);
  const verifier = verifyIndependentHumanQuality(input.prompt, verifierTracks);

  const misfitPositions = new Set(
    verifier.tracks.filter((t) => t.flag === "misfit").map((t) => t.position),
  );
  const semanticByPosition = new Map(
    verifier.tracks.map((t) => [t.position, t.signals.semanticMomentFit]),
  );

  const segments = analyzeSegments(
    tracks.map((t) => ({ position: t.position, name: t.name, artist: t.artist })),
    misfitPositions,
    semanticByPosition,
  );
  const tailCollapse = detectTailCollapse(segments);

  const outliers: OutlierTrack[] = verifier.tracks
    .filter((t) => t.flag === "misfit")
    .slice(0, 8)
    .map((t) => ({
      position: t.position,
      name: t.trackName,
      artist: t.artistName,
      reasons: t.reasons,
      confidence: "probable" as RootCauseConfidence,
    }));

  const artistDiversity = buildArtistDiversity(tracks);
  const requestedKnown = input.requestedKnown !== false && input.requestedCount != null;
  const requested = input.requestedCount ?? tracks.length;
  const delivered = input.deliveredCount ?? tracks.length;
  const outcome =
    input.outcome
    ?? (delivered === 0
      ? "failure"
      : !requestedKnown
        ? "unknown_request_length"
        : delivered < requested
          ? "partial"
          : "success");

  const underfill: AutomatedAuditResult["underfill"] = {
    requested,
    delivered,
    honestPartial: input.honestPartial === true || (requestedKnown && delivered > 0 && delivered < requested),
    outcome,
    note: !requestedKnown
      ? "Requested length unknown — not treated as full success from delivered count"
      : delivered < requested && input.pipeline?.funnelCollapseStage
        ? `Pipeline funnel collapse stage: ${String(input.pipeline.funnelCollapseStage)}`
        : delivered < requested
          ? `Underfill ${delivered}/${requested} (${requested - delivered} missing)`
          : undefined,
  };

  const misfitCount = verifier.tracks.filter((t) => t.flag === "misfit").length;
  const constraints = extractConstraints(input.prompt, misfitCount, tracks.length);
  const failureClasses = inferFailureClasses({
    hcs,
    verifier,
    underfill,
    tailCollapse,
    suspiciousRepetition: artistDiversity.suspiciousRepetition,
    outcome,
  });

  const humanQuality = scoreToBand(hcs.totalScore, 72, 55);
  const momentFidelity = scoreToBand(hcs.dimensions.momentUnderstanding.score, 18, 12);
  const musicalCoherence = verifierToCoherence(verifier.playlistVerdict);
  const taste = hcs.wouldSave === "YES" ? "strong" : hcs.wouldSave === "MAYBE" ? "mixed" : "weak";
  const sequencing = scoreToBand(hcs.dimensions.sequencing.score, 14, 9);
  const reliability =
    outcome === "failure"
      ? "weak"
      : outcome === "partial" || outcome === "unknown_request_length"
        ? "mixed"
        : "strong";

  return {
    evaluatorVersion: EVALUATOR_VERSION,
    auditedAt: new Date().toISOString(),
    automatedHypothesis: {
      humanQuality,
      momentFidelity,
      musicalCoherence,
      taste,
      sequencing,
      reliability,
    },
    hcs: {
      totalScore: hcs.totalScore,
      wouldPressPlay: hcs.wouldPressPlay,
      wouldSave: hcs.wouldSave,
      wouldShare: hcs.wouldShare,
      aiObviousness: hcs.aiObviousness,
    },
    independentVerifier: {
      playlistVerdict: verifier.playlistVerdict,
      misfitCount,
      failureReasons: verifier.failureReasons.slice(0, 8),
      topRoiFailures: verifier.roiFailures.slice(0, 5).map((r) => ({
        code: r.code,
        reason: r.reason,
        impact: r.impact,
      })),
    },
    constraints,
    segments,
    outliers,
    artistDiversity,
    underfill,
    failureClasses,
    signalProvenance: {
      direct: ["track names", "artist names", "playlist length", "track order"],
      inferred: ["prompt constraints (parsePromptExpectation)", "committed world (HCS)"],
      proxy: [
        "HCS totalScore and dimension scores",
        "independent verifier misfit flags",
        "segment misfit rates",
        "artist concentration heuristics",
      ],
      unavailable: [
        "Spotify audio features when not in evidence payload",
        "reference editorial playlist comparison (not run by default)",
        "library candidate alternatives (requires full library snapshot)",
        "negative constraint satisfaction (requires human review)",
      ],
    },
  };
}

export function qualitativeBandLabel(band: QualitativeBand): string {
  switch (band) {
    case "strong":
      return "Strong";
    case "mixed":
      return "Mixed";
    case "weak":
      return "Weak";
    default:
      return "Unknown";
  }
}
