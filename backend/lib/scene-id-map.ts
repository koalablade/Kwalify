/**
 * Maps canonical scene IDs (snake_case, moment pipeline) to semantic scene IDs
 * (UPPER_SNAKE, scoring engine) so display and scoring stay aligned.
 */
export const CANONICAL_TO_SEMANTIC: Record<string, string> = {
  rain_windscreen_night_drive: "LATE_NIGHT_DRIVE",
  night_drive_alone_reflection: "EMPTY_MOTORWAY_NIGHT",
  petrol_2am_liminal: "PETROL_STATION_2AM",
  petrol_2am_drive_home: "EMPTY_MOTORWAY_NIGHT",
  rainy_train_home_decompress: "RAINY_CITY_LIGHTS",
  urban_midnight_walk: "CITY_AFTER_MIDNIGHT",
  late_summer_friends_drive: "SUMMER_FIELD_GOLDEN_HOUR",
  memory_road_nostalgia: "SUMMER_FIELD_GOLDEN_HOUR",
  nostalgic_hometown_drive: "SUMMER_FIELD_GOLDEN_HOUR",
  winter_evening_cozy: "RAINY_CITY_LIGHTS",
  sunset_walk: "SUMMER_FIELD_GOLDEN_HOUR",
};

export function canonicalToSemanticSceneId(
  canonicalSceneId: string | null | undefined
): string | null {
  if (!canonicalSceneId) return null;
  return CANONICAL_TO_SEMANTIC[canonicalSceneId] ?? null;
}
