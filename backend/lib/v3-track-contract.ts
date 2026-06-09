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

type RequiredV3MetadataField = (typeof REQUIRED_V3_METADATA_FIELDS)[number];

function isDevRuntime(): boolean {
  return process.env["NODE_ENV"] !== "production";
}

function trackIdOf(track: unknown): string | null {
  if (!track || typeof track !== "object") return null;
  const record = track as Record<string, unknown>;
  if (typeof record["trackId"] === "string") return record["trackId"];
  if (typeof record["id"] === "string") return record["id"];
  return null;
}

function hasMetadataValue(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== "";
}

export function warnIfV3MetadataLost(
  stage: string,
  before: Array<Record<string, unknown>>,
  after: Array<Record<string, unknown>>
): void {
  if (!isDevRuntime()) return;

  const afterById = new Map<string, Record<string, unknown>>();
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
    for (const field of REQUIRED_V3_METADATA_FIELDS) {
      if (hasMetadataValue(source[field]) && !hasMetadataValue(target[field])) {
        lostFields.push(field);
      }
    }

    if (lostFields.length > 0) {
      console.warn("[v3-contract] metadata lost", {
        stage,
        trackId,
        fields: lostFields,
      });
    }
  }
}
