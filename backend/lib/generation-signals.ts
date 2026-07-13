/**
 * Human Expectation Layer — generation signal persistence.
 *
 * Writes one row per generation into `generation_signals`, projected from the
 * `humanExpectation` diagnostics the controller already assembled. Fire-and-
 * forget and fully defensive: a persistence failure must never affect a
 * generation response. The `user_feedback` column is left null for now and is
 * the join point for future learning (played / saved / reshuffled / regenerated).
 */

import crypto from "node:crypto";
import { db } from "../db";
import { generationSignalsTable } from "../db/schema/kwalah";
import { moduleLogger } from "./logger";

export const EXPECTATION_VERSION = "0.2.0";

const log = moduleLogger("generation-signals");

export interface GenerationSignalInput {
  generationId: string;
  prompt: string;
  userId?: string | null;
  mode: string;
  /** The `humanExpectation` diagnostics object attached to the response. */
  humanExpectation: Record<string, unknown> | null;
  candidateCount?: number | null;
  generationTimeMs?: number | null;
  publishDecision?: string | null;
  pipelineVersion?: string | null;
}

function sha(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 32);
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

export interface GenerationSignalRow {
  generationId: string;
  prompt: string;
  promptHash: string;
  userIdHash: string | null;
  mode: string;
  interpretedMoment: Record<string, unknown>;
  expectationContract: Record<string, unknown>;
  groundedConfidence: number | null;
  novelPrompt: boolean | null;
  candidateCount: number | null;
  candidatePoolAdmissibleRate: number | null;
  rerankPromotions: number;
  rerankDemotions: number;
  avgFitBefore: number | null;
  avgFitAfter: number | null;
  criticScore: number | null;
  criticVerdict: string | null;
  repairCount: number;
  failureModes: unknown[];
  publishDecision: string | null;
  generationTimeMs: number | null;
  pipelineVersion: string;
  expectationVersion: string;
  shadowOrEnforce: string;
  userFeedback: null;
}

/**
 * Pure projection from the `humanExpectation` diagnostics to a persistable row.
 * Kept separate from the DB insert so it can be unit-tested without a database.
 */
export function projectGenerationSignalRow(input: GenerationSignalInput): GenerationSignalRow {
  const hx = obj(input.humanExpectation);
  const critique = obj(hx["critique"]);
  const rerank = obj(hx["retrievalRerank"]);
  const pool = obj(rerank["pool"]);
  const interp = obj(hx["interpretedMoment"]);
  const candidates = Array.isArray(interp["candidates"]) ? (interp["candidates"] as unknown[]) : [];
  const topCandidate = obj(candidates[0]);
  const repair = obj(hx["repair"]);
  const risks = Array.isArray(hx["detectedRisks"]) ? (hx["detectedRisks"] as unknown[]) : [];
  const promoted = Array.isArray(rerank["promoted"]) ? (rerank["promoted"] as unknown[]) : [];
  const demoted = Array.isArray(rerank["demoted"]) ? (rerank["demoted"] as unknown[]) : [];

  return {
    generationId: input.generationId,
    prompt: input.prompt,
    promptHash: sha(input.prompt.trim().toLowerCase()),
    userIdHash: input.userId ? sha(input.userId) : null,
    mode: input.mode,
    interpretedMoment: interp,
    expectationContract: obj(hx["expectedAtmosphere"]),
    groundedConfidence: num(topCandidate["confidence"]),
    novelPrompt: typeof interp["novelPrompt"] === "boolean" ? (interp["novelPrompt"] as boolean) : null,
    candidateCount: num(input.candidateCount) ?? num(pool["size"]),
    candidatePoolAdmissibleRate: num(pool["admissibleRate"]),
    rerankPromotions: promoted.length,
    rerankDemotions: demoted.length,
    avgFitBefore: num(rerank["avgAdmissibilityBefore"]),
    avgFitAfter: num(rerank["avgAdmissibilityAfter"]),
    criticScore: num(critique["overallFit"]),
    criticVerdict: str(critique["verdict"]),
    repairCount: num(repair["removed"]) ?? 0,
    failureModes: risks,
    publishDecision: input.publishDecision ?? str(critique["verdict"]),
    generationTimeMs: num(input.generationTimeMs),
    pipelineVersion: input.pipelineVersion ?? process.env["GIT_COMMIT"] ?? "unknown",
    expectationVersion: EXPECTATION_VERSION,
    shadowOrEnforce: input.mode,
    userFeedback: null,
  };
}

export async function persistGenerationSignal(input: GenerationSignalInput): Promise<void> {
  try {
    await db.insert(generationSignalsTable).values(projectGenerationSignalRow(input));
  } catch (err) {
    log.warn({ err }, "generation_signal_persist_failed");
  }
}
