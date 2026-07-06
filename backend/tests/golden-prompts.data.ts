/**
 * Golden prompt regression cases — moment pipeline metadata only.
 * Assertions encode current baseline behaviour; failures signal regressions.
 */

export interface GoldenPromptCase {
  prompt: string;
  expectedSceneId?: string;
  expectedTier?: "low" | "medium" | "high";
  energyMin?: number;
  energyMax?: number;
}

export const GOLDEN_PROMPT_CASES: GoldenPromptCase[] = [
  { prompt: "late night drive alone on the motorway reflective", expectedSceneId: "night_drive_alone_reflection" },
  { prompt: "late summer evening driving home from seeing old friends, want calm", expectedSceneId: "late_summer_friends_drive" },
  { prompt: "2am petrol station fluorescent lonely", expectedSceneId: "petrol_2am_liminal" },
  { prompt: "rainy train home after work tired", expectedSceneId: "rainy_train_home_decompress" },
  { prompt: "hangover sunday morning gentle recovery", expectedSceneId: "hangover_sunday" },
  { prompt: "cleaning the house upbeat reset", expectedSceneId: "cleaning_house" },
  { prompt: "getting ready to go out tonight hyped", expectedSceneId: "getting_ready_out" },
  { prompt: "late night overthinking can't sleep", expectedSceneId: "late_night_overthinking" },
  { prompt: "road trip driving alone for hours", expectedSceneId: "road_trip_alone" },
  { prompt: "morning coffee quiet before work", expectedSceneId: "morning_coffee_quiet" },
  { prompt: "gym workout training session", expectedSceneId: "gym_session" },
  { prompt: "study session focus no distractions", expectedSceneId: "study_focus" },
  { prompt: "walk after breakup processing", expectedSceneId: "breakup_walk" },
  { prompt: "music you forgot you loved late night", expectedSceneId: "library_archaeology" },
  { prompt: "midnight city walk alone reflective", expectedSceneId: "urban_midnight_walk", energyMin: 0, energyMax: 0.5 },
  { prompt: "summer afternoon drift warm haze", expectedSceneId: "summer_afternoon_drift" },
  { prompt: "cooking dinner at home tonight", expectedSceneId: "cooking_dinner" },
  { prompt: "morning commute train to work", expectedSceneId: "commute_morning" },
  { prompt: "evening commute home exhausted", expectedSceneId: "commute_evening_tired" },
  { prompt: "hanging with friends low key", expectedSceneId: "friends_hanging_out" },
  { prompt: "pregame getting ready for the party", expectedSceneId: "pregame_party" },
  { prompt: "lazy sunday morning doing nothing", expectedSceneId: "sunday_slow" },
  { prompt: "rainy day inside cozy", expectedSceneId: "rainy_day_inside", energyMin: 0.15, energyMax: 0.75 },
  { prompt: "working from home deep focus", expectedSceneId: "work_from_home" },
  { prompt: "coding at night flow state", expectedSceneId: "late_night_coding" },
  { prompt: "anxious but want to feel calm", expectedSceneId: "anxious_to_calm" },
  { prompt: "after an argument need space", expectedSceneId: "post_argument_cooldown" },
  { prompt: "missing someone bittersweet", expectedSceneId: "missing_someone" },
  { prompt: "first date nerves getting ready", expectedSceneId: "first_date_nerves" },
  { prompt: "family dinner warm", expectedSceneId: "family_dinner" },
  { prompt: "airport goodbye emotional", expectedSceneId: "airport_goodbye" },
  { prompt: "moving day packing boxes", expectedSceneId: "moving_day" },
  { prompt: "crying in the car alone", expectedSceneId: "crying_in_car" },
  { prompt: "sunset walk golden hour", expectedSceneId: "sunset_walk" },
  { prompt: "after the club ride home", expectedSceneId: "club_to_home", energyMin: 0.05, energyMax: 0.85 },
  { prompt: "meeting new people nervous", expectedSceneId: "meeting_new_people" },
  { prompt: "reunion with old friends weekend", expectedSceneId: "reunion_old_friends" },
  { prompt: "deadline crunch due tomorrow", expectedSceneId: "deadline_crunch" },
  { prompt: "cozy winter evening blanket tea", expectedSceneId: "winter_evening_cozy" },
  { prompt: "monday motivation new week", expectedSceneId: "motivation_monday" },
  { prompt: "driving through hometown nostalgic", expectedSceneId: "nostalgic_hometown_drive" },
  { prompt: "rain on windscreen night drive", expectedSceneId: "rain_windscreen_night_drive" },
  { prompt: "10am petrol station quick stop", expectedSceneId: "petrol_10am_routine" },
  { prompt: "airport at sunrise hopeful departure", expectedSceneId: "airport_sunrise_transition" },
  { prompt: "hidden corners of your library", expectedSceneId: "library_archaeology" },
  { prompt: "nostalgic country road memory", expectedSceneId: "memory_road_nostalgia" },
  { prompt: "walking the dog morning park", expectedSceneId: "walking_dog" },
  { prompt: "self care bath relax", expectedSceneId: "bath_self_care" },
  { prompt: "spring cleaning fresh start", expectedSceneId: "spring_cleaning" },
  { prompt: "solo lunch break pause", expectedSceneId: "quiet_lunch_break" },
  { prompt: "kids bedtime quiet after", expectedSceneId: "kids_bedtime" },
  { prompt: "garden afternoon sunny chill", expectedSceneId: "garden_afternoon" },
  { prompt: "chill", expectedTier: "low" },
  { prompt: "good vibes", expectedTier: "low" },
];
