/**
 * Ingest beta evidence + feedback and run automated audit.
 */

import type { BetaEvidenceFeedback, BetaGenerationEvidence } from "../beta-generation-evidence";
import { readJsonl } from "../beta-evidence-store";
import { betaEvidencePath, betaFeedbackPath } from "../beta-evidence-store";
import { auditPlaylistAutomated } from "./automated-audit";
import { calibrateAutomatedVsHuman } from "./calibration";
import type { EvaluatedPlaylist, HumanReviewRubric } from "./types";

function mapTracks(record: BetaGenerationEvidence): EvaluatedPlaylist["tracks"] {
  return record.tracks.map((t) => ({
    position: t.position,
    name: t.name,
    artist: t.artists[0] ?? "",
    album: t.album,
    spotifyId: t.spotifyId,
    releaseYear: t.releaseYear,
  }));
}

function feedbackToHumanReview(fb: BetaEvidenceFeedback): HumanReviewRubric | null {
  const ratings = fb.ratings ?? {};
  const hasNumeric =
    typeof ratings.overallHumanQuality === "number"
    || typeof ratings.humanSaveability === "number";
  const hasVerdict = fb.verdict != null || fb.opinion;

  if (!hasNumeric && !hasVerdict) return null;

  const verdictToScore = (v: string | null | undefined): number | null => {
    if (v === "good") return 4;
    if (v === "mixed") return 2.5;
    if (v === "bad") return 1;
    return null;
  };

  const base = verdictToScore(fb.verdict ?? null) ?? 2.5;

  return {
    humanSaveability: Number(ratings.humanSaveability ?? base),
    momentFidelity: Number(ratings.momentFidelity ?? base),
    musicalCoherence: Number(ratings.musicalCoherence ?? base),
    tasteFit: Number(ratings.tasteFit ?? base),
    openingQuality: Number(ratings.openingQuality ?? base),
    tailQuality: Number(ratings.tailQuality ?? base),
    discoveryQuality: Number(ratings.discoveryQuality ?? base),
    replayability: Number(ratings.replayability ?? base),
    overallHumanQuality: Number(ratings.overallHumanQuality ?? base),
    opinion: fb.opinion ?? null,
    reviewerId: fb.testerId ?? null,
    reviewedAt: fb.recordedAt,
  };
}

export async function loadBetaEvidenceRecords(): Promise<BetaGenerationEvidence[]> {
  return readJsonl<BetaGenerationEvidence>(betaEvidencePath());
}

export async function loadBetaFeedbackRecords(): Promise<BetaEvidenceFeedback[]> {
  return readJsonl<BetaEvidenceFeedback>(betaFeedbackPath());
}

export function evaluateFromBetaEvidence(
  record: BetaGenerationEvidence,
  feedback: BetaEvidenceFeedback | null,
  humanReview?: HumanReviewRubric | null,
): EvaluatedPlaylist {
  const tracks = mapTracks(record);
  const automated = auditPlaylistAutomated({
    prompt: record.prompt.raw,
    tracks,
    requestedCount: record.playlist.requestedTrackCount,
    deliveredCount: record.playlist.deliveredTrackCount,
    honestPartial: record.playlist.honestPartial,
    outcome: record.playlist.outcome,
    pipeline: record.pipeline,
  });

  const human =
    humanReview
    ?? (feedback ? feedbackToHumanReview(feedback) : null);

  return {
    source: "beta_evidence",
    requestId: record.requestId,
    prompt: record.prompt.raw,
    commit: record.kwalify.commit,
    capturedAt: record.capturedAt,
    mode: record.prompt.mode,
    interpretation: record.interpretation,
    pipeline: record.pipeline,
    tracks,
    userFeedback: feedback
      ? {
          verdict: feedback.verdict ?? null,
          opinion: feedback.opinion ?? null,
          reasons: feedback.reasons ?? [],
        }
      : null,
    automated,
    humanReview: human,
    calibration: calibrateAutomatedVsHuman(automated, human),
  };
}

