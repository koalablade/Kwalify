/**
 * Stability / determinism toggles — dev & regression only.
 * Set KWALIFY_DETERMINISTIC=1 in env to enable frozen layers.
 */

export const FORCE_DETERMINISTIC_MODE =
  process.env.KWALIFY_DETERMINISTIC === "1" ||
  process.env.KWALIFY_DETERMINISTIC === "true";

/** When true, dynamic graph uses static base weights only */
export function useFrozenDynamicGraph(): boolean {
  return FORCE_DETERMINISTIC_MODE;
}

/** When true, memory trace rotation boosts are disabled */
export function useFrozenMemoryTrace(): boolean {
  return FORCE_DETERMINISTIC_MODE;
}

/** When true, forecast uses library distribution snapshot only (no session adjustments) */
export function useFrozenForecast(): boolean {
  return FORCE_DETERMINISTIC_MODE;
}
