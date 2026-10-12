import type { Logger } from "pino";
import type { PreV3StageProfile } from "../cache/pre-v3-cache";

export const PRE_V3_TOTAL_BUDGET_MS = 2_000;

export type PreV3BudgetResult = {
  exceeded: boolean;
  budgetMs: number;
  totalMs: number;
  bottleneckStage: string | null;
};

export function enforcePreV3Budget(opts: {
  logger: Logger;
  requestId?: string | null;
  totalMs: number;
  stages: PreV3StageProfile[];
  budgetMs?: number;
}): PreV3BudgetResult {
  const budgetMs = opts.budgetMs ?? PRE_V3_TOTAL_BUDGET_MS;
  const bottleneck = [...opts.stages].sort((a, b) => b.durationMs - a.durationMs)[0] ?? null;
  const result = {
    exceeded: opts.totalMs > budgetMs,
    budgetMs,
    totalMs: opts.totalMs,
    bottleneckStage: bottleneck?.stage ?? null,
  };
  if (result.exceeded) {
    opts.logger.warn(
      {
        requestId: opts.requestId,
        code: "PRE_V3_BUDGET_EXCEEDED",
        budgetMs,
        totalMs: opts.totalMs,
        bottleneckStage: result.bottleneckStage,
        stages: opts.stages,
      },
      "PRE_V3_BUDGET_EXCEEDED"
    );
  }
  return result;
}
