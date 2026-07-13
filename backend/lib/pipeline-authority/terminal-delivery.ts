/**
 * Terminal delivery contract.
 *
 * After freezeTerminal():
 * - finalTracks ordering, length, artist counts, and genre validity must not change.
 * - Only telemetry attachment and HTTP serialization are permitted.
 */

export const TERMINAL_DELIVERY_CONTRACT = {
  scoringOwner: "v3_pipeline",
  deliveryOwner: "controller.terminal_delivery",
  allowedPostTerminalStages: ["score_attribution_metadata", "http_response", "cache_write", "analytics_write"],
  forbiddenMutations: [
    "track_add",
    "track_remove",
    "track_replace",
    "reorder",
    "artist_cap_reapply",
    "recovery_fill",
    "genre_guard_replace",
    "editorial_resequence",
  ],
} as const;

export type TerminalDeliveryPhase = "pre_terminal" | "terminal" | "post_terminal_readonly";

export function describeTerminalDeliveryContract(): string {
  return [
    "Terminal delivery begins after the final authoritative artist cap and pre_response checkpoint.",
    "No stage after terminal freeze may mutate finalTracks except telemetry metadata attachment.",
    "Opening lock must be enforced before terminal freeze; terminal cap is the last track-set mutator.",
    "validatePipelineState(pre_response) must pass before freezeTerminal().",
  ].join(" ");
}
