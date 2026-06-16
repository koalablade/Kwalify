import { moduleLogger } from "./logger";

export interface V3TrackMetadata {
  genrePrimary?: string | null;

  sourceLane?: string | null;
  laneId?: string | null;
  laneScore?: number | null;
  laneEra?: string | null;

  clusterId?: string | null;
  clusterIds?: string[];

  selectedByV3?: boolean;
}

export type V3MetadataTrack<T extends { trackId: string }> = T & V3TrackMetadata;

const REQUIRED_V3_METADATA_FIELDS = [
  "sourceLane",
  "clusterId",
  "clusterIds",
  "genrePrimary",
] as const;

const log = moduleLogger("v3-track-contract");

type RequiredV3MetadataField = (typeof REQUIRED_V3_METADATA_FIELDS)[number];

function isDevRuntime(): boolean {
  return process.env["NODE_ENV"] !== "production";
}

function trackIdOf<T extends object>(track: T): string | null {
  const obj = track as Partial<{ trackId: string; id: string }>;
  if (typeof obj.trackId === "string") return obj.trackId;
  if (typeof obj.id === "string") return obj.id;
  return null;
}

function hasMetadataValue(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== "";
}

export function warnIfV3MetadataLost<T extends object>(
  before: readonly T[],
  after: readonly T[],
  context: string
): void {
  if (!isDevRuntime()) return;

  const afterById = new Map<string, T>();
  for (const track of after) {
    const trackId = trackIdOf(track);
    if (trackId) afterById.set(trackId, track);
  }

  for (const source of before) {
    const trackId = trackIdOf(source);
    if (!trackId) continue;
    const target = afterById.get(trackId);
    if (!target) continue;

    const lostFields: RequiredV3MetadataField[] = [];
    const sourceMetadata = source as Partial<V3TrackMetadata>;
    const targetMetadata = target as Partial<V3TrackMetadata>;
    for (const field of REQUIRED_V3_METADATA_FIELDS) {
      if (hasMetadataValue(sourceMetadata[field]) && !hasMetadataValue(targetMetadata[field])) {
        lostFields.push(field);
      }
    }

    if (lostFields.length > 0) {
      log.warn({
        stage: context,
        trackId,
        fields: lostFields,
      }, "v3_metadata_lost");
    }
  }
}

export function warnIfFieldDropped<T extends object>(
  field: keyof V3TrackMetadata,
  before: readonly T[],
  after: readonly T[],
  context: string
): void {
  if (!isDevRuntime()) return;

  const afterById = new Map<string, T>();
  for (const track of after) {
    const trackId = trackIdOf(track);
    if (trackId) afterById.set(trackId, track);
  }

  for (const source of before) {
    const trackId = trackIdOf(source);
    if (!trackId) continue;
    const target = afterById.get(trackId);
    if (!target) continue;

    const sourceMetadata = source as Partial<V3TrackMetadata>;
    const targetMetadata = target as Partial<V3TrackMetadata>;
    if (hasMetadataValue(sourceMetadata[field]) && !hasMetadataValue(targetMetadata[field])) {
      log.warn({
        stage: context,
        trackId,
        field,
      }, "v3_metadata_field_dropped");
    }
  }
}
