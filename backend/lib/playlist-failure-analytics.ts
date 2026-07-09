/**
 * Playlist Failure Analytics — record where liked-library generation falls short
 * and how users respond (Discovery Mode, regenerate, abandon).
 */

import { createHash } from "node:crypto";
import { desc, eq, gte, and } from "drizzle-orm";
import { db, playlistFailureEventsTable } from "../db";
import { resolveActivityProfile } from "./activity-profiles";
import { logger } from "./logger";
import type { LibraryCapability } from "./playlist-retrieval-orchestrator";
import type { OrchestratorDiagnostics } from "./playlist-retrieval-orchestrator";

export type PromptCategory =
  | "gym"
  | "focus"
  | "study"
  | "party"
  | "driving"
  | "chill"
  | "general";

export type FailureEventType =
  | "library_insufficient"
  | "liked_only_success"
  | "discovery_success";

export type FailureUserOutcome =
  | "discovery_accepted"
  | "discovery_rejected"
  | "regenerated"
  | "abandoned";

export type FailureAnalyticsRecordInput = {
  sessionId: string;
  userId?: string | null;
  eventType: FailureEventType;
  vibe: string;
  activity?: string | null;
  sceneId?: string | null;
  libraryCapability?: LibraryCapability | null;
  orchestrator?: OrchestratorDiagnostics | null;
  linkedSessionId?: string | null;
  userOutcome?: FailureUserOutcome | null;
};

export type FailureCategoryReport = {
  category: PromptCategory;
  likedOnlyAttempts: number;
  likedOnlySuccesses: number;
  likedOnlySuccessRate: number | null;
  libraryInsufficientFailures: number;
  discoverySuccesses: number;
  discoveryRequestedRate: number | null;
  outcomesResolved: number;
  discoveryAccepted: number;
  discoveryRejected: number;
  discoveryAcceptedRate: number | null;
  discoveryRejectedRate: number | null;
  regenerated: number;
  abandoned: number;
  pendingOutcome: number;
  topLimitingFactors: Array<{ factor: string; count: number; label: string }>;
};

export type FailureAnalyticsReport = {
  generatedAt: string;
  periodDays: number;
  totalEvents: number;
  byCategory: FailureCategoryReport[];
  globalTopLimitingFactors: Array<{ factor: string; count: number; label: string }>;
};

const LIMITING_FACTOR_LABELS: Record<string, string> = {
  library_too_small: "Library too small",
  low_activity_match: "Low activity match in liked songs",
  genre_gap: "Genre gap vs prompt",
  energy_distribution_mismatch: "Energy distribution mismatch",
  weak_opening_candidates: "Weak opening candidates",
  low_genre_diversity: "Low genre diversity",
  weak_candidate_pool: "Weak post-retrieval candidate pool",
  weak_opener_confidence: "Low opener confidence",
};

export function hashPromptForAnalytics(prompt: string): string {
  const normalized = prompt.trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
  }
  return `p${Math.abs(hash).toString(36)}`;
}

export function hashUserIdForAnalytics(userId: string | null | undefined): string | null {
  if (!userId) return null;
  const salt = process.env.ANALYTICS_USER_SALT?.trim() || "kwalify-failure-analytics";
  return createHash("sha256").update(`${salt}:${userId}`).digest("hex").slice(0, 32);
}

export function classifyPromptCategory(vibe: string, activity?: string | null): PromptCategory {
  const profile = resolveActivityProfile(vibe, { activity: activity ?? null });
  if (profile) {
    if (profile.id === "focus_coding") return "focus";
    if (profile.id === "study") return "study";
    if (profile.id === "gym") return "gym";
    if (profile.id === "party_pregame") return "party";
  }
  if (/\b(?:driv|road\s*trip|commute|motorway|highway)\b/i.test(vibe) || activity === "driving") {
    return "driving";
  }
  if (/\b(?:chill|relax|calm|cozy|soft|sleep)\b/i.test(vibe)) return "chill";
  return "general";
}

function limitingFactorLabel(factor: string): string {
  return LIMITING_FACTOR_LABELS[factor] ?? factor.replace(/_/g, " ");
}

function buildRecordValues(input: FailureAnalyticsRecordInput) {
  const category = classifyPromptCategory(input.vibe, input.activity);
  const capability = input.libraryCapability ?? input.orchestrator?.libraryCapability ?? null;
  const activityProfile = resolveActivityProfile(input.vibe, { activity: input.activity ?? null });
  return {
    sessionId: input.sessionId,
    userIdHash: hashUserIdForAnalytics(input.userId),
    eventType: input.eventType,
    promptCategory: category,
    activity: activityProfile?.id ?? input.activity ?? null,
    sceneId: input.sceneId ?? null,
    promptHash: hashPromptForAnalytics(input.vibe),
    capabilityScore: capability?.score ?? null,
    limitingFactors: capability?.limitingFactors ?? [],
    retrievalStrategy: input.orchestrator?.strategy ?? null,
    candidateQualityScore: input.orchestrator?.candidateSufficiency?.score ?? null,
    combinedConfidence: input.orchestrator?.combinedConfidence ?? capability?.score ?? null,
    userOutcome: input.userOutcome ?? null,
    linkedSessionId: input.linkedSessionId ?? null,
    outcomeRecordedAt: input.userOutcome ? new Date() : null,
  };
}

