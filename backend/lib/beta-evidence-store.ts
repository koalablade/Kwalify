/**
 * Append-only JSONL store for closed-beta generation evidence and feedback.
 */

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BetaEvidenceFeedback, BetaGenerationEvidence } from "./beta-generation-evidence";
import {
  buildBetaGenerationEvidence,
  isBetaEvidenceCaptureEnabled,
} from "./beta-generation-evidence";
import { hashedIdTag } from "./pii";
import type { Request } from "express";
import type { PlaylistExecutionTrace } from "../core/observability/playlist-execution-trace";
import { getGenerateObsContext } from "./generate-complete-log";

const DEFAULT_DIR = join(process.cwd(), "reports", "beta-generations");

export function betaEvidenceDir(): string {
  return (process.env.BETA_EVIDENCE_DIR ?? DEFAULT_DIR).trim() || DEFAULT_DIR;
}

export function betaEvidencePath(): string {
  return join(betaEvidenceDir(), "evidence.jsonl");
}

export function betaFeedbackPath(): string {
  return join(betaEvidenceDir(), "feedback.jsonl");
}

async function ensureDir(): Promise<void> {
  await mkdir(betaEvidenceDir(), { recursive: true });
}

export async function appendGenerationEvidence(record: BetaGenerationEvidence): Promise<void> {
  await ensureDir();
  await appendFile(betaEvidencePath(), `${JSON.stringify(record)}\n`, "utf8");
}

export async function appendEvidenceFeedback(record: BetaEvidenceFeedback): Promise<void> {
  await ensureDir();
  await appendFile(betaFeedbackPath(), `${JSON.stringify(record)}\n`, "utf8");
}

export async function readJsonl<T>(path: string): Promise<T[]> {
  try {
    const raw = await readFile(path, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw err;
  }
}

export async function findGenerationEvidence(id: string): Promise<BetaGenerationEvidence | null> {
  const rows = await readJsonl<BetaGenerationEvidence>(betaEvidencePath());
  return rows.find((row) => row.generationEvidenceId === id || row.requestId === id) ?? null;
}

export async function findFeedbackForGeneration(id: string): Promise<BetaEvidenceFeedback[]> {
  const rows = await readJsonl<BetaEvidenceFeedback>(betaFeedbackPath());
  return rows.filter((row) => row.generationEvidenceId === id || row.requestId === id);
}

export function captureGenerationEvidenceFireAndForget(record: BetaGenerationEvidence): void {
  void appendGenerationEvidence(record).catch((err) => {
    console.warn("[beta-evidence] failed to append generation evidence:", err instanceof Error ? err.message : err);
  });
}

export function appendEvidenceFeedbackFireAndForget(record: BetaEvidenceFeedback): void {
  void appendEvidenceFeedback(record).catch((err) => {
    console.warn("[beta-evidence] failed to append feedback:", err instanceof Error ? err.message : err);
  });
}

const SKIP_FAILURE_EVIDENCE_CODES = new Set([
  "NOT_AUTHENTICATED",
  "INVALID_REQUEST",
  "VIBE_REQUIRED",
  "INVALID_FEEDBACK",
]);

type ApiTrack = {
  id?: string;
  trackId?: string;
  name?: string;
  trackName?: string;
  artist?: string;
  artistName?: string;
};

export function captureBetaFailureEvidenceIfEnabled(input: {
  requestId: string;
  prompt: string;
  userTag?: string | null;
  mode?: string;
  noLibraryMode?: boolean;
  requestedTrackCount?: number;
  tracks?: ApiTrack[];
  playlistExecutionTrace?: PlaylistExecutionTrace | null;
  failureCode?: string;
}): void {
  if (!isBetaEvidenceCaptureEnabled()) return;
  const requestId = input.requestId.trim();
  const prompt = input.prompt.trim();
  if (!requestId || requestId === "unknown" || !prompt) return;
  if (input.failureCode && SKIP_FAILURE_EVIDENCE_CODES.has(input.failureCode)) return;
  captureGenerationEvidenceFireAndForget(
    buildBetaGenerationEvidence({
      requestId,
      userTag: input.userTag ?? hashedIdTag(null),
      prompt,
      mode: input.mode ?? "balanced",
      noLibraryMode: input.noLibraryMode ?? false,
      requestedTrackCount: input.requestedTrackCount ?? 0,
      tracks: input.tracks ?? [],
      playlistExecutionTrace: input.playlistExecutionTrace ?? null,
      pipelineExtras: { failureCode: input.failureCode ?? null },
    }),
  );
}

/** Resolve failure evidence from generate exit helpers (obs context + trace + extra). */
export function captureBetaFailureEvidenceFromGenerateExit(
  req: Request,
  input: {
    failureCode: string;
    trace: PlaylistExecutionTrace;
    extra?: Record<string, unknown>;
    userTag?: string | null;
    tracks?: ApiTrack[];
  },
): void {
  const obs = getGenerateObsContext(req);
  const traceRequestId = input.trace.requestId?.trim();
  const tracePrompt = input.trace.prompt?.trim();
  const requestId = String(
    input.extra?.requestId
      ?? (traceRequestId && traceRequestId !== "unknown" ? traceRequestId : undefined)
      ?? obs.requestId
      ?? "unknown",
  );
  const prompt = String(
    input.extra?.prompt
      ?? (tracePrompt ? tracePrompt : undefined)
      ?? obs.prompt
      ?? "",
  );
  captureBetaFailureEvidenceIfEnabled({
    requestId,
    prompt,
    userTag: input.userTag,
    mode: typeof input.extra?.mode === "string" ? input.extra.mode : obs.mode,
    noLibraryMode: input.extra?.noLibraryMode === true || obs.noLibraryMode === true,
    requestedTrackCount:
      typeof input.extra?.requestedTrackCount === "number"
        ? input.extra.requestedTrackCount
        : typeof obs.requestedLength === "number"
          ? obs.requestedLength
          : undefined,
    tracks: Array.isArray(input.extra?.tracks) ? (input.extra.tracks as ApiTrack[]) : input.tracks ?? [],
    playlistExecutionTrace: input.trace,
    failureCode: input.failureCode,
  });
}
