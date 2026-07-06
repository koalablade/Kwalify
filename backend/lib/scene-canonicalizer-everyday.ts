/**
 * Everyday-life canonical scenes — merged into CANONICAL_SCENES.
 */

interface EverydayCanonicalEntry {
  id: string;
  prototypeId: string;
  emotionalTone: string;
  aliases: string[];
}

export const EVERYDAY_CANONICAL_SCENES: EverydayCanonicalEntry[] = [
  { id: "hangover_sunday", prototypeId: "HANGOVER_RECOVERY", emotionalTone: "fragile_recovery", aliases: ["hangover sunday", "hungover sunday morning", "sunday hangover", "gentle hangover recovery"] },
  { id: "cleaning_house", prototypeId: "DOMESTIC_ROUTINE", emotionalTone: "reset", aliases: ["cleaning the house", "house cleaning playlist", "tidying up at home", "cleaning day"] },
  { id: "getting_ready_out", prototypeId: "PRE_OUT_ENERGY", emotionalTone: "anticipation", aliases: ["getting ready to go out", "pre game getting ready", "getting ready for tonight", "prep for going out"] },
  { id: "late_night_overthinking", prototypeId: "OVERTHINK_LATE", emotionalTone: "rumination", aliases: ["late night overthinking", "can't sleep overthinking", "3am thoughts", "mind racing at night"] },
  { id: "road_trip_alone", prototypeId: "ROAD_TRIP_ALONE", emotionalTone: "open_road", aliases: ["road trip driving alone", "solo road trip", "highway alone long drive", "driving alone for hours"] },
  { id: "morning_coffee_quiet", prototypeId: "COFFEE_MORNING", emotionalTone: "soft_start", aliases: ["morning coffee", "first coffee of the day", "quiet morning coffee", "coffee before work"] },
  { id: "gym_session", prototypeId: "GYM_FOCUS", emotionalTone: "drive", aliases: ["gym workout", "training session", "leg day", "getting hyped for gym"] },
  { id: "study_focus", prototypeId: "STUDY_FOCUS", emotionalTone: "concentration", aliases: ["study session", "revision focus", "library studying", "exam revision focus"] },
  { id: "breakup_walk", prototypeId: "BREAKUP_WALK", emotionalTone: "processing", aliases: ["walk after breakup", "breakup walk", "heartbreak walk alone", "processing a breakup"] },
  { id: "cooking_dinner", prototypeId: "DOMESTIC_ROUTINE", emotionalTone: "warm_domestic", aliases: ["cooking dinner", "making dinner at home", "kitchen evening cooking", "cooking alone tonight"] },
  { id: "shower_reset", prototypeId: "DOMESTIC_ROUTINE", emotionalTone: "reset", aliases: ["shower reset", "long shower thinking", "post shower calm", "bathroom reset"] },
  { id: "commute_morning", prototypeId: "COFFEE_MORNING", emotionalTone: "routine", aliases: ["morning commute", "train to work morning", "bus commute morning", "commute into work"] },
  { id: "commute_evening_tired", prototypeId: "TRANSIT_DECOMPRESS", emotionalTone: "decompression", aliases: ["commute home tired", "evening commute exhausted", "evening commute home exhausted", "heading home drained"] },
  { id: "friends_hanging_out", prototypeId: "SOCIAL_WARMUP", emotionalTone: "social_warmth", aliases: ["hanging with friends", "friends night in", "catching up with friends", "low key with friends"] },
  { id: "pregame_party", prototypeId: "PRE_OUT_ENERGY", emotionalTone: "excitement", aliases: ["pre game playlist", "pregame getting ready", "getting ready for the party", "before the night out"] },
  { id: "sunday_slow", prototypeId: "HANGOVER_RECOVERY", emotionalTone: "slow_sunday", aliases: ["lazy sunday", "slow sunday morning", "sunday afternoon doing nothing", "gentle sunday"] },
  { id: "rainy_day_inside", prototypeId: "DOMESTIC_ROUTINE", emotionalTone: "cozy", aliases: ["rainy day inside", "stuck inside raining", "rainy afternoon at home", "wet day indoors"] },
  { id: "walking_dog", prototypeId: "DOMESTIC_ROUTINE", emotionalTone: "light_motion", aliases: ["walking the dog", "dog walk morning", "evening dog walk", "park walk with dog"] },
  { id: "work_from_home", prototypeId: "STUDY_FOCUS", emotionalTone: "focus", aliases: ["working from home", "wfh focus", "home office deep work", "remote work flow"] },
  { id: "late_night_coding", prototypeId: "STUDY_FOCUS", emotionalTone: "flow", aliases: ["coding at night", "late night programming", "developer flow state", "building at 1am"] },
  { id: "anxious_to_calm", prototypeId: "OVERTHINK_LATE", emotionalTone: "regulation", aliases: ["anxious but want calm", "anxious but want to feel calm", "anxiety easing", "trying to calm down", "nervous need to relax"] },
  { id: "post_argument_cooldown", prototypeId: "BREAKUP_WALK", emotionalTone: "cooldown", aliases: ["after an argument", "after a fight need space", "cooling off after argument", "walk after fight"] },
  { id: "missing_someone", prototypeId: "DRIVE_REFLECTION", emotionalTone: "longing", aliases: ["missing someone", "missing you playlist", "long distance missing", "wish you were here"] },
  { id: "first_date_nerves", prototypeId: "PRE_OUT_ENERGY", emotionalTone: "nerves", aliases: ["first date nerves", "getting ready for a date", "pre date jitters", "date night nervous"] },
  { id: "family_dinner", prototypeId: "SOCIAL_WARMUP", emotionalTone: "family_warmth", aliases: ["family dinner", "dinner with family", "going home for dinner", "family gathering"] },
  { id: "airport_goodbye", prototypeId: "AIRPORT_TRANSITION", emotionalTone: "bittersweet", aliases: ["airport goodbye", "seeing someone off at the airport", "departure gate emotional", "saying goodbye at airport"] },
  { id: "moving_day", prototypeId: "DOMESTIC_ROUTINE", emotionalTone: "transition", aliases: ["moving day", "packing boxes moving", "new apartment move", "moving house stress"] },
  { id: "spring_cleaning", prototypeId: "DOMESTIC_ROUTINE", emotionalTone: "fresh_start", aliases: ["spring cleaning", "declutter playlist", "fresh start cleaning", "reset the apartment"] },
  { id: "bath_self_care", prototypeId: "HANGOVER_RECOVERY", emotionalTone: "self_care", aliases: ["self care night", "self care bath relax", "bath and relax", "pamper evening", "taking care of myself"] },
  { id: "crying_in_car", prototypeId: "DRIVE_REFLECTION", emotionalTone: "release", aliases: ["crying in the car", "car cry session", "pulled over emotional", "drive to cry"] },
  { id: "sunset_walk", prototypeId: "SUN_DAY_DRIVE", emotionalTone: "golden_hour", aliases: ["sunset walk", "golden hour walk", "evening walk sunset", "walk at dusk"] },
  { id: "club_to_home", prototypeId: "TRANSIT_DECOMPRESS", emotionalTone: "come_down", aliases: ["after the club", "post party ride home", "coming down from the night", "uber home after party"] },
  { id: "meeting_new_people", prototypeId: "SOCIAL_WARMUP", emotionalTone: "social_anxiety", aliases: ["meeting new people", "social event nerves", "party where i know nobody", "networking event anxious"] },
  { id: "reunion_old_friends", prototypeId: "DRIVE_SOCIAL_AFTERGLOW", emotionalTone: "reunion", aliases: ["reunion with old friends", "seeing friends i haven't in years", "friends reunion weekend", "catching up with old mates"] },
  { id: "quiet_lunch_break", prototypeId: "COFFEE_MORNING", emotionalTone: "pause", aliases: ["lunch break alone", "midday pause", "solo lunch break", "break from work calm"] },
  { id: "deadline_crunch", prototypeId: "STUDY_FOCUS", emotionalTone: "pressure", aliases: ["deadline crunch", "last minute deadline", "crunch time work", "due tomorrow panic focus"] },
  { id: "kids_bedtime", prototypeId: "DOMESTIC_ROUTINE", emotionalTone: "tender", aliases: ["kids bedtime", "putting kids to sleep", "bedtime routine", "quiet after kids asleep"] },
  { id: "garden_afternoon", prototypeId: "SUN_DAY_DRIVE", emotionalTone: "ease", aliases: ["garden afternoon", "sunny garden chill", "back garden relaxing", "watering plants afternoon"] },
  { id: "winter_evening_cozy", prototypeId: "DOMESTIC_ROUTINE", emotionalTone: "cozy", aliases: ["cozy winter evening", "cold outside warm inside", "winter night in", "blanket and tea evening"] },
  { id: "motivation_monday", prototypeId: "GYM_FOCUS", emotionalTone: "resolve", aliases: ["monday motivation", "new week energy", "monday morning grind", "start the week strong"] },
  { id: "nostalgic_hometown_drive", prototypeId: "ARCHAEOLOGY_MEMORY", emotionalTone: "homecoming", aliases: ["driving through hometown", "back home for the weekend", "nostalgic hometown drive", "visiting home drive"] },
];
