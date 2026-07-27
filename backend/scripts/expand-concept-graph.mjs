/**
 * Builds the Kwalify concept graph — word/phrase → context → experience → emotion → music.
 * Run: node backend/scripts/expand-concept-graph.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "world-knowledge");

const MUSIC = {
  low: { energy: "low", tempo: "slow", texture: "soft intimate", genres: ["ambient", "acoustic"] },
  lowMed: { energy: "low-medium", tempo: "slow-medium", texture: "warm atmospheric", genres: ["indie", "ambient"] },
  med: { energy: "medium", tempo: "medium", texture: "open melodic", genres: ["indie", "pop"] },
  high: { energy: "medium-high", tempo: "medium-fast", texture: "bright energetic", genres: ["indie rock", "electronic"] },
  peak: { energy: "high", tempo: "fast", texture: "driving intense", genres: ["rock", "hip-hop", "electronic"] },
};

function node(id, domain, name, opts = {}) {
  return {
    id,
    name,
    domain,
    aliases: opts.aliases ?? [name],
    phrases: opts.phrases ?? [],
    related_concepts: opts.related ?? [],
    contexts: opts.contexts ?? [],
    experience: opts.experience ?? "",
    emotional_meaning: opts.emotions ?? [],
    sensory: opts.sensory ?? [],
    scene_possibilities: opts.scenes ?? [],
    music: opts.music ?? MUSIC.lowMed,
  };
}

function expandNodes(seeds, domain, target, extra = () => ({})) {
  const out = [];
  let i = 0;
  const mods = ["at night", "alone", "in the rain", "in summer", "after work", "on a sunday"];
  while (out.length < target) {
    const s = seeds[i % seeds.length];
    const mod = mods[Math.floor(i / seeds.length) % mods.length];
    const suffix = out.length > seeds.length ? `_${mod.replace(/\s+/g, "_")}` : "";
    out.push(node(`${s.id}${suffix}`, domain, s.name, {
      aliases: [...(s.aliases ?? [s.name]), ...(out.length > seeds.length ? [`${s.name} ${mod}`] : [])],
      phrases: s.phrases ?? [],
      related: s.related ?? [],
      contexts: s.contexts ?? [],
      experience: s.experience ?? "",
      emotions: s.emotions ?? [],
      sensory: s.sensory ?? [],
      scenes: s.scenes ?? [],
      music: s.music ?? MUSIC.lowMed,
      ...extra(s, mod, out.length),
    }));
    i += 1;
  }
  return out;
}

function writeDomain(domain, nodes) {
  const dir = join(ROOT, domain);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "nodes.json"), `${JSON.stringify({ version: 1, locale: "en-GB", domain, nodes }, null, 2)}\n`);
  console.log(`${domain}: ${nodes.length} nodes`);
}

// ─── CONCEPTS (objects that anchor situations) ─────────────────────────────

const conceptSeeds = [
  { id: "windscreen", name: "windscreen", aliases: ["windscreen", "windshield", "car window", "rain on glass", "rain on the glass"], phrases: ["rain on the windscreen", "rain hitting the windscreen"], related: ["driving", "car", "rain", "night_drive"], contexts: ["commute", "road trip"], experience: "Private mobile solitude behind glass", emotions: ["solitude", "reflection", "escape", "calm"], sensory: ["rain drops", "reflections", "blurred lights"], scenes: ["LATE_NIGHT_SOLITARY_JOURNEY", "REFLECTIVE_AVOIDANCE_JOURNEY"], music: MUSIC.lowMed },
  { id: "neon_lights", name: "neon lights", aliases: ["neon", "neon glow", "neon streets"], related: ["city", "night"], experience: "Urban night energy", emotions: ["freedom", "loneliness", "cinematic"], sensory: ["glow", "colour"], scenes: ["LATE_NIGHT_SOLITARY_JOURNEY"], music: MUSIC.lowMed },
  { id: "street_lights", name: "street lights", aliases: ["street lights", "streetlights", "passing lights"], related: ["driving", "city", "rain"], experience: "Rhythmic motion through urban night", emotions: ["reflection", "solitude"], sensory: ["reflection", "motion"], scenes: ["LATE_NIGHT_SOLITARY_JOURNEY"], music: MUSIC.lowMed },
  { id: "coffee", name: "coffee", aliases: ["coffee", "morning coffee", "espresso"], related: ["morning", "kitchen"], experience: "Domestic morning ritual", emotions: ["comfort", "anticipation", "peace"], sensory: ["warm smell"], scenes: ["DOMESTIC_QUIET", "UK_GREY_SUNDAY_INDOORS"], music: MUSIC.low },
  { id: "empty_room", name: "empty room", aliases: ["empty room", "quiet room", "room went quiet"], related: ["home", "party_aftermath"], experience: "Social energy has left the space", emotions: ["loneliness", "reflection", "peace"], scenes: ["QUIET_AFTERMATH"], music: MUSIC.low },
  { id: "old_photos", name: "old photos", aliases: ["old photo", "old photos", "photo album"], related: ["nostalgia", "childhood"], experience: "Confronting past identity", emotions: ["nostalgia", "longing", "bittersweet"], scenes: ["NOSTALGIC_RETURN"], music: MUSIC.lowMed },
  { id: "headphones", name: "headphones", aliases: ["headphones", "earphones", "in my headphones"], related: ["introspection", "walking"], experience: "Private soundtrack bubble", emotions: ["introspection", "privacy"], scenes: ["INTROSPECTIVE_PRIVACY", "MENTAL_RESET_WALK"], music: MUSIC.lowMed },
  { id: "gym", name: "gym", aliases: ["gym", "the gym", "workout", "training"], phrases: ["gym playlist", "gym music", "workout playlist"], related: ["exercise", "motivation"], experience: "Physical push and focus", emotions: ["motivation", "confidence", "aggression"], scenes: ["FRESH_START_ALONE"], music: MUSIC.peak },
  { id: "game_controller", name: "gaming", aliases: ["gaming", "video games", "playing games"], phrases: ["gaming playlist", "music for gaming"], related: ["focus", "immersion"], experience: "Immersive focus world", emotions: ["focus", "excitement"], scenes: ["INTROSPECTIVE_PRIVACY"], music: MUSIC.med },
];

writeDomain("concepts", expandNodes(conceptSeeds, "concepts", 80));

// ─── ENVIRONMENTS ───────────────────────────────────────────────────────────

const envSeeds = [
  { id: "bedroom", name: "bedroom", aliases: ["bedroom", "my room", "in bed"], related: ["home", "night"], emotions: ["privacy", "introspection", "peace"], scenes: ["INTROSPECTIVE_PRIVACY", "DOMESTIC_QUIET"], music: MUSIC.low },
  { id: "kitchen", name: "kitchen", aliases: ["kitchen", "in the kitchen"], related: ["home", "cooking"], emotions: ["comfort", "peace"], scenes: ["DOMESTIC_QUIET"], music: MUSIC.low },
  { id: "childhood_home", name: "childhood home", aliases: ["childhood home", "house I grew up in", "old house"], emotions: ["nostalgia", "bittersweet"], scenes: ["NOSTALGIC_RETURN"], music: MUSIC.lowMed },
  { id: "city", name: "city", aliases: ["city", "the city", "downtown", "urban"], emotions: ["freedom", "loneliness", "reflection"], scenes: ["LATE_NIGHT_SOLITARY_JOURNEY", "MENTAL_RESET_WALK"], music: MUSIC.med },
  { id: "alley", name: "alley", aliases: ["alley", "alleyway", "back street"], emotions: ["mystery", "introspection"], scenes: ["LATE_NIGHT_SOLITARY_JOURNEY"], music: MUSIC.low },
  { id: "rooftop", name: "rooftop", aliases: ["rooftop", "on a roof"], emotions: ["freedom", "reflection"], scenes: ["COASTAL_OPEN_ROAD"], music: MUSIC.med },
  { id: "forest", name: "forest", aliases: ["forest", "woods", "trees"], emotions: ["peace", "mystery"], scenes: ["MENTAL_RESET_WALK"], music: MUSIC.low },
  { id: "beach", name: "beach", aliases: ["beach", "by the sea", "shoreline"], emotions: ["nostalgia", "peace", "freedom"], scenes: ["COASTAL_OPEN_ROAD", "SUMMER_TRANSITION"], music: MUSIC.med },
  { id: "mountains", name: "mountains", aliases: ["mountains", "hills", "peak"], emotions: ["awe", "freedom"], scenes: ["COASTAL_OPEN_ROAD"], music: MUSIC.med },
  { id: "car_interior", name: "car", aliases: ["car", "in the car", "behind the wheel"], related: ["driving", "windscreen"], emotions: ["solitude", "freedom", "reflection"], scenes: ["LATE_NIGHT_SOLITARY_JOURNEY", "REFLECTIVE_AVOIDANCE_JOURNEY"], music: MUSIC.lowMed },
  { id: "train", name: "train", aliases: ["train", "on the train", "railway"], emotions: ["reflection", "anticipation", "loneliness"], scenes: ["LATE_NIGHT_SOLITARY_JOURNEY"], music: MUSIC.lowMed },
  { id: "airport", name: "airport", aliases: ["airport", "terminal", "departure gate"], emotions: ["anticipation", "anxiety", "transition"], scenes: ["FRESH_START_ALONE", "DEPARTURE_WALK"], music: MUSIC.med },
  { id: "hotel_room", name: "hotel room", aliases: ["hotel room", "hotel", "motel"], emotions: ["loneliness", "reflection"], scenes: ["INTROSPECTIVE_PRIVACY"], music: MUSIC.low },
  { id: "party_venue", name: "party", aliases: ["party", "at a party", "house party"], emotions: ["joy", "excitement"], scenes: ["QUIET_AFTERMATH"], music: MUSIC.high },
  { id: "pub", name: "pub", aliases: ["pub", "the pub", "bar"], emotions: ["contentment", "nostalgia"], scenes: ["UK_GREY_SUNDAY_INDOORS"], music: MUSIC.med },
  { id: "concert_venue", name: "concert", aliases: ["concert", "gig", "live show"], emotions: ["joy", "anticipation"], scenes: ["FRESH_START_ALONE"], music: MUSIC.high },
];

writeDomain("environments", expandNodes(envSeeds, "environments", 72));

// ─── EMOTIONS (graph nodes) ─────────────────────────────────────────────────

const emotionSeeds = [
  { id: "joy", name: "joy", aliases: ["joy", "joyful", "happy"], emotions: ["joy", "celebration"], scenes: ["FRESH_START_ALONE"], music: MUSIC.high },
  { id: "heartbreak", name: "heartbreak", aliases: ["heartbreak", "heartbroken", "broken heart"], emotions: ["grief", "sadness"], scenes: ["DEPARTURE_WALK"], music: MUSIC.low },
  { id: "homesick", name: "homesick", aliases: ["homesick", "missing home"], emotions: ["longing", "nostalgia"], scenes: ["NOSTALGIC_RETURN"], music: MUSIC.low },
  { id: "bittersweet", name: "bittersweet", aliases: ["bittersweet", "happy but sad"], emotions: ["nostalgia", "bittersweet"], scenes: ["SUMMER_TRANSITION", "NOSTALGIC_RETURN"], music: MUSIC.lowMed },
  { id: "lost", name: "lost", aliases: ["lost", "feeling lost", "adrift"], emotions: ["reflection", "anxiety"], scenes: ["MENTAL_RESET_WALK"], music: MUSIC.low },
  { id: "free", name: "free", aliases: ["free", "feeling free", "liberated"], emotions: ["freedom", "joy"], scenes: ["COASTAL_OPEN_ROAD", "REFLECTIVE_AVOIDANCE_JOURNEY"], music: MUSIC.med },
  { id: "empty_peaceful", name: "empty but peaceful", aliases: ["empty but peaceful", "peaceful emptiness"], emotions: ["peace", "loneliness"], scenes: ["QUIET_AFTERMATH"], music: MUSIC.low },
  { id: "excited_nervous", name: "excited but nervous", aliases: ["excited but nervous", "nervous excitement"], emotions: ["anticipation", "anxiety"], scenes: ["FRESH_START_ALONE"], music: MUSIC.med },
  { id: "starting_again", name: "starting again", aliases: ["starting again", "begin again", "new chapter"], emotions: ["hope", "anticipation"], scenes: ["FRESH_START_ALONE"], music: MUSIC.med },
  { id: "growing_up", name: "growing up", aliases: ["growing up", "getting older"], emotions: ["nostalgia", "bittersweet"], scenes: ["SUMMER_TRANSITION"], music: MUSIC.lowMed },
  { id: "feeling_alive", name: "feeling alive", aliases: ["feeling alive", "alive", "electric"], emotions: ["joy", "freedom"], scenes: ["COASTAL_OPEN_ROAD"], music: MUSIC.high },
  { id: "quiet_confidence", name: "quiet confidence", aliases: ["quiet confidence", "calm confidence"], emotions: ["confidence", "peace"], scenes: ["FRESH_START_ALONE"], music: MUSIC.med },
  { id: "acceptance", name: "acceptance", aliases: ["acceptance", "making peace"], emotions: ["peace", "relief"], scenes: ["DOMESTIC_QUIET"], music: MUSIC.lowMed },
  { id: "revenge_energy", name: "revenge", aliases: ["revenge", "prove them wrong"], emotions: ["confidence", "aggression"], scenes: ["FRESH_START_ALONE"], music: MUSIC.peak },
  { id: "achievement", name: "achievement", aliases: ["achievement", "finally did it", "accomplished"], phrases: ["finally achieve something", "when you finally achieve"], emotions: ["joy", "relief", "pride"], scenes: ["FRESH_START_ALONE"], music: MUSIC.high },
];

writeDomain("emotions", expandNodes(emotionSeeds, "emotions", 90));

// ─── ACTIVITIES ─────────────────────────────────────────────────────────────

const activitySeeds = [
  { id: "driving", name: "driving", aliases: ["driving", "drive", "on the road"], phrases: ["driving home", "driving at night"], related: ["car", "windscreen"], emotions: ["reflection", "freedom"], scenes: ["LATE_NIGHT_SOLITARY_JOURNEY", "REFLECTIVE_AVOIDANCE_JOURNEY"], music: MUSIC.lowMed },
  { id: "commute", name: "commuting", aliases: ["commute", "commuting", "on the way to work"], related: ["driving", "train"], emotions: ["exhaustion", "reflection"], scenes: ["LATE_NIGHT_SOLITARY_JOURNEY"], music: MUSIC.lowMed },
  { id: "road_trip", name: "road trip", aliases: ["road trip", "long drive"], emotions: ["freedom", "anticipation"], scenes: ["COASTAL_OPEN_ROAD"], music: MUSIC.med },
  { id: "walking_home", name: "walking home", aliases: ["walking home", "walk home"], emotions: ["reflection", "loneliness"], scenes: ["DEPARTURE_WALK"], music: MUSIC.low },
  { id: "clearing_head", name: "clearing your head", aliases: ["clear my head", "clearing my head", "clear your head"], phrases: ["need to clear my head", "I need to clear my head"], emotions: ["relief", "reflection"], scenes: ["MENTAL_RESET_WALK"], music: MUSIC.lowMed },
  { id: "cooking", name: "cooking", aliases: ["cooking", "making dinner"], emotions: ["comfort", "peace"], scenes: ["DOMESTIC_QUIET"], music: MUSIC.low },
  { id: "cleaning", name: "cleaning", aliases: ["cleaning", "tidying", "decluttering"], emotions: ["relief", "fresh start"], scenes: ["DOMESTIC_QUIET", "FRESH_START_ALONE"], music: MUSIC.low },
  { id: "exercise", name: "exercise", aliases: ["exercise", "workout", "training session"], related: ["gym"], emotions: ["motivation", "achievement"], scenes: ["FRESH_START_ALONE"], music: MUSIC.peak },
  { id: "running", name: "running", aliases: ["running", "go for a run", "jogging"], emotions: ["relief", "freedom"], scenes: ["MENTAL_RESET_WALK"], music: MUSIC.high },
  { id: "studying", name: "studying", aliases: ["studying", "revision", "coursework"], emotions: ["focus", "anxiety"], scenes: ["INTROSPECTIVE_PRIVACY"], music: MUSIC.low },
  { id: "gaming", name: "gaming", aliases: ["gaming", "playing games"], emotions: ["focus", "immersion"], scenes: ["INTROSPECTIVE_PRIVACY"], music: MUSIC.med },
];

writeDomain("activities", expandNodes(activitySeeds, "activities", 66));

// ─── WEATHER ────────────────────────────────────────────────────────────────

const weatherSeeds = [
  { id: "rain", name: "rain", aliases: ["rain", "rainy", "raining", "rainy night", "rainy day"], phrases: ["rainy night", "when it rains"], emotions: ["reflection", "calm", "melancholy"], sensory: ["soft", "muffled"], scenes: ["WEATHER_REFLECTION", "LATE_NIGHT_SOLITARY_JOURNEY"], music: MUSIC.lowMed },
  { id: "sun", name: "sun", aliases: ["sun", "sunny", "sunshine", "warm sun"], emotions: ["joy", "freedom", "nostalgia"], scenes: ["SUMMER_TRANSITION", "COASTAL_OPEN_ROAD"], music: MUSIC.med },
  { id: "snow", name: "snow", aliases: ["snow", "snowy", "snowing"], emotions: ["peace", "nostalgia", "magic"], scenes: ["UK_GREY_SUNDAY_INDOORS"], music: MUSIC.low },
  { id: "fog", name: "fog", aliases: ["fog", "foggy", "mist"], emotions: ["mystery", "uncertainty"], scenes: ["WEATHER_REFLECTION"], music: MUSIC.low },
  { id: "storm", name: "storm", aliases: ["storm", "stormy", "thunder"], emotions: ["tension", "release"], scenes: ["WEATHER_REFLECTION"], music: MUSIC.med },
  { id: "grey_skies", name: "grey skies", aliases: ["grey skies", "overcast", "grey day"], emotions: ["melancholy", "reflection"], scenes: ["UK_GREY_SUNDAY_INDOORS"], music: MUSIC.low },
];

writeDomain("weather", expandNodes(weatherSeeds, "weather", 48));

// ─── TIME ───────────────────────────────────────────────────────────────────

const timeSeeds = [
  { id: "morning", name: "morning", aliases: ["morning", "early morning"], emotions: ["hope", "fresh"], scenes: ["FRESH_START_ALONE", "DOMESTIC_QUIET"], music: MUSIC.lowMed },
  { id: "afternoon", name: "afternoon", aliases: ["afternoon", "sunday afternoon"], emotions: ["active", "open"], scenes: ["UK_GREY_SUNDAY_INDOORS"], music: MUSIC.med },
  { id: "sunset", name: "sunset", aliases: ["sunset", "golden hour", "dusk"], emotions: ["bittersweet", "nostalgia"], scenes: ["SUMMER_TRANSITION"], music: MUSIC.lowMed },
  { id: "evening", name: "evening", aliases: ["evening", "early evening"], emotions: ["reflection", "transition"], scenes: ["DEPARTURE_WALK"], music: MUSIC.lowMed },
  { id: "night", name: "night", aliases: ["night", "at night", "rainy night"], emotions: ["privacy", "introspection"], scenes: ["LATE_NIGHT_SOLITARY_JOURNEY"], music: MUSIC.lowMed },
  { id: "midnight", name: "midnight", aliases: ["midnight", "after midnight"], emotions: ["cinematic", "lonely"], scenes: ["LATE_NIGHT_SOLITARY_JOURNEY", "NOCTURNAL_ESCAPE_DRIVE"], music: MUSIC.low },
  { id: "two_am", name: "2am", aliases: ["2am", "2 am", "two am"], emotions: ["honesty", "nostalgia"], scenes: ["NOCTURNAL_ESCAPE_DRIVE", "INTROSPECTIVE_PRIVACY"], music: MUSIC.low },
  { id: "late_night", name: "late night", aliases: ["late night", "late one"], emotions: ["freedom", "reflection"], scenes: ["LATE_NIGHT_SOLITARY_JOURNEY"], music: MUSIC.lowMed },
  { id: "sunday", name: "sunday", aliases: ["sunday", "grey sunday"], emotions: ["slow", "comfort"], scenes: ["UK_GREY_SUNDAY_INDOORS"], music: MUSIC.low },
  { id: "monday_morning", name: "grey monday morning", aliases: ["monday morning", "grey monday"], emotions: ["routine", "low energy"], scenes: ["FRESH_START_ALONE"], music: MUSIC.med },
];

writeDomain("time", expandNodes(timeSeeds, "time", 50));

// ─── SOCIAL ─────────────────────────────────────────────────────────────────

const socialSeeds = [
  { id: "first_date", name: "first date", aliases: ["first date", "going on a date"], emotions: ["anticipation", "anxiety"], scenes: ["FRESH_START_ALONE"], music: MUSIC.med },
  { id: "breakup", name: "breakup", aliases: ["breakup", "broke up", "after the breakup"], emotions: ["grief", "sadness"], scenes: ["DEPARTURE_WALK"], music: MUSIC.low },
  { id: "party_aftermath", name: "after the party", aliases: ["after the party", "party finishes", "everyone leaves the party", "after everyone leaves"], phrases: ["the feeling after everyone leaves the party", "weird calm after a party"], emotions: ["reflection", "loneliness"], scenes: ["QUIET_AFTERMATH"], music: MUSIC.low },
  { id: "reunion", name: "reunion", aliases: ["reunion", "seeing old friends"], emotions: ["nostalgia", "joy"], scenes: ["NOSTALGIC_RETURN"], music: MUSIC.med },
  { id: "missing_someone", name: "missing someone", aliases: ["missing someone", "miss them", "wish you were here"], emotions: ["longing", "sadness"], scenes: ["DEPARTURE_WALK"], music: MUSIC.low },
  { id: "family_memory", name: "family memories", aliases: ["family memories", "family dinner"], emotions: ["nostalgia", "warmth"], scenes: ["NOSTALGIC_RETURN"], music: MUSIC.lowMed },
];

writeDomain("social", expandNodes(socialSeeds, "social", 54));

// ─── TRAVEL ─────────────────────────────────────────────────────────────────

const travelSeeds = [
  { id: "leaving", name: "leaving", aliases: ["leaving", "saying goodbye", "departure"], emotions: ["sadness", "anticipation"], scenes: ["DEPARTURE_WALK"], music: MUSIC.lowMed },
  { id: "arriving", name: "arriving", aliases: ["arriving", "just arrived"], emotions: ["relief", "anticipation"], scenes: ["FRESH_START_ALONE"], music: MUSIC.med },
  { id: "long_way_home", name: "long way home", aliases: ["long way home", "taking the long way"], emotions: ["avoidance", "reflection"], scenes: ["REFLECTIVE_AVOIDANCE_JOURNEY"], music: MUSIC.lowMed },
  { id: "getting_lost", name: "getting lost", aliases: ["getting lost", "lost in the city"], emotions: ["anxiety", "freedom"], scenes: ["MENTAL_RESET_WALK"], music: MUSIC.lowMed },
  { id: "wandering", name: "wandering", aliases: ["wandering", "wandering around"], emotions: ["reflection", "freedom"], scenes: ["MENTAL_RESET_WALK"], music: MUSIC.lowMed },
  { id: "night_drive", name: "night drive", aliases: ["night drive", "driving at night"], related: ["driving", "windscreen"], emotions: ["solitude", "reflection"], scenes: ["LATE_NIGHT_SOLITARY_JOURNEY"], music: MUSIC.lowMed },
  { id: "petrol_station_midnight", name: "petrol station at midnight", aliases: ["petrol station at midnight", "service station at night"], emotions: ["loneliness", "freedom"], scenes: ["NOCTURNAL_ESCAPE_DRIVE"], music: MUSIC.lowMed },
  { id: "last_train", name: "last train home", aliases: ["last train", "last train home"], emotions: ["reflection", "loneliness"], scenes: ["LATE_NIGHT_SOLITARY_JOURNEY"], music: MUSIC.lowMed },
];

writeDomain("travel", expandNodes(travelSeeds, "travel", 56));

// ─── MUSIC LANGUAGE ─────────────────────────────────────────────────────────

const musicLangSeeds = [
  { id: "chill", name: "chill", aliases: ["chill", "chilled", "chill vibes"], emotions: ["peace", "contentment"], music: MUSIC.low },
  { id: "dark", name: "dark", aliases: ["dark", "dark vibes"], emotions: ["introspection", "tension"], music: { ...MUSIC.low, texture: "mysterious minor" } },
  { id: "epic", name: "epic", aliases: ["epic", "cinematic epic"], emotions: ["anticipation", "awe"], music: { ...MUSIC.high, texture: "large scale dramatic" } },
  { id: "vibey", name: "vibey", aliases: ["vibey", "vibes", "good vibes"], emotions: ["contentment", "joy"], music: { ...MUSIC.med, texture: "groovy textural" } },
  { id: "nostalgic_music", name: "nostalgic", aliases: ["nostalgic", "nostalgia vibes"], emotions: ["nostalgia", "bittersweet"], music: { ...MUSIC.lowMed, texture: "warm familiar" } },
  { id: "emotional_music", name: "emotional", aliases: ["emotional", "something emotional"], phrases: ["something emotional", "music that hits"], emotions: ["sadness", "reflection", "nostalgia"], scenes: ["WEATHER_REFLECTION", "NOSTALGIC_RETURN"], music: MUSIC.lowMed },
  { id: "main_character", name: "main character", aliases: ["main character", "main character music", "protagonist energy"], phrases: ["main character music", "I want main character music"], emotions: ["confidence", "freedom"], scenes: ["COASTAL_OPEN_ROAD", "FRESH_START_ALONE"], music: MUSIC.high },
  { id: "sad_music", name: "sad", aliases: ["sad", "sad songs", "make me cry"], emotions: ["sadness", "grief"], music: MUSIC.low },
  { id: "happy_music", name: "happy", aliases: ["happy", "uplifting", "feel good"], emotions: ["joy", "hope"], music: MUSIC.high },
];

writeDomain("music-language", expandNodes(musicLangSeeds, "music-language", 54));

// ─── PHRASE PATTERNS ────────────────────────────────────────────────────────

const phraseSeeds = [
  { id: "rainy_night_short", name: "rainy night", aliases: ["rainy night"], emotions: ["reflection", "calm"], scenes: ["LATE_NIGHT_SOLITARY_JOURNEY", "WEATHER_REFLECTION"], music: MUSIC.lowMed },
  { id: "summer_memories", name: "summer memories", aliases: ["summer memories", "summer memory"], phrases: ["something like summer", "feels like summer"], emotions: ["nostalgia", "joy"], scenes: ["SUMMER_TRANSITION"], music: MUSIC.med },
  { id: "gym_playlist", name: "gym playlist", aliases: ["gym playlist", "workout music"], emotions: ["motivation", "confidence"], scenes: ["FRESH_START_ALONE"], music: MUSIC.peak },
  { id: "driving_home_short", name: "driving home", aliases: ["driving home", "drive home"], emotions: ["reflection", "relief"], scenes: ["REFLECTIVE_AVOIDANCE_JOURNEY", "LATE_NIGHT_SOLITARY_JOURNEY"], music: MUSIC.lowMed },
  { id: "old_teenage_years", name: "old teenage years", aliases: ["teenage years", "my teenage years", "old teenage years"], phrases: ["something like my old teenage years", "my teenage years"], emotions: ["nostalgia", "innocence"], scenes: ["NOSTALGIC_RETURN"], music: MUSIC.med },
  { id: "life_changing_long", name: "life is changing", aliases: ["life is changing", "life keeps changing"], phrases: ["when you realise life is changing", "don't know where you're going"], emotions: ["anticipation", "anxiety", "hope"], scenes: ["FRESH_START_ALONE", "SUMMER_TRANSITION"], music: MUSIC.lowMed },
  { id: "old_neighbourhood", name: "old neighbourhood", aliases: ["old neighbourhood", "old neighborhood", "my old street"], phrases: ["walking through my old neighbourhood"], emotions: ["nostalgia", "bittersweet"], scenes: ["NOSTALGIC_RETURN"], music: MUSIC.lowMed },
  { id: "miss_old_days", name: "miss the old days", aliases: ["miss the old days", "I miss the old days", "good old days"], emotions: ["nostalgia", "longing"], scenes: ["NOSTALGIC_RETURN"], music: MUSIC.lowMed },
  { id: "city_after_midnight", name: "city after midnight", aliases: ["city after midnight", "walking through the city after midnight"], phrases: ["music for walking through the city after midnight"], emotions: ["freedom", "reflection"], scenes: ["LATE_NIGHT_SOLITARY_JOURNEY", "MENTAL_RESET_WALK"], music: MUSIC.lowMed },
  { id: "long_day_rain", name: "long day in the rain", aliases: ["long day", "after a long day"], phrases: ["driving home after a long day while it rains"], emotions: ["exhaustion", "reflection", "relief"], scenes: ["LATE_NIGHT_SOLITARY_JOURNEY"], music: MUSIC.lowMed },
  { id: "finally_achieve", name: "finally achieve", aliases: ["finally achieve", "achieved something"], phrases: ["music for when you finally achieve something"], emotions: ["joy", "relief", "pride"], scenes: ["FRESH_START_ALONE"], music: MUSIC.high },
  { id: "need_motivation", name: "need motivation", aliases: ["need motivation", "monday motivation"], emotions: ["motivation", "hope"], scenes: ["FRESH_START_ALONE"], music: MUSIC.high },
];

writeDomain("phrase-patterns", expandNodes(phraseSeeds, "phrase-patterns", 96));

// ─── UK CONTEXT ─────────────────────────────────────────────────────────────

const ukSeeds = [
  { id: "petrol_midnight", name: "petrol station at midnight", aliases: ["petrol station at midnight"], emotions: ["loneliness", "reflection"], scenes: ["NOCTURNAL_ESCAPE_DRIVE"], music: MUSIC.lowMed },
  { id: "last_train_uk", name: "last train home", aliases: ["last train home"], emotions: ["reflection", "loneliness"], scenes: ["LATE_NIGHT_SOLITARY_JOURNEY"], music: MUSIC.lowMed },
  { id: "sunday_afternoon_uk", name: "sunday afternoon", aliases: ["sunday afternoon"], emotions: ["slow", "comfort"], scenes: ["UK_GREY_SUNDAY_INDOORS"], music: MUSIC.low },
  { id: "grey_monday", name: "grey monday morning", aliases: ["grey monday", "monday morning"], emotions: ["routine", "low energy"], scenes: ["FRESH_START_ALONE"], music: MUSIC.med },
  { id: "motorway_services", name: "motorway services", aliases: ["motorway services", "service station"], emotions: ["liminal", "reflection"], scenes: ["NOCTURNAL_ESCAPE_DRIVE"], music: MUSIC.lowMed },
  { id: "sixth_form", name: "sixth form", aliases: ["sixth form", "college days"], emotions: ["nostalgia", "youth"], scenes: ["NOSTALGIC_RETURN"], music: MUSIC.med },
  { id: "uni_halls", name: "uni halls", aliases: ["uni halls", "university halls"], emotions: ["freedom", "nostalgia"], scenes: ["NOSTALGIC_RETURN", "FRESH_START_ALONE"], music: MUSIC.med },
  { id: "bank_holiday", name: "bank holiday", aliases: ["bank holiday"], emotions: ["peace", "contentment"], scenes: ["UK_GREY_SUNDAY_INDOORS"], music: MUSIC.med },
];

writeDomain("uk-context", expandNodes(ukSeeds, "uk-context", 64));

// Manifest
const manifest = {
  version: 1,
  locale: "en-GB",
  domains: [
    "concepts",
    "environments",
    "emotions",
    "activities",
    "weather",
    "time",
    "social",
    "travel",
    "music-language",
    "phrase-patterns",
    "uk-context",
  ],
  pipeline: ["word/phrase", "context", "experience", "emotion", "music"],
};

writeFileSync(join(ROOT, "graph-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log("graph-manifest.json written");
console.log("concept graph expansion done");