export async function evaluateAllBetaEvidence(): Promise<EvaluatedPlaylist[]> {
  const generations = await loadBetaEvidenceRecords();
  const feedbackRows = await loadBetaFeedbackRecords();
  const feedbackById = new Map<string, BetaEvidenceFeedback>();
  for (const fb of feedbackRows) {
    feedbackById.set(fb.requestId, fb);
  }
  return generations.map((g) =>
    evaluateFromBetaEvidence(g, feedbackById.get(g.requestId) ?? null),
  );
}

export type ApiResponseEvalOptions = {
  /** Original requested playlist length. Never infer this from delivered track count. */
  requestedCount?: number;
};

/**
 * Resolve requested length from the original request, never from delivered tracks.
 * API `length` is only used when it disagrees with delivered count (legacy fixture).
 */
export function resolveRequestedTrackCount(
  data: Record<string, unknown>,
  delivered: number,
  override?: number,
): { requested: number; known: boolean } {
  if (typeof override === "number" && Number.isFinite(override) && override > 0) {
    return { requested: override, known: true };
  }
  const explicit = data.requestedLength ?? data.requestedTrackCount;
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) {
    return { requested: explicit, known: true };
  }
  const len = data.length;
  if (typeof len === "number" && Number.isFinite(len) && len > 0 && len !== delivered) {
    return { requested: len, known: true };
  }
  return { requested: delivered, known: false };
}

function pipelineFromApiResponse(data: Record<string, unknown>): Record<string, unknown> {
  const trace = (data.playlistExecutionTrace as Record<string, unknown> | undefined) ?? {};
  return {
    ...trace,
    ...(data.candidateFunnel ? { candidateFunnel: data.candidateFunnel } : {}),
    ...(data.deliveryLossFunnel ? { deliveryLossFunnel: data.deliveryLossFunnel } : {}),
    ...(data.retrievalFunnel ? { retrievalFunnel: data.retrievalFunnel } : {}),
    ...(data.puritySubFunnel ? { puritySubFunnel: data.puritySubFunnel } : {}),
  };
}

export function evaluateFromApiResponse(
  data: Record<string, unknown>,
  options?: ApiResponseEvalOptions,
): EvaluatedPlaylist {
  const requestId = String(data.requestId ?? data.generationEvidenceId ?? "unknown");
  const prompt = String(data.vibe ?? data.prompt ?? "");
  const rawTracks = Array.isArray(data.tracks) ? data.tracks : [];
  const tracks = rawTracks.map((t: Record<string, unknown>, i: number) => ({
    position: i + 1,
    name: String(t.name ?? t.trackName ?? ""),
    artist: String(t.artist ?? t.artistName ?? ""),
    album: (t.album ?? t.albumName ?? null) as string | null,
    spotifyId: String(t.id ?? t.trackId ?? ""),
    releaseYear: typeof t.releaseYear === "number" ? t.releaseYear : null,
    energy: typeof t.energy === "number" ? t.energy : null,
    valence: typeof t.valence === "number" ? t.valence : null,
    popularity: typeof t.popularity === "number" ? t.popularity : null,
    acousticness: typeof t.acousticness === "number" ? t.acousticness : null,
  })).filter((t) => t.name);

  const delivered = tracks.length;
  const { requested, known } = resolveRequestedTrackCount(data, delivered, options?.requestedCount);
  const pipeline = pipelineFromApiResponse(data);
  const automated = auditPlaylistAutomated({
    prompt,
    tracks,
    requestedCount: requested,
    deliveredCount: delivered,
    requestedKnown: known,
    honestPartial: Boolean(data.honestPartialPublished) || (known && delivered > 0 && delivered < requested),
    outcome: delivered === 0 ? "failure" : !known ? "unknown_request_length" : delivered < requested ? "partial" : "success",
    pipeline,
  });

  return {
    source: "api_response",
    requestId,
    prompt,
    commit: typeof data.commit === "string" ? data.commit : null,
    capturedAt: null,
    mode: typeof data.mode === "string" ? data.mode : null,
    interpretation: {
      sceneId: data.sceneId ?? null,
      humanNarrative: data.humanNarrative ?? null,
      matchQualityLabel: data.matchQualityLabel ?? null,
    },
    pipeline,
    tracks,
    userFeedback: null,
    automated,
    humanReview: null,
    calibration: { agreement: "no_human" },
  };
}
