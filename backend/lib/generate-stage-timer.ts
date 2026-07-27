/**
 * Per-request generate stage timing + 15s stuck watchdog for Render logs.
 */

import type { Logger } from "pino";

export const GENERATE_STAGE_STUCK_MS = 15_000;
/** Pipeline scoring + compose routinely exceeds 15s on real libraries. */
export const GENERATE_PIPELINE_STAGE_STUCK_MS = 60_000;

export type GenerateStageTimer = {
  start: (stage: string, meta?: Record<string, unknown>) => void;
  end: (label: string, extra?: Record<string, unknown>) => void;
  dispose: () => void;
};

export function createGenerateStageTimer(
  log: Logger,
  ctx?: { requestId?: string; userId?: string }
): GenerateStageTimer {
  let current: { stage: string; t0: number; meta?: Record<string, unknown> } | null = null;
  let watchdog: ReturnType<typeof setInterval> | null = null;
  let stuckWarnedForStage: string | null = null;

  const base = () => ({ requestId: ctx?.requestId, userId: ctx?.userId });

  const checkStuck = () => {
    if (!current) return;
    const ms = Date.now() - current.t0;
    const threshold =
      typeof current.meta?.stuckAfterMs === "number" && current.meta.stuckAfterMs > 0
        ? current.meta.stuckAfterMs
        : GENERATE_STAGE_STUCK_MS;
    if (ms < threshold) return;
    if (stuckWarnedForStage === current.stage) return;
    stuckWarnedForStage = current.stage;
    log.warn(
      { ...base(), stage: current.stage, ms, ...current.meta },
      "Generation stuck in stage"
    );
  };

  return {
    start(stage, meta) {
      if (current) {
        log.info(
          { ...base(), stage: current.stage, ms: Date.now() - current.t0, ...current.meta },
          `${current.stage} complete`
        );
      }
      stuckWarnedForStage = null;
      current = { stage, t0: Date.now(), meta };
      log.info({ ...base(), stage, ...meta }, stage);
      if (!watchdog) watchdog = setInterval(checkStuck, 3000);
    },
    end(label, extra) {
      if (!current) return;
      const ms = Date.now() - current.t0;
      log.info(
        { ...base(), stage: current.stage, ms, ...current.meta, ...extra },
        label
      );
      current = null;
    },
    dispose() {
      if (watchdog) clearInterval(watchdog);
      watchdog = null;
      current = null;
    },
  };
}

/** Inline helper for scoring sub-stages when a full timer is not used. */
export function logScoringStage(
  log: Logger | undefined,
  label: string,
  t0: number,
  meta?: Record<string, unknown>
): void {
  if (!log) return;
  log.info({ ms: Date.now() - t0, ...meta }, label);
}
