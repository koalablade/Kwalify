/**
 * Human Expectation Layer — feature flag.
 *
 * Modes (env `HUMAN_EXPECTATION_LAYER`):
 *   - unset / "off" / "0" / "false"  → disabled (production default)
 *   - "shadow" / "1" / "true"        → compute + log only, no output change (Phase 1)
 *   - "enforce"                       → reserved for later phases (critic gating)
 *
 * A runtime override map is provided for tests (mirrors experiment-flags.ts),
 * so suites can toggle the layer without a rebuild or env mutation.
 */

export type HumanExpectationMode = "off" | "shadow" | "enforce";

const OVERRIDE = new Map<"mode", HumanExpectationMode>();

function parseMode(raw: string | undefined): HumanExpectationMode {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "shadow" || value === "1" || value === "true") return "shadow";
  if (value === "enforce") return "enforce";
  return "off";
}

/** Current mode of the human-expectation layer (re-read each call). */
export function humanExpectationMode(): HumanExpectationMode {
  if (OVERRIDE.has("mode")) return OVERRIDE.get("mode")!;
  return parseMode(process.env["HUMAN_EXPECTATION_LAYER"]);
}

/** True when the layer should compute at all (shadow or enforce). */
export function isHumanExpectationEnabled(): boolean {
  return humanExpectationMode() !== "off";
}

/** Test-only override — does not require a rebuild or env change. */
export function setHumanExpectationMode(mode: HumanExpectationMode | null): void {
  if (mode === null) {
    OVERRIDE.delete("mode");
    return;
  }
  OVERRIDE.set("mode", mode);
}
