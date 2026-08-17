/**
 * Human review workflow — JSON template + markdown for lightweight review.
 */

import type { EvaluatedPlaylist, HumanReviewRubric } from "./types";

export function humanReviewTemplate(playlist: EvaluatedPlaylist): HumanReviewRubric & { requestId: string; prompt: string } {
  return {
    requestId: playlist.requestId,
    prompt: playlist.prompt,
    humanSaveability: 0,
    momentFidelity: 0,
    musicalCoherence: 0,
    tasteFit: 0,
    openingQuality: 0,
    tailQuality: 0,
    discoveryQuality: 0,
    replayability: 0,
    overallHumanQuality: 0,
    wouldPressPlay: null,
    wouldKeepListening: null,
    wouldSave: null,
    obviousBadTracks: null,
    opinion: "",
    reviewerId: null,
    reviewedAt: new Date().toISOString(),
  };
}

export function formatHumanReviewMarkdown(playlist: EvaluatedPlaylist): string {
  const lines: string[] = [
    "# Human playlist review",
    "",
    `Request ID: ${playlist.requestId}`,
    `Prompt: ${playlist.prompt}`,
    `Commit: ${playlist.commit ?? "unknown"}`,
    "",
    "## Tracks",
  ];
  for (const t of playlist.tracks.slice(0, 30)) {
    lines.push(`${t.position}. ${t.name} — ${t.artist}`);
  }
  if (playlist.tracks.length > 30) lines.push(`... +${playlist.tracks.length - 30} more`);
  lines.push(
    "",
    "## Automated hypothesis (NOT authoritative)",
    `Human quality: ${playlist.automated.automatedHypothesis.humanQuality}`,
    `HCS: ${playlist.automated.hcs.totalScore} (wouldSave: ${playlist.automated.hcs.wouldSave})`,
    `Independent verifier: ${playlist.automated.independentVerifier.playlistVerdict}`,
    "",
    "## Reviewer questions",
    "1. Would I press play?",
    "2. Would I keep listening?",
    "3. Would I save it?",
    "4. Does it feel like the requested moment?",
    "5. Does it feel musically coherent?",
    "6. Are there obvious bad tracks?",
    "7. Does the ending remain good?",
    "8. Would I want another version?",
    "",
    "## Rubric (0–5 each)",
    "Fill in human-review JSON and save to reports/human-quality-reviews/",
    "",
  );
  return lines.join("\n");
}

export function parseHumanReviewJson(raw: Record<string, unknown>): HumanReviewRubric {
  const num = (k: string) => {
    const v = raw[k];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  };
  return {
    humanSaveability: num("humanSaveability"),
    momentFidelity: num("momentFidelity"),
    musicalCoherence: num("musicalCoherence"),
    tasteFit: num("tasteFit"),
    openingQuality: num("openingQuality"),
    tailQuality: num("tailQuality"),
    discoveryQuality: num("discoveryQuality"),
    replayability: num("replayability"),
    overallHumanQuality: num("overallHumanQuality"),
    opinion: typeof raw.opinion === "string" ? raw.opinion : null,
    wouldPressPlay: typeof raw.wouldPressPlay === "boolean" ? raw.wouldPressPlay : null,
    wouldKeepListening: typeof raw.wouldKeepListening === "boolean" ? raw.wouldKeepListening : null,
    wouldSave: typeof raw.wouldSave === "boolean" ? raw.wouldSave : null,
    obviousBadTracks: typeof raw.obviousBadTracks === "string" ? raw.obviousBadTracks : null,
    reviewerId: typeof raw.reviewerId === "string" ? raw.reviewerId : null,
    reviewedAt: typeof raw.reviewedAt === "string" ? raw.reviewedAt : new Date().toISOString(),
  };
}
