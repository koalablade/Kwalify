/**
 * Unknown-term harvesting — stores weak/unrecognized prompt signals for
 * later alias and scene-mapping review.
 */

import type pg from "pg";
import { db, unknownTermEventsTable } from "../db";
import type { IntentUnderstandingDiagnostics } from "./intent-understanding-diagnostics";
import { logger } from "./logger";

const HARVEST_CONFIDENCE_THRESHOLD = 0.72;

export type UnknownTermHarvestPayload = {
  userId?: string | null;
  prompt: string;
  intentUnderstanding: IntentUnderstandingDiagnostics;
  playlistConfidence?: number | null;
  overallCoherence?: number | null;
  inferredScene?: string | null;
};

export function shouldHarvestUnknownTerms(intent: IntentUnderstandingDiagnostics): boolean {
  return (
    intent.unrecognizedTerms.length > 0 ||
    intent.confidence < HARVEST_CONFIDENCE_THRESHOLD ||
    intent.weakMatch
  );
}

export function recordUnknownTermEvents(payload: UnknownTermHarvestPayload): void {
  if (!shouldHarvestUnknownTerms(payload.intentUnderstanding)) return;

  const terms = payload.intentUnderstanding.unrecognizedTerms.length > 0
    ? payload.intentUnderstanding.unrecognizedTerms
    : ["__low_confidence_prompt__"];

  const context = {
    recognizedConcepts: payload.intentUnderstanding.recognizedConcepts,
    assumptions: payload.intentUnderstanding.assumptions,
    scenePrediction: payload.intentUnderstanding.scenePrediction,
    confidence: payload.intentUnderstanding.confidence,
    playlistConfidence: payload.playlistConfidence ?? null,
    overallCoherence: payload.overallCoherence ?? null,
    weakMatch: payload.intentUnderstanding.weakMatch,
    primaryCluster: payload.intentUnderstanding.primaryCluster,
    inferredScene: payload.inferredScene ?? null,
  };

  void (async () => {
    try {
      const rows = terms.map((term) => ({
        userId: payload.userId ?? null,
        term: term.slice(0, 120),
        prompt: payload.prompt.slice(0, 2000),
        promptHash: hashPrompt(payload.prompt),
        context,
      }));
      if (rows.length > 0) {
        await db.insert(unknownTermEventsTable).values(rows);
      }
    } catch (err) {
      logger.warn({ err }, "Failed to record unknown term harvest events");
    }
  })();
}

function hashPrompt(prompt: string): string {
  let hash = 0;
  const normalized = prompt.trim().toLowerCase();
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
  }
  return `p${Math.abs(hash).toString(36)}`;
}

export type UnknownTokenReport = {
  token: string;
  frequency: number;
  contextPrompt: string;
  weakMapping: string | null;
};

export type HarvestedTermSummary = {
  term: string;
  occurrences: number;
  uniquePrompts: number;
  avgConfidence: number;
  lastSeen: string;
  samplePrompts: string[];
};

export async function summarizeHarvestedTerms(
  rawPool: pg.Pool,
  opts?: {
  days?: number;
  minOccurrences?: number;
  limit?: number;
},
): Promise<HarvestedTermSummary[]> {
  const days = opts?.days ?? 30;
  const minOccurrences = opts?.minOccurrences ?? 2;
  const limit = opts?.limit ?? 50;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const result = await rawPool.query(
    `SELECT
      term,
      COUNT(*)::text AS occurrences,
      COUNT(DISTINCT prompt_hash)::text AS unique_prompts,
      AVG((context->>'confidence')::float)::text AS avg_confidence,
      MAX(created_at) AS last_seen,
      (ARRAY_AGG(prompt ORDER BY created_at DESC))[1:3] AS sample_prompts
    FROM unknown_term_events
    WHERE created_at >= $1
      AND term <> '__low_confidence_prompt__'
    GROUP BY term
    HAVING COUNT(*) >= $2
    ORDER BY COUNT(*) DESC, MAX(created_at) DESC
    LIMIT $3`,
    [since, minOccurrences, limit],
  );

  return result.rows.map((row: {
    term: string;
    occurrences: string;
    unique_prompts: string;
    avg_confidence: string | null;
    last_seen: Date;
    sample_prompts: string[] | null;
  }) => ({
    term: row.term,
    occurrences: Number(row.occurrences),
    uniquePrompts: Number(row.unique_prompts),
    avgConfidence: row.avg_confidence ? Number(row.avg_confidence) : 0,
    lastSeen: row.last_seen.toISOString(),
    samplePrompts: row.sample_prompts ?? [],
  }));
}
