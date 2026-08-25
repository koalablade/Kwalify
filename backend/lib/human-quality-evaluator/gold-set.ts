/**
 * Persistent human-verified gold labels. Never silently overwrite.
 * Measurement only — does not modify V55.
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type HumanQaVerdict = "YES" | "MAYBE" | "NO";

export type GoldLabel = {
  requestId: string;
  prompt: string;
  benchmarkRunId: string;
  verdict: HumanQaVerdict;
  tags: string[];
  humanClass:
    | "POSITIVE_CONTROL"
    | "VAGUE_MOOD_FAILURE"
    | "CORRECT_WORLD_UNDERFILL"
    | "SEVERE_UNDERFILL_REPETITION"
    | "WRONG_WORLD"
    | "COMPOUND_FAILURE"
    | "NEGATIVE_CONSTRAINT_FAILURE"
    | "TECHNICAL_REFUSAL"
    | "EVALUATOR_FALSE_POSITIVE"
    | "EVALUATOR_BLIND_SPOT"
    | "OTHER";
  protect: boolean;
  opinion: string;
  reviewedAt: string;
};

export type GoldSet = {
  version: 1;
  updatedAt: string;
  labels: GoldLabel[];
};

/** Resolve gold-set path from repo root or backend cwd (tests often run from backend/). */
export function resolveGoldSetPath(cwd = process.cwd()): string {
  const candidates = [
    join(cwd, "backend", "data", "human-quality-gold-set.json"),
    join(cwd, "data", "human-quality-gold-set.json"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return candidates[0]!;
}

export const DEFAULT_GOLD_SET_PATH = resolveGoldSetPath();

export function emptyGoldSet(): GoldSet {
  return { version: 1, updatedAt: new Date().toISOString(), labels: [] };
}

export function loadGoldSetSync(path = resolveGoldSetPath()): GoldSet {
  if (!existsSync(path)) return emptyGoldSet();
  const raw = JSON.parse(readFileSync(path, "utf8")) as GoldSet;
  if (raw.version !== 1 || !Array.isArray(raw.labels)) return emptyGoldSet();
  return raw;
}

export async function loadGoldSet(path = resolveGoldSetPath()): Promise<GoldSet> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as GoldSet;
    if (raw.version !== 1 || !Array.isArray(raw.labels)) return emptyGoldSet();
    return raw;
  } catch {
    return emptyGoldSet();
  }
}

export function inferHumanClass(input: {
  prompt: string;
  verdict: HumanQaVerdict;
  tags: string[];
}): GoldLabel["humanClass"] {
  const tags = input.tags.map((t) => t.toLowerCase());
  if (input.verdict === "YES" && tags.includes("too short")) return "CORRECT_WORLD_UNDERFILL";
  if (input.verdict === "YES" && tags.includes("genuinely good")) return "POSITIVE_CONTROL";
  if (input.verdict === "NO" && tags.includes("repetitive") && tags.includes("too short")) {
    return "SEVERE_UNDERFILL_REPETITION";
  }
  if (input.verdict === "NO" && (tags.includes("wrong genre") || tags.includes("wrong era"))) return "WRONG_WORLD";
  if (input.verdict === "NO" && /nostalgic|vague|mood/i.test(input.prompt)) return "VAGUE_MOOD_FAILURE";
  return "OTHER";
}

/** Existing labels win. New reviews are appended only when requestId is unseen. */
export function mergeGoldSet(existing: GoldSet, incoming: GoldLabel[]): { gold: GoldSet; skipped: number; added: number } {
  const byId = new Map(existing.labels.map((l) => [l.requestId, l]));
  let skipped = 0;
  let added = 0;
  for (const label of incoming) {
    if (byId.has(label.requestId)) {
      skipped += 1;
      continue;
    }
    byId.set(label.requestId, label);
    added += 1;
  }
  return {
    gold: {
      version: 1,
      updatedAt: new Date().toISOString(),
      labels: [...byId.values()],
    },
    skipped,
    added,
  };
}

export function goldLabelFromReview(raw: Record<string, unknown>, benchmarkRunId: string): GoldLabel | null {
  const verdict = raw.verdict;
  if (verdict !== "YES" && verdict !== "MAYBE" && verdict !== "NO") return null;
  const tags = Array.isArray(raw.tags) ? raw.tags.map(String) : [];
  const prompt = String(raw.prompt ?? "");
  return {
    requestId: String(raw.requestId ?? ""),
    prompt,
    benchmarkRunId,
    verdict,
    tags,
    humanClass: inferHumanClass({ prompt, verdict, tags }),
    protect: verdict === "YES" && tags.includes("genuinely good") && !tags.includes("too short"),
    opinion: String(raw.opinion ?? ""),
    reviewedAt: String(raw.reviewedAt ?? new Date().toISOString()),
  };
}

export async function saveGoldSet(gold: GoldSet, path = resolveGoldSetPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(gold, null, 2)}\n`);
}
