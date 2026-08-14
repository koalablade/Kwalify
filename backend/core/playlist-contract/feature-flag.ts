/**
 * PlaylistContract feature flags — V38 architecture prototypes.
 *
 * Env vars:
 *   PLAYLIST_CONTRACT_SHADOW=1     → build + log contract vs world disagreements (no output change)
 *   PLAYLIST_CONTRACT_RETRIEVAL=1  → constraint-aware retrieval scoring (parallel to V37 retrieval)
 *   PLAYLIST_CONTRACT_VALIDATION=1 → contract audit at terminal gate (shadow/enforce)
 *
 * Test override map mirrors expectation/feature-flag.ts pattern.
 */

export type PlaylistContractMode = "off" | "shadow" | "enforce";

const SHADOW_OVERRIDE = new Map<"shadow", boolean>();
const RETRIEVAL_OVERRIDE = new Map<"retrieval", boolean>();
const VALIDATION_OVERRIDE = new Map<"validation", PlaylistContractMode>();

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