export function recordPlaylistFailureEvent(input: FailureAnalyticsRecordInput): void {
  void (async () => {
    try {
      await db
        .insert(playlistFailureEventsTable)
        .values(buildRecordValues(input))
        .onConflictDoNothing({ target: playlistFailureEventsTable.sessionId });
    } catch (err) {
      logger.warn({ err, sessionId: input.sessionId }, "Failed to record playlist failure analytics event");
    }
  })();
}

export async function updateFailureOutcome(
  failureSessionId: string,
  outcome: FailureUserOutcome,
  linkedSessionId?: string | null,
): Promise<boolean> {
  try {
    const rows = await db
      .update(playlistFailureEventsTable)
      .set({
        userOutcome: outcome,
        linkedSessionId: linkedSessionId ?? null,
        outcomeRecordedAt: new Date(),
      })
      .where(and(
        eq(playlistFailureEventsTable.sessionId, failureSessionId),
        eq(playlistFailureEventsTable.eventType, "library_insufficient"),
      ))
      .returning({ id: playlistFailureEventsTable.id });
    return rows.length > 0;
  } catch (err) {
    logger.warn({ err, failureSessionId, outcome }, "Failed to update playlist failure outcome");
    return false;
  }
}

export async function recordFailureOutcome(
  failureSessionId: string,
  outcome: FailureUserOutcome,
  linkedSessionId?: string | null,
): Promise<{ updated: boolean }> {
  const updated = await updateFailureOutcome(failureSessionId, outcome, linkedSessionId);
  return { updated };
}

export function handleGenerationFollowUp(opts: {
  failureSessionId?: string | null;
  noLibraryMode: boolean;
  newSessionId: string;
  userId?: string | null;
}): void {
  const prior = opts.failureSessionId?.trim();
  if (!prior || opts.noLibraryMode) return;
  void updateFailureOutcome(prior, "regenerated", opts.newSessionId);
}

export function recordLibraryInsufficientFailure(opts: {
  sessionId: string;
  userId?: string | null;
  vibe: string;
  activity?: string | null;
  sceneId?: string | null;
  libraryCapability: LibraryCapability;
  orchestrator?: OrchestratorDiagnostics | null;
}): void {
  recordPlaylistFailureEvent({
    sessionId: opts.sessionId,
    userId: opts.userId,
    eventType: "library_insufficient",
    vibe: opts.vibe,
    activity: opts.activity,
    sceneId: opts.sceneId,
    libraryCapability: opts.libraryCapability,
    orchestrator: opts.orchestrator ?? null,
  });
}

export function recordLikedOnlySuccess(opts: {
  sessionId: string;
  userId?: string | null;
  vibe: string;
  activity?: string | null;
  sceneId?: string | null;
  orchestrator?: OrchestratorDiagnostics | null;
}): void {
  recordPlaylistFailureEvent({
    sessionId: opts.sessionId,
    userId: opts.userId,
    eventType: "liked_only_success",
    vibe: opts.vibe,
    activity: opts.activity,
    sceneId: opts.sceneId,
    orchestrator: opts.orchestrator ?? null,
  });
}

export function recordDiscoverySuccess(opts: {
  sessionId: string;
  userId?: string | null;
  vibe: string;
  activity?: string | null;
  sceneId?: string | null;
  linkedFailureSessionId?: string | null;
  orchestrator?: OrchestratorDiagnostics | null;
}): void {
  if (opts.linkedFailureSessionId) {
    void updateFailureOutcome(opts.linkedFailureSessionId, "discovery_accepted", opts.sessionId);
  }
  recordPlaylistFailureEvent({
    sessionId: opts.sessionId,
    userId: opts.userId,
    eventType: "discovery_success",
    vibe: opts.vibe,
    activity: opts.activity,
    sceneId: opts.sceneId,
    orchestrator: opts.orchestrator ?? null,
    linkedSessionId: opts.linkedFailureSessionId ?? null,
  });
}

