/**
 * Generates relationship-rich world knowledge at scale from structured seeds.
 * Run: node backend/scripts/expand-world-knowledge.mjs
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "world-knowledge");

function writeJson(name, data) {
  writeFileSync(join(ROOT, name), `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log(`wrote ${name}: ${countEntries(data)} entries`);
}

function countEntries(data) {
  if (Array.isArray(data.situations)) return data.situations.length;
  if (Array.isArray(data.states)) return data.states.length;
  if (Array.isArray(data.entries)) return data.entries.length;
  if (Array.isArray(data.relationships)) return data.relationships.length;
  return 0;
}

// ─── SITUATIONS (300) ───────────────────────────────────────────────────────

const DRIVING_SEEDS = [
  ["late_night_drive", "late night drive", ["driving at night", "night drive", "after midnight on the road"], ["reflection", "solitude"], "LATE_NIGHT_SOLITARY_JOURNEY"],
  ["long_way_home", "taking the long way home", ["long way back", "took the long way", "wasn't ready to go home"], ["avoidance", "reflection"], "REFLECTIVE_AVOIDANCE_JOURNEY"],
  ["driving_nowhere", "driving nowhere", ["nowhere to be", "just driving", "needed some space"], ["freedom", "reflection"], "REFLECTIVE_AVOIDANCE_JOURNEY"],
  ["rainy_commute", "rainy commute", ["rain on the commute", "wet drive home", "rainy drive home"], ["exhaustion", "reflection"], "LATE_NIGHT_SOLITARY_JOURNEY"],
  ["motorway_at_night", "motorway at night", ["empty motorway", "motorway at midnight", "quiet motorway"], ["loneliness", "reflection"], "LATE_NIGHT_SOLITARY_JOURNEY"],
  ["after_argument_drive", "driving after an argument", ["needed to clear my head", "drove off after a row"], ["anxiety", "reflection"], "REFLECTIVE_AVOIDANCE_JOURNEY"],
  ["first_solo_road_trip", "first solo road trip", ["first time driving alone far", "solo road trip"], ["freedom", "anticipation"], "COASTAL_OPEN_ROAD"],
  ["insomnia_drive", "couldn't sleep so drove", ["went for a drive at 3am", "insomnia drive"], ["restlessness", "reflection"], "NOCTURNAL_ESCAPE_DRIVE"],
];

const HOME_SEEDS = [
  ["first_night_new_home", "first night in a new home", ["new place finally feels like home", "first night where everything felt mine"], ["hope", "contentment"], "FRESH_START_ALONE"],
  ["not_ready_to_go_in", "wasn't ready to go in", ["sat outside because I wasn't ready to go in", "sitting outside the house"], ["avoidance", "reflection"], "REFLECTIVE_AVOIDANCE_JOURNEY"],
  ["after_guests_leave", "after guests leave", ["house went quiet", "everyone left and the house went quiet"], ["reflection", "loneliness"], "QUIET_AFTERMATH"],
  ["sunday_evening_home", "Sunday evening at home", ["grey sunday indoors", "lazy sunday evening"], ["peace", "reflection"], "UK_GREY_SUNDAY_INDOORS"],
  ["cooking_alone", "cooking for yourself", ["making dinner alone", "cooking alone on a sunday"], ["peace", "contentment"], "DOMESTIC_QUIET"],
  ["childhood_bedroom", "childhood bedroom", ["old bedroom", "room I grew up in"], ["nostalgia", "bittersweet"], "NOSTALGIC_RETURN"],
  ["cleaning_room", "cleaning your room", ["tidying up", "sorting through old things"], ["reflection", "nostalgia"], "DOMESTIC_QUIET"],
  ["lights_off_listening", "lights off listening to music", ["kept the lights off", "in the dark with music"], ["introspection", "privacy"], "INTROSPECTIVE_PRIVACY"],
];

const RELATIONSHIP_SEEDS = [
  ["saying_goodbye", "saying goodbye", ["walking home after goodbye", "after saying goodbye"], ["sadness", "grief"], "DEPARTURE_WALK"],
  ["missing_someone", "missing someone", ["wish you were here", "missing them tonight"], ["longing", "sadness"], "DEPARTURE_WALK"],
  ["first_date", "first date", ["nervous before a date", "meeting someone new"], ["anticipation", "anxiety"], "FRESH_START_ALONE"],
  ["old_friend_reunion", "reconnecting with an old friend", ["seeing an old friend again", "caught up with someone from school"], ["nostalgia", "joy"], "NOSTALGIC_RETURN"],
  ["end_of_relationship", "end of a relationship", ["it's over", "after the breakup"], ["grief", "sadness"], "DEPARTURE_WALK"],
  ["new_relationship", "new relationship", ["early days with someone", "new romance"], ["hope", "anticipation"], "FRESH_START_ALONE"],
  ["walking_home_after_everyone_left", "walking home after everyone has left", ["last to leave", "walking back alone"], ["reflection", "loneliness"], "DEPARTURE_WALK"],
];

const LIFE_SEEDS = [
  ["graduation", "graduation", ["graduation day", "finished uni"], ["hope", "nostalgia"], "FRESH_START_ALONE"],
  ["new_job", "new job", ["first day at work", "started a new job"], ["anticipation", "anxiety"], "FRESH_START_ALONE"],
  ["leaving_school", "leaving school", ["last day of school", "school's over"], ["nostalgia", "bittersweet"], "SUMMER_TRANSITION"],
  ["moving_away", "moving away", ["moving out", "leaving home"], ["bittersweet", "hope"], "FRESH_START_ALONE"],
  ["fresh_start", "fresh start", ["new chapter", "starting over"], ["hope", "anticipation"], "FRESH_START_ALONE"],
  ["last_summer_before_moving", "last summer before everyone moved away", ["end of summer with friends", "last summer together"], ["nostalgia", "bittersweet"], "SUMMER_TRANSITION"],
  ["difficult_day_home", "driving home after a difficult day", ["hard day at work", "nowhere to rush to"], ["exhaustion", "relief"], "REFLECTIVE_AVOIDANCE_JOURNEY"],
];

const UK_SEEDS = [
  ["night_bus_home", "night bus home", ["last bus home", "on the night bus"], ["exhaustion", "reflection"], "LATE_NIGHT_SOLITARY_JOURNEY"],
  ["last_train_home", "last train home", ["catching the last train", "platform at night"], ["loneliness", "anticipation"], "LATE_NIGHT_SOLITARY_JOURNEY"],
  ["petrol_station_midnight", "petrol station at midnight", ["service station at night", "forecourt at midnight"], ["loneliness", "reflection"], "NOCTURNAL_ESCAPE_DRIVE"],
  ["walking_back_from_pub", "walking back from the pub", ["after the pub", "stumbling home"], ["contentment", "reflection"], "MENTAL_RESET_WALK"],
  ["first_flat", "first flat", ["first place of my own", "my first flat"], ["hope", "independence"], "FRESH_START_ALONE"],
  ["uni_halls", "uni halls", ["uni days", "first year in halls"], ["nostalgia", "anticipation"], "NOSTALGIC_RETURN"],
  ["bank_holiday", "bank holiday", ["long weekend", "day off"], ["peace", "contentment"], "UK_GREY_SUNDAY_INDOORS"],
  ["country_lane", "country lane", ["country lanes at dusk", "narrow lane drive"], ["peace", "freedom"], "COASTAL_OPEN_ROAD"],
  ["seaside_town", "seaside town", ["by the sea", "coastal town evening"], ["nostalgia", "peace"], "COASTAL_OPEN_ROAD"],
  ["estate_lights", "estate lights at night", ["council estate at night", "estate lights"], ["nostalgia", "reflection"], "LATE_NIGHT_SOLITARY_JOURNEY"],
];

const PLACE_ACTIVITY_MODIFIERS = [
  ["in the rain", "rain"],
  ["at night", "night"],
  ["on a grey sunday", "grey sunday"],
  ["after midnight", "midnight"],
  ["in summer", "summer"],
  ["alone", "alone"],
  ["in the city", "city"],
  ["by the coast", "coast"],
];

function expandSeeds(seeds, family, targetCount) {
  const out = [];
  let i = 0;
  while (out.length < targetCount) {
    const seed = seeds[i % seeds.length];
    const mod = PLACE_ACTIVITY_MODIFIERS[Math.floor(i / seeds.length) % PLACE_ACTIVITY_MODIFIERS.length];
    const [modPhrase, modTag] = mod;
    const id = `${seed[0]}_${modTag.replace(/\s+/g, "_")}_${out.length}`;
    const name = `${seed[1]} ${modPhrase}`.trim();
    const cues = [...seed[2], name, `${seed[1]} ${modPhrase}`];
    out.push({
      id,
      name: seed[1],
      family,
      cues: [...new Set(cues.map((c) => c.toLowerCase()))],
      emotional_meaning: seed[3],
      related_emotions: seed[3],
      scene_hint: seed[4],
      music: {
        energy: seed[3].includes("hope") ? 0.45 : seed[3].includes("grief") ? 0.28 : 0.35,
        textures: seed[3].includes("peace") ? ["warm", "soft"] : ["atmospheric", "intimate"],
        genres: ["indie", "ambient"],
      },
    });
    i += 1;
  }
  return out;
}

const situations = [
  ...expandSeeds(DRIVING_SEEDS, "driving", 50),
  ...expandSeeds(HOME_SEEDS, "home", 50),
  ...expandSeeds(RELATIONSHIP_SEEDS, "relationships", 50),
  ...expandSeeds(LIFE_SEEDS, "life", 50),
  ...expandSeeds(UK_SEEDS, "uk_everyday", 50),
  ...expandSeeds([...DRIVING_SEEDS.slice(0, 4), ...HOME_SEEDS.slice(0, 4)], "places", 50),
  ...expandSeeds([...HOME_SEEDS.slice(4), ...LIFE_SEEDS.slice(0, 4)], "activities", 50),
];

// ─── EMOTIONAL STATES (200) ─────────────────────────────────────────────────

const EMOTION_CORE = [
  ["peaceful_loneliness", "peaceful loneliness", "Being alone but comfortable with the quiet", ["loneliness", "peace"], 0.3, ["warm", "soft"]],
  ["bittersweet_nostalgia", "bittersweet nostalgia", "Warm memory mixed with sadness", ["nostalgia", "bittersweet"], 0.35, ["wistful", "warm"]],
  ["quiet_confidence", "quiet confidence", "Calm self-assurance without performance", ["confidence", "peace"], 0.45, ["steady", "open"]],
  ["emotional_exhaustion", "emotional exhaustion", "Drained after carrying too much", ["exhaustion", "sadness"], 0.22, ["sparse", "slow"]],
  ["hopeful_uncertainty", "hopeful uncertainty", "Nervous optimism about what comes next", ["hope", "anxiety"], 0.42, ["gentle build", "open"]],
  ["lost_but_free", "feeling lost but free", "Disoriented yet unburdened", ["freedom", "reflection"], 0.4, ["expansive", "drifting"]],
  ["relief_after_stress", "relief after stress", "Weight lifting after difficulty", ["relief", "peace"], 0.38, ["release", "warm"]],
  ["missing_the_past", "missing the past", "Yearning for who you were or what you had", ["nostalgia", "longing"], 0.32, ["wistful", "analog"]],
  ["wanting_change", "wanting change", "Ready for something different", ["hope", "anticipation"], 0.48, ["forward", "bright"]],
  ["acceptance", "acceptance", "Making peace with how things are", ["peace", "reflection"], 0.35, ["resolved", "gentle"]],
  ["calm_loneliness", "calm loneliness", "Solitude that feels reflective not desperate", ["loneliness", "peace"], 0.32, ["ambient", "intimate"]],
  ["processing_grief", "processing grief", "Working through loss quietly", ["grief", "reflection"], 0.25, ["sparse", "emotional"]],
  ["independence", "independence", "Standing on your own in a new chapter", ["hope", "freedom"], 0.5, ["open", "confident"]],
  ["social_aftermath", "social aftermath", "Quiet after company has gone", ["reflection", "loneliness"], 0.28, ["minimal", "intimate"]],
  ["nocturnal_wandering", "nocturnal wandering", "Moving through the night without destination", ["freedom", "nostalgia"], 0.38, ["nocturnal", "motion"]],
];

const EMOTION_MODIFIERS = ["quiet", "deep", "gentle", "late night", "sunday", "rainy", "summer", "urban", "domestic", "after goodbye", "new chapter", "on the road"];

const emotionalStates = [];
let eIdx = 0;
while (emotionalStates.length < 200) {
  const core = EMOTION_CORE[eIdx % EMOTION_CORE.length];
  const mod = EMOTION_MODIFIERS[Math.floor(eIdx / EMOTION_CORE.length) % EMOTION_MODIFIERS.length];
  const id = `${core[0]}_${mod.replace(/\s+/g, "_")}`;
  emotionalStates.push({
    id,
    name: `${mod} ${core[1]}`.replace(/^\w/, (c) => c),
    description: core[2],
    cues: [core[1], `${mod} ${core[1]}`, ...core[3].map((e) => `feeling ${e}`)],
    related_emotions: core[3],
    related_situations: [],
    music: {
      energy: core[4],
      tempo: core[4] < 0.3 ? "slow" : core[4] < 0.45 ? "slow-medium" : "medium",
      texture: core[5],
      genres: ["indie", "ambient"],
    },
  });
  eIdx += 1;
}

// ─── SENSORY (300) ──────────────────────────────────────────────────────────

const SENSORY_CORE = [
  ["rain_on_glass", "rain on glass", ["rain texture", "enclosed space", "reflection", "calm"], ["rain", "windscreen"], 0.32],
  ["wet_road_reflections", "street lights reflecting on wet roads", ["night", "urban", "movement", "reflection", "cinematic"], ["street_lights", "wet_pavement"], 0.35],
  ["warm_sun_curtains", "warm sunlight through curtains", ["morning", "comfort", "safety", "nostalgia"], ["warm_lights", "sun"], 0.38],
  ["engine_hum_night", "engine hum at night", ["enclosed space", "motion", "solitude"], ["engine_noise", "car"], 0.35],
  ["cold_air_open_window", "cold air through an open window", ["freedom", "movement", "night"], ["cold_air"], 0.45],
  ["quiet_house_after_noise", "house went quiet", ["aftermath", "intimacy", "reflection"], ["quiet_aftermath"], 0.25],
  ["coffee_morning_smell", "smell of morning coffee", ["domestic", "comfort", "routine"], ["coffee_smell"], 0.35],
  ["radio_faint_car", "faint radio in the car", ["nocturnal", "intimate", "motion"], ["radio_low"], 0.33],
  ["fog_country_lane", "fog on a country lane", ["mystery", "slow movement", "isolation"], ["fog", "countryside"], 0.36],
  ["neon_petrol_forecourt", "neon petrol station forecourt", ["liminal", "night", "pause"], ["petrol_station"], 0.35],
];

const SENSORY_MODS = ["at midnight", "driving home", "sunday morning", "after rain", "in the city", "by the sea", "alone", "late summer", "early autumn", "before dawn"];

const sensoryEntries = [];
let sIdx = 0;
while (sensoryEntries.length < 300) {
  const core = SENSORY_CORE[sIdx % SENSORY_CORE.length];
  const mod = SENSORY_MODS[Math.floor(sIdx / SENSORY_CORE.length) % SENSORY_MODS.length];
  sensoryEntries.push({
    name: `${core[1]} ${mod}`,
    cues: [core[1], `${core[1]} ${mod}`],
    concepts: core[2],
    sensory: core[3],
    emotional_links: core[2].filter((c) => !["night", "urban", "morning"].includes(c)),
    music_direction: { energy: core[4] < 0.3 ? "low" : "low-medium", texture: "warm atmospheric", tempo: "slow-medium" },
  });
  sIdx += 1;
}

// ─── UK CULTURAL (expand to 80) ─────────────────────────────────────────────

const UK_BASE = [
  { name: "grey Sunday", concepts: ["quiet", "slow", "comfort", "reflection", "domestic"], emotion: ["peace"], music: { energy: "low-medium", texture: "warm", tempo: "slow-medium", genres: ["folk", "acoustic"] } },
  { name: "rainy afternoon", concepts: ["shelter", "inward", "soft"], emotion: ["peace", "reflection"], music: { energy: "low", texture: "cosy", tempo: "slow", genres: ["ambient", "acoustic"] } },
  { name: "cold morning", concepts: ["crisp", "fresh start", "quiet"], emotion: ["anticipation"], music: { energy: "low-medium", texture: "clear", tempo: "medium", genres: ["indie", "folk"] } },
  { name: "last train home", concepts: ["ending", "reflection", "night", "transition"], emotion: ["loneliness", "reflection"], music: { energy: "low-medium", texture: "emotional", tempo: "slow-medium", genres: ["indie", "electronic"] } },
  { name: "leaving the pub", concepts: ["social end", "night air", "transition"], emotion: ["contentment", "reflection"], music: { energy: "medium", texture: "warm loose", tempo: "medium", genres: ["indie", "britpop"] } },
  { name: "first car", concepts: ["freedom", "youth", "independence"], emotion: ["joy", "nostalgia"], music: { energy: "medium", texture: "open", tempo: "medium", genres: ["indie rock"] } },
  { name: "driving lessons", concepts: ["nervous growth", "learning", "suburbia"], emotion: ["anxiety", "hope"], music: { energy: "medium", texture: "tentative", tempo: "medium", genres: ["indie pop"] } },
  { name: "school memories", concepts: ["youth", "past self", "playground"], emotion: ["nostalgia"], music: { energy: "medium", texture: "youthful", tempo: "medium", genres: ["indie", "britpop"] } },
  { name: "empty high street", concepts: ["quiet town", "after hours", "stillness"], emotion: ["loneliness", "reflection"], music: { energy: "low", texture: "sparse", tempo: "slow", genres: ["ambient", "indie"] } },
  { name: "sitting outside with friends", concepts: ["summer evening", "belonging", "ease"], emotion: ["contentment", "joy"], music: { energy: "medium", texture: "warm golden", tempo: "medium", genres: ["indie pop", "soul"] } },
];

const UK_MODS = ["in the rain", "at night", "in summer", "in winter", "on a bank holiday", "after uni", "before work", "at the coast"];

const ukEntries = [];
let uIdx = 0;
while (ukEntries.length < 80) {
  const base = UK_BASE[uIdx % UK_BASE.length];
  const mod = UK_MODS[Math.floor(uIdx / UK_BASE.length) % UK_MODS.length];
  ukEntries.push({
    ...base,
    name: `${base.name} ${mod}`,
    cues: [base.name, `${base.name} ${mod}`],
  });
  uIdx += 1;
}

// ─── CONCEPT RELATIONSHIPS ──────────────────────────────────────────────────

const conceptRelationships = [
  {
    concept: "rain",
    environment: ["weather"],
    emotional_links: ["reflection", "comfort", "nostalgia", "calm"],
    sensory: ["soft", "muffled", "enclosed", "rain texture"],
    music: { genres: ["ambient", "dream pop", "slow indie"], energy: "low-medium", texture: "warm" },
  },
  {
    concept: "motorway",
    environment: ["road", "car"],
    emotional_links: ["solitude", "reflection", "freedom", "loneliness"],
    sensory: ["engine hum", "motion", "enclosed space"],
    music: { genres: ["ambient", "indie", "post-rock"], energy: "low-medium", texture: "atmospheric" },
  },
  {
    concept: "home",
    environment: ["domestic"],
    emotional_links: ["safety", "nostalgia", "privacy", "acceptance"],
    sensory: ["warm light", "quiet"],
    music: { genres: ["acoustic", "indie", "ambient"], energy: "low", texture: "cosy" },
  },
  {
    concept: "goodbye",
    social: ["departure"],
    emotional_links: ["grief", "reflection", "longing"],
    sensory: ["cold air", "distance"],
    music: { genres: ["indie", "singer-songwriter"], energy: "low", texture: "sparse emotional" },
  },
  {
    concept: "summer ending",
    life_context: ["transition"],
    emotional_links: ["nostalgia", "bittersweet", "acceptance"],
    sensory: ["golden light", "fading warmth"],
    music: { genres: ["indie", "folk"], energy: "medium", texture: "wistful warm" },
  },
];

writeJson("situations.json", { version: 2, locale: "en-GB", situations });
writeJson("emotional-states.json", { version: 2, locale: "en-GB", states: emotionalStates });
writeJson("sensory-contexts.json", { version: 2, locale: "en-GB", entries: sensoryEntries });
writeJson("uk-cultural-context.json", { version: 2, locale: "en-GB", entries: ukEntries });
writeJson("concept-relationships.json", { version: 2, locale: "en-GB", relationships: conceptRelationships });

console.log("done");
