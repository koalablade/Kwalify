import { isExperimentEnabled } from "./experiment-flags";
import type { PrimaryNarrative } from "./primary-narrative";

/** Bump only when intentionally extending the narrative contract. */
export const PRIMARY_NARRATIVE_SCHEMA_VERSION = 1;

const CORE_FIELDS = ["momentLabel", "summary", "arcSummary"] as const;

export type PrimaryNarrativeField = (typeof CORE_FIELDS)[number];

export interface VersionedPrimaryNarrative extends PrimaryNarrative {
  schemaVersion: number;
}

type MigrationFn = (raw: Record<string, unknown>) => VersionedPrimaryNarrative;

const migrationRegistry = new Map<number, MigrationFn>();

/** Register a one-step migration from `fromVersion` to `fromVersion + 1`. */
export function registerSchemaMigration(fromVersion: number, migrate: MigrationFn): void {
  migrationRegistry.set(fromVersion, migrate);
}

/** Legacy v0 — dominantMomentLabel without momentLabel (pre-versioned storage). */
registerSchemaMigration(0, (raw) =>
  wrapVersionedPrimaryNarrative({
    momentLabel: String(raw.momentLabel ?? raw.dominantMomentLabel ?? ""),
    summary: String(raw.summary ?? ""),
    arcSummary: String(raw.arcSummary ?? raw.structureExplanation ?? ""),
  })
);

function detectStoredSchemaVersion(raw: Record<string, unknown>): number {
  if (typeof raw.schemaVersion === "number" && Number.isFinite(raw.schemaVersion)) {
    return raw.schemaVersion;
  }
  if (typeof raw.dominantMomentLabel === "string" && typeof raw.momentLabel !== "string") {
    return 0;
  }
  if (
    typeof raw.momentLabel === "string" &&
    typeof raw.summary === "string" &&
    typeof raw.arcSummary === "string"
  ) {
    return 1;
  }
  return 0;
}

function allowedFieldNames(): string[] {
  const fields = ["schemaVersion", ...CORE_FIELDS];
  if (isExperimentEnabled("narrative_fields_expansion")) {
    return [...fields, "experimentalNotes"];
  }
  return fields;
}

export function assertPrimaryNarrativeSchema(
  value: unknown,
  context = "primaryNarrative"
): asserts value is PrimaryNarrative | VersionedPrimaryNarrative {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `[primaryNarrative v${PRIMARY_NARRATIVE_SCHEMA_VERSION}] ${context} must be an object`
    );
  }

  const record = value as Record<string, unknown>;
  const allowed = new Set(allowedFieldNames());

  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new Error(
        `[primaryNarrative v${PRIMARY_NARRATIVE_SCHEMA_VERSION}] rejected field "${key}" in ${context}`
      );
    }
  }

  for (const field of CORE_FIELDS) {
    if (typeof record[field] !== "string") {
      throw new Error(
        `[primaryNarrative v${PRIMARY_NARRATIVE_SCHEMA_VERSION}] ${context}.${field} must be a string`
      );
    }
  }

  if (
    record.schemaVersion != null &&
    (typeof record.schemaVersion !== "number" || !Number.isFinite(record.schemaVersion))
  ) {
    throw new Error(
      `[primaryNarrative v${PRIMARY_NARRATIVE_SCHEMA_VERSION}] ${context}.schemaVersion must be a number`
    );
  }
}

/** Build-time wrap — outputs current schema version. */
export function wrapVersionedPrimaryNarrative(
  narrative: PrimaryNarrative,
  experimentalNotes?: string
): VersionedPrimaryNarrative {
  const inputKeys = Object.keys(narrative as object);
  for (const key of inputKeys) {
    if (!(CORE_FIELDS as readonly string[]).includes(key)) {
      throw new Error(
        `[primaryNarrative v${PRIMARY_NARRATIVE_SCHEMA_VERSION}] rejected field "${key}" in build`
      );
    }
  }

  const payload: Record<string, unknown> = {
    momentLabel: narrative.momentLabel,
    summary: narrative.summary,
    arcSummary: narrative.arcSummary,
  };

  if (isExperimentEnabled("narrative_fields_expansion") && experimentalNotes?.trim()) {
    payload.experimentalNotes = experimentalNotes.trim();
  }

  assertPrimaryNarrativeSchema(payload, "build");

  return Object.freeze({
    schemaVersion: PRIMARY_NARRATIVE_SCHEMA_VERSION,
    momentLabel: narrative.momentLabel,
    summary: narrative.summary,
    arcSummary: narrative.arcSummary,
    ...(isExperimentEnabled("narrative_fields_expansion") && experimentalNotes?.trim()
      ? { experimentalNotes: experimentalNotes.trim() }
      : {}),
  }) as VersionedPrimaryNarrative;
}

/** @deprecated use wrapVersionedPrimaryNarrative */
export function freezePrimaryNarrative(narrative: PrimaryNarrative): VersionedPrimaryNarrative {
  return wrapVersionedPrimaryNarrative(narrative);
}

/** Migrate stored payloads (any prior version) to the current schema. */
export function migratePrimaryNarrative(input: unknown): VersionedPrimaryNarrative {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(
      `[primaryNarrative v${PRIMARY_NARRATIVE_SCHEMA_VERSION}] cannot migrate non-object input`
    );
  }

  let record: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  let version = detectStoredSchemaVersion(record);

  while (version < PRIMARY_NARRATIVE_SCHEMA_VERSION) {
    const migrate = migrationRegistry.get(version);
    if (!migrate) {
      throw new Error(
        `[primaryNarrative v${PRIMARY_NARRATIVE_SCHEMA_VERSION}] no migration registered from v${version}`
      );
    }
    const migrated = migrate(record);
    record = { ...migrated };
    version = migrated.schemaVersion;
  }

  assertPrimaryNarrativeSchema(record, "migrate");
  return record as VersionedPrimaryNarrative;
}

/** Normalize stored responses — safe for DB/cache reads. */
export function normalizeStoredPrimaryNarrative(input: unknown): VersionedPrimaryNarrative {
  return migratePrimaryNarrative(input);
}

/** Response validation — run immediately before serializing generate responses. */
export function validatePrimaryNarrativeForResponse(
  narrative: unknown
): VersionedPrimaryNarrative {
  return migratePrimaryNarrative(narrative);
}

export function primaryNarrativeFieldNames(): readonly PrimaryNarrativeField[] {
  return CORE_FIELDS;
}

export function listRegisteredMigrations(): number[] {
  return [...migrationRegistry.keys()].sort((a, b) => a - b);
}