function aggregateLimitingFactors(
  rows: Array<{ limitingFactors: unknown }>,
): Array<{ factor: string; count: number; label: string }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const factors = Array.isArray(row.limitingFactors) ? row.limitingFactors : [];
    for (const factor of factors) {
      if (typeof factor !== "string") continue;
      counts.set(factor, (counts.get(factor) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([factor, count]) => ({ factor, count, label: limitingFactorLabel(factor) }));
}

export function buildCategoryReport(
  category: PromptCategory,
  rows: Array<typeof playlistFailureEventsTable.$inferSelect>,
): FailureCategoryReport {
  const likedOnlySuccesses = rows.filter((r) => r.eventType === "liked_only_success").length;
  const libraryInsufficientFailures = rows.filter((r) => r.eventType === "library_insufficient").length;
  const discoverySuccesses = rows.filter((r) => r.eventType === "discovery_success").length;
  const likedOnlyAttempts = likedOnlySuccesses + libraryInsufficientFailures;

  const failureRows = rows.filter((r) => r.eventType === "library_insufficient");
  const discoveryAccepted = failureRows.filter((r) => r.userOutcome === "discovery_accepted").length;
  const discoveryRejected = failureRows.filter((r) => r.userOutcome === "discovery_rejected").length;
  const regenerated = failureRows.filter((r) => r.userOutcome === "regenerated").length;
  const abandoned = failureRows.filter((r) => r.userOutcome === "abandoned").length;
  const pendingOutcome = failureRows.filter((r) => !r.userOutcome).length;
  const outcomesResolved = discoveryAccepted + discoveryRejected + regenerated + abandoned;

  const discoveryDecisions = discoveryAccepted + discoveryRejected;

  return {
    category,
    likedOnlyAttempts,
    likedOnlySuccesses,
    likedOnlySuccessRate: likedOnlyAttempts > 0 ? likedOnlySuccesses / likedOnlyAttempts : null,
    libraryInsufficientFailures,
    discoverySuccesses,
    discoveryRequestedRate: likedOnlyAttempts + discoverySuccesses > 0
      ? discoverySuccesses / (likedOnlyAttempts + discoverySuccesses)
      : null,
    outcomesResolved,
    discoveryAccepted,
    discoveryRejected,
    discoveryAcceptedRate: discoveryDecisions > 0 ? discoveryAccepted / discoveryDecisions : null,
    discoveryRejectedRate: discoveryDecisions > 0 ? discoveryRejected / discoveryDecisions : null,
    regenerated,
    abandoned,
    pendingOutcome,
    topLimitingFactors: aggregateLimitingFactors(failureRows),
  };
}

export async function buildFailureAnalyticsReport(
  opts?: { days?: number },
): Promise<FailureAnalyticsReport> {
  const days = opts?.days ?? 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await db
    .select()
    .from(playlistFailureEventsTable)
    .where(gte(playlistFailureEventsTable.createdAt, since))
    .orderBy(desc(playlistFailureEventsTable.createdAt));

  const categories: PromptCategory[] = ["gym", "focus", "study", "party", "driving", "chill", "general"];
  const byCategory = categories
    .map((category) => buildCategoryReport(category, rows.filter((r) => r.promptCategory === category)))
    .filter((report) => report.likedOnlyAttempts > 0 || report.discoverySuccesses > 0);

  const failureRows = rows.filter((r) => r.eventType === "library_insufficient");

  return {
    generatedAt: new Date().toISOString(),
    periodDays: days,
    totalEvents: rows.length,
    byCategory,
    globalTopLimitingFactors: aggregateLimitingFactors(failureRows),
  };
}

export function formatFailureAnalyticsReportMarkdown(report: FailureAnalyticsReport): string {
  const lines = [
    "# Playlist Failure Analytics",
    "",
    `Generated: ${report.generatedAt}`,
    `Period: last ${report.periodDays} days`,
    `Total events: ${report.totalEvents}`,
    "",
  ];

  if (report.globalTopLimitingFactors.length > 0) {
    lines.push("## Global limiting factors");
    for (const row of report.globalTopLimitingFactors) {
      lines.push(`- ${row.label}: ${row.count}`);
    }
    lines.push("");
  }

  for (const cat of report.byCategory) {
    lines.push(`## ${cat.category.charAt(0).toUpperCase()}${cat.category.slice(1)}`);
    lines.push("");
    lines.push(`- Liked-only success: ${cat.likedOnlySuccessRate != null ? `${(cat.likedOnlySuccessRate * 100).toFixed(0)}%` : "n/a"} (${cat.likedOnlySuccesses}/${cat.likedOnlyAttempts})`);
    lines.push(`- Library insufficient failures: ${cat.libraryInsufficientFailures}`);
    if (cat.discoveryRequestedRate != null) {
      lines.push(`- Discovery requested: ${(cat.discoveryRequestedRate * 100).toFixed(0)}%`);
    }
    if (cat.discoveryAccepted + cat.discoveryRejected > 0) {
      lines.push(`- Discovery accepted: ${cat.discoveryAcceptedRate != null ? `${(cat.discoveryAcceptedRate * 100).toFixed(0)}%` : "n/a"}`);
      lines.push(`- Discovery rejected: ${cat.discoveryRejectedRate != null ? `${(cat.discoveryRejectedRate * 100).toFixed(0)}%` : "n/a"}`);
    }
    lines.push(`- Regenerated (liked-only retry): ${cat.regenerated}`);
    lines.push(`- Abandoned: ${cat.abandoned}`);
    lines.push(`- Pending outcome: ${cat.pendingOutcome}`);
    if (cat.topLimitingFactors.length > 0) {
      lines.push(`- Most common limiting factor: ${cat.topLimitingFactors[0]!.label} (${cat.topLimitingFactors[0]!.count})`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export async function listRecentFailureEvents(limit = 50): Promise<Array<typeof playlistFailureEventsTable.$inferSelect>> {
  return db
    .select()
    .from(playlistFailureEventsTable)
    .orderBy(desc(playlistFailureEventsTable.createdAt))
    .limit(limit);
}
