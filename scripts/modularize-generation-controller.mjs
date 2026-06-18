/**
 * Split generation.controller.ts into maintainability modules.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const controllerPath = path.join(root, "backend/controllers/generation.controller.ts");
const src = readFileSync(controllerPath, "utf8");
const lines = src.split(/\r?\n/);

function slice(start, end) {
  return lines.slice(start - 1, end).join("\n");
}

function exportify(body) {
  return body.replace(/^function /gm, "export function ");
}

const genDir = path.join(root, "backend/controllers/generation");
mkdirSync(genDir, { recursive: true });

writeFileSync(
  path.join(genDir, "generation-types.ts"),
  `/** Shared generation controller types and constants. */
import type { EmotionProfile } from "../../lib/emotion";
import type { V3MetadataTrack } from "../../lib/v3-track-contract";

${slice(199, 232)
  .replace(/^type /gm, "export type ")
  .replace(/^const EXECUTION_HEALTH_BASELINE_SIZE/gm, "export const EXECUTION_HEALTH_BASELINE_SIZE")}

export type GenerateSessionSnapshot = import("../../core/cache/session-snapshot-cache").SessionSnapshot<
  import("../../db").likedSongsTable["$inferSelect"],
  import("../../db").playlistHistoryTable["$inferSelect"],
  import("../../lib/feedback-memory").FeedbackMemory
>;

${slice(257, 288)
  .replace(/^type /gm, "export type ")
  .replace(/^const PRODUCTION/gm, "export const PRODUCTION")
  .replace(/^const AUDIT/gm, "export const AUDIT")}

export const NEUTRAL_PROFILE: EmotionProfile = {
  energy: 0.5,
  valence: 0.5,
  tension: 0.3,
  nostalgia: 0.2,
  calm: 0.5,
  environment: null,
  timeOfDay: null,
  motionState: null,
};

${slice(436, 608).replace(/^type /gm, "export type ")}
`,
);

writeFileSync(
  path.join(genDir, "generation-timing.ts"),
  `/** Pre-V3 timing, production timeline, and live stage profiling. */
import type { Request } from "express";
import type {
  DbSessionLoadStageName,
  DbSessionLoadStageRecord,
  PreV3PerformanceReport,
  PreV3StageName,
  PreV3StageRecord,
  PreV3TimingBreakdown,
  ProductionTimeline,
  ProductionTimelineStage,
} from "./generation-types";

${exportify(slice(610, 939))}
`,
);

writeFileSync(
  path.join(genDir, "generation-execution-health.ts"),
  `/** Execution health profiling for duplicate-stage detection. */
import type { Request } from "express";
import type {
  ExecutionHealthBaselineEntry,
  ExecutionHealthCause,
  ExecutionHealthProfile,
  ExecutionHealthState,
} from "./generation-types";
import { EXECUTION_HEALTH_BASELINE_SIZE } from "./generation-types";

const executionHealthBaseline: ExecutionHealthBaselineEntry[] = [];

${exportify(slice(295, 415))}
`,
);

writeFileSync(
  path.join(genDir, "generation-session-hydration.ts"),
  `/** Single-flight session snapshot hydration. */
import type { GenerateSessionSnapshot } from "./generation-types";

const sessionHydrationFlights = new Map<
  string,
  Promise<{ snapshot: GenerateSessionSnapshot; dbReadOccurred: boolean }>
>();

${exportify(slice(244, 255))}
`,
);

writeFileSync(
  path.join(genDir, "generation-audit.ts"),
  `/** Audit mode side-effect policy and eval token authorization. */
import type { Request } from "express";

export function requestHeader(req: Request, name: string): string | null {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? null : typeof value === "string" ? value : null;
}

${exportify(slice(417, 423))}
`,
);

const removeRanges = [
  [425, 434],
  [417, 423],
  [610, 939],
  [295, 415],
  [244, 255],
  [257, 288],
  [425, 434],
  [436, 608],
];

const uniqueRanges = [...new Map(removeRanges.map((r) => [r[0], r])).values()].sort((a, b) => b[0] - a[0]);

let updated = [...lines];
for (const [start, end] of uniqueRanges) {
  updated.splice(start - 1, end - start + 1);
}

const importBlock = [
  'import {',
  '  createExecutionHealthProfile,',
  '  finaliseExecutionHealth,',
  '  recordExecutionStage,',
  '} from "./generation/generation-execution-health";',
  'import { generationAuditTokenAuthorized } from "./generation/generation-audit";',
  'import { runSessionHydrationSingleFlight } from "./generation/generation-session-hydration";',
  'import {',
  '  buildPreV3PerformanceReport,',
  '  buildProductionTimelineReport,',
  '  createLiveStageProfiler,',
  '  createPreV3Timing,',
  '  createProductionTimeline,',
  '  endTimelineStage,',
  '  logDbSessionLoadStage,',
  '  logPreV3Stage,',
  '  markTimeline,',
  '  recordDbSessionLoadStage,',
  '  recordPreV3Stage,',
  '  recordPreV3Timing,',
  '  startTimelineStage,',
  '} from "./generation/generation-timing";',
  'import type {',
  '  ConstraintLayer,',
  '  ConstraintTrack,',
  '  ExecutionHealthProfile,',
  '  GenerateSessionSnapshot,',
  '  GenerationSideEffectPolicy,',
  '  LockedIntent,',
  '  PreV3TimingBreakdown,',
  '  ProductionTimeline,',
  '  QualitySignalContext,',
  '} from "./generation/generation-types";',
  'import {',
  '  AUDIT_SIDE_EFFECT_POLICY,',
  '  NEUTRAL_PROFILE,',
  '  PRODUCTION_SIDE_EFFECT_POLICY,',
  '  STRICT_EXPLICIT_ERA_EVIDENCE_RATIO,',
  '  STRICT_EXPLICIT_GENRE_EVIDENCE_RATIO,',
  '} from "./generation/generation-types";',
  "",
].join("\n");

const anchor = updated.findIndex((l) => l.includes('from "./generation-recovery"'));
if (anchor >= 0) updated.splice(anchor, 0, importBlock);

writeFileSync(controllerPath, updated.join("\n"));
console.log(`Controller ${lines.length} -> ${updated.length} lines`);
