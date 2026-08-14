/**
 * PlaylistContract feature flags — V38 architecture prototypes.
 *
 * Env vars:
 *   PLAYLIST_CONTRACT_SHADOW=1     → build + log contract vs world disagreements (no output change)
 *   PLAYLIST_CONTRACT_RETRIEVAL=1  → constraint-aware retrieval scoring (parallel to V37 retrieval)
 *   PLAYLIST_CONTRACT_VALIDATION=1 → contract audit at terminal gate (shadow/enforce)
 *   PLAYLIST_CONTRACT_WORLD_GATE=1  → defer hard world lock when contract disagrees (V39)
 *   PLAYLIST_CONTRACT_V40=1         → contract-authoritative retrieval when gate defers (V40)
 *   PLAYLIST_CONTRACT_V41=1         → contract-aware composition when gate defers (V41)
 *
 * Test override map mirrors expectation/feature-flag.ts pattern.
 */

export type PlaylistContractMode = "off" | "shadow" | "enforce";

const SHADOW_OVERRIDE = new Map<"shadow", boolean>();
const RETRIEVAL_OVERRIDE = new Map<"retrieval", boolean>();
const VALIDATION_OVERRIDE = new Map<"validation", PlaylistContractMode>();
const WORLD_GATE_OVERRIDE = new Map<"world_gate", boolean>();
const V40_OVERRIDE = new Map<"v40", boolean>();
const V41_OVERRIDE = new Map<"v41", boolean>();

function parseBool(raw: string | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "shadow" || v === "on";
}

function parseValidationMode(raw: string | undefined): PlaylistContractMode {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "enforce") return "enforce";
  if (parseBool(v)) return "shadow";
  return "off";
}

/** Shadow mode: build contract + log disagreements without changing output. */
export function isPlaylistContractShadowEnabled(): boolean {
  if (SHADOW_OVERRIDE.has("shadow")) return SHADOW_OVERRIDE.get("shadow")!;
  return parseBool(process.env["PLAYLIST_CONTRACT_SHADOW"]);
}

/** Constraint-aware retrieval prototype. */
export function isPlaylistContractRetrievalEnabled(): boolean {
  if (RETRIEVAL_OVERRIDE.has("retrieval")) return RETRIEVAL_OVERRIDE.get("retrieval")!;
  return parseBool(process.env["PLAYLIST_CONTRACT_RETRIEVAL"]);
}

/** Contract validation at terminal gate. */
export function playlistContractValidationMode(): PlaylistContractMode {
  if (VALIDATION_OVERRIDE.has("validation")) return VALIDATION_OVERRIDE.get("validation")!;
  return parseValidationMode(process.env["PLAYLIST_CONTRACT_VALIDATION"]);
}

export function isPlaylistContractValidationEnabled(): boolean {
  return playlistContractValidationMode() !== "off";
}

/** V39: contract-gated world commitment — defer hardLock when intent disagrees. */
export function isPlaylistContractWorldGateEnabled(): boolean {
  if (WORLD_GATE_OVERRIDE.has("world_gate")) return WORLD_GATE_OVERRIDE.get("world_gate")!;
  return parseBool(process.env["PLAYLIST_CONTRACT_WORLD_GATE"]);
}

/** V40: contract-authoritative retrieval when world gate defers (includes gate evaluation). */
export function isPlaylistContractV40Enabled(): boolean {
  if (V40_OVERRIDE.has("v40")) return V40_OVERRIDE.get("v40")!;
  return parseBool(process.env["PLAYLIST_CONTRACT_V40"]);
}

/** Gate evaluation runs when V39, V40, or V41 is enabled. */
export function isPlaylistContractWorldGateEvaluationEnabled(): boolean {
  return isPlaylistContractWorldGateEnabled() || isPlaylistContractV40Enabled() || isPlaylistContractV41Enabled();
}

/** V41: contract-aware composition + retrieval when world gate defers. */
export function isPlaylistContractV41Enabled(): boolean {
  if (V41_OVERRIDE.has("v41")) return V41_OVERRIDE.get("v41")!;
  return parseBool(process.env["PLAYLIST_CONTRACT_V41"]);
}

/** Contract defer path active (V40 or V41). */
export function isPlaylistContractDeferPathEnabled(): boolean {
  return isPlaylistContractV40Enabled() || isPlaylistContractV41Enabled();
}

/** Test-only overrides. */
export function setPlaylistContractShadowEnabled(enabled: boolean | null): void {
  if (enabled === null) SHADOW_OVERRIDE.delete("shadow");
  else SHADOW_OVERRIDE.set("shadow", enabled);
}

export function setPlaylistContractRetrievalEnabled(enabled: boolean | null): void {
  if (enabled === null) RETRIEVAL_OVERRIDE.delete("retrieval");
  else RETRIEVAL_OVERRIDE.set("retrieval", enabled);
}

export function setPlaylistContractValidationMode(mode: PlaylistContractMode | null): void {
  if (mode === null) VALIDATION_OVERRIDE.delete("validation");
  else VALIDATION_OVERRIDE.set("validation", mode);
}

export function setPlaylistContractWorldGateEnabled(enabled: boolean | null): void {
  if (enabled === null) WORLD_GATE_OVERRIDE.delete("world_gate");
  else WORLD_GATE_OVERRIDE.set("world_gate", enabled);
}

export function setPlaylistContractV40Enabled(enabled: boolean | null): void {
  if (enabled === null) V40_OVERRIDE.delete("v40");
  else V40_OVERRIDE.set("v40", enabled);
}

export function setPlaylistContractV41Enabled(enabled: boolean | null): void {
  if (enabled === null) V41_OVERRIDE.delete("v41");
  else V41_OVERRIDE.set("v41", enabled);
}
