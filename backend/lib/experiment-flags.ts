export type ExperimentFlag =
  | "debug_signals_expansion"
  | "narrative_fields_expansion"
  | "alternative_sequencing";

const VALID_FLAGS = new Set<ExperimentFlag>([
  "debug_signals_expansion",
  "narrative_fields_expansion",
  "alternative_sequencing",
]);

const runtimeOverrides = new Map<ExperimentFlag, boolean>();

/** Runtime toggles via EXPERIMENT_FLAGS=flag1,flag2 (re-read each call). */
export function isExperimentEnabled(flag: ExperimentFlag): boolean {
  if (runtimeOverrides.has(flag)) {
    return runtimeOverrides.get(flag)!;
  }

  const raw = process.env["EXPERIMENT_FLAGS"] ?? "";
  const enabled = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part): part is ExperimentFlag => VALID_FLAGS.has(part as ExperimentFlag));

  return enabled.includes(flag);
}

/** Test-only override — does not require rebuild. */
export function setExperimentFlag(flag: ExperimentFlag, enabled: boolean): void {
  runtimeOverrides.set(flag, enabled);
}

export function clearExperimentFlagOverrides(): void {
  runtimeOverrides.clear();
}

export function listActiveExperimentFlags(): ExperimentFlag[] {
  return (["debug_signals_expansion", "narrative_fields_expansion", "alternative_sequencing"] as const).filter(
    (flag) => isExperimentEnabled(flag)
  );
}
