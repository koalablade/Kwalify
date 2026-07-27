/**
 * Generates universal human-language knowledge libraries.
 * Run: node backend/scripts/expand-universal-language.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "world-knowledge");

function writeJson(name, data) {
  writeFileSync(join(ROOT, name), `${JSON.stringify(data, null, 2)}\n`, "utf8");
  const count =
    data.phrases?.length ??
    data.library?.length ??
    data.entries?.length ??
    data.emotions?.length ??
    data.places?.length ??
    data.activities?.length ??
    data.contexts?.length ??
    data.movements?.length ??
    data.descriptors?.length ??
    0;
  console.log(`wrote ${name}: ${count} entries`);
}

function readJson(name) {
  return JSON.parse(readFileSync(join(ROOT, name), "utf8"));
}

function expandWithMods(seeds, mods, target, builder) {
  const out = [];
  let i = 0;
  while (out.length < target) {
    const seed = seeds[i % seeds.length];
    const mod = mods[Math.floor(i / seeds.length) % mods.length];
    out.push(builder(seed, mod, out.length));
    i += 1;
  }
  return out;
}

const MODS = [
  "at night",
  "in the rain",
  "on a sunday",
  "after work",
  "alone",
  "in summer",
  "in the city",
  "late at night",
  "early morning",
  "after midnight",
];

const MUSIC = {
  low: { energy: "low", tempo: "slow", texture: "soft intimate" },
  lowMed: { energy: "low-medium", tempo: "slow-medium", texture: "warm atmospheric" },
  med: { energy: "medium", tempo: "medium", texture: "open melodic" },
  high: { energy: "medium-high", tempo: "medium-fast", texture: "bright energetic" },
};

// ─── 1. COMMON LANGUAGE ─────────────────────────────────────────────────────

const LANGUAGE_SEEDS = [
  ["just chilling", "Relaxed downtime without pressure", ["peace", "contentment"], MUSIC.lowMed],
  ["taking it easy", "Slowing down and letting stress fade", ["relief", "peace"], MUSIC.low],
  ["clearing my head", "Taking time away from pressure to mentally reset", ["relief", "reflection", "peace"], MUSIC.lowMed],
  ["needed some space", "Creating distance to process feelings", ["reflection", "freedom"], MUSIC.lowMed],
  ["feeling lost", "Uncertain about direction in life", ["reflection", "anxiety"], MUSIC.low],
  ["feeling alive", "Sudden sense of vitality and presence", ["joy", "freedom"], MUSIC.high],
  ["in my feels", "Deep emotional openness", ["sadness", "reflection", "nostalgia"], MUSIC.low],
  ["vibing", "Casual positive mood without intensity", ["contentment", "joy"], MUSIC.med],
  ["late one", "Staying up deep into the night", ["reflection", "freedom"], MUSIC.lowMed],
  ["long day", "End-of-day fatigue needing unwind", ["exhaustion", "relief"], MUSIC.low],
  ["rough week", "Accumulated stress from a hard period", ["exhaustion", "anxiety"], MUSIC.low],
  ["fresh start", "Beginning again with optimism", ["hope", "anticipation"], MUSIC.med],
  ["starting over", "Rebuilding after change or loss", ["hope", "reflection"], MUSIC.lowMed],
  ["old times", "Remembering how things used to be", ["nostalgia", "bittersweet"], MUSIC.lowMed],
  ["good old days", "Warm memory of a simpler past", ["nostalgia", "joy"], MUSIC.med],
  ["throwback", "Deliberately revisiting the past", ["nostalgia"], MUSIC.med],
  ["back then", "Contrasting past self with now", ["nostalgia", "reflection"], MUSIC.lowMed],
  ["can't sleep", "Restless mind at night", ["anxiety", "reflection"], MUSIC.low],
  ["wide awake", "Alert when the world is asleep", ["restlessness", "reflection"], MUSIC.lowMed],
  ["lost in thought", "Deep internal processing", ["introspection", "reflection"], MUSIC.low],
  ["daydreaming", "Gentle mental wandering", ["peace", "nostalgia"], MUSIC.low],
  ["life is changing", "Awareness that nothing will stay the same", ["anticipation", "anxiety", "hope"], MUSIC.lowMed],
  ["weird calm", "Unsettling quiet after intensity", ["peace", "reflection"], MUSIC.low],
  ["summer ending", "Bittersweet close of a warm chapter", ["nostalgia", "bittersweet"], MUSIC.lowMed],
  ["everyone has gone home", "City or house emptied of people", ["loneliness", "reflection"], MUSIC.low],
  ["soundtrack to a summer", "Music that holds a season in memory", ["nostalgia", "joy"], MUSIC.med],
  ["miss who I was", "Grieving a past version of yourself", ["nostalgia", "longing"], MUSIC.low],
  ["thinking about life", "Big-picture existential reflection", ["introspection", "reflection"], MUSIC.low],
  ["realise your life is changing", "Sudden awareness of personal transition", ["anticipation", "anxiety"], MUSIC.lowMed],
  ["party finishes", "Strange calm after social energy fades", ["reflection", "loneliness"], MUSIC.low],
];

const commonLanguage = expandWithMods(LANGUAGE_SEEDS, MODS, 120, ([phrase, meaning, emotions, music], mod, i) => ({
  id: `lang_${i}`,
  phrase: mod === "alone" ? phrase : `${phrase} ${mod}`,
  cues: [phrase, mod === "alone" ? phrase : `${phrase} ${mod}`],
  meaning,
  emotions,
  situations: [],
  music,
}));

writeJson("common-language.json", { version: 1, locale: "en-GB", phrases: commonLanguage });

// ─── 2. EMOTIONS LIBRARY (500) ──────────────────────────────────────────────

const EMOTION_SEEDS = [
  ["peaceful", "Calm inner stillness", ["at peace", "serene", "still inside"], "WEATHER_REFLECTION", MUSIC.low],
  ["hopeful", "Quiet optimism about what comes next", ["looking forward", "things might work"], "FRESH_START_ALONE", MUSIC.med],
  ["excited", "Anticipatory energy before something good", ["buzzing", "can't wait"], "FRESH_START_ALONE", MUSIC.high],
  ["free", "Unburdened and open to possibility", ["liberated", "no plans"], "COASTAL_OPEN_ROAD", MUSIC.med],
  ["confident", "Assured without needing validation", ["self assured", "boss mode"], "FRESH_START_ALONE", MUSIC.high],
  ["content", "Satisfied with the present moment", ["could stay here", "just right"], "DOMESTIC_QUIET", MUSIC.lowMed],
  ["grateful", "Warm appreciation for what you have", ["thankful", "lucky"], "DOMESTIC_QUIET", MUSIC.med],
  ["inspired", "Creative spark and forward motion", ["motivated", "ideas flowing"], "FRESH_START_ALONE", MUSIC.med],
  ["nostalgic happiness", "Joy mixed with longing for the past", ["happy but sad", "warm memory"], "NOSTALGIC_RETURN", MUSIC.lowMed],
  ["lonely", "Feeling disconnected from others", ["on my own", "nobody around"], "LATE_NIGHT_SOLITARY_JOURNEY", MUSIC.low],
  ["overwhelmed", "Too much to carry at once", ["drowning", "can't cope"], "INTROSPECTIVE_PRIVACY", MUSIC.low],
  ["tired", "Physically or emotionally drained", ["knackered", "running on empty"], "DOMESTIC_QUIET", MUSIC.low],
  ["lost", "Uncertain where you belong", ["adrift", "no direction"], "MENTAL_RESET_WALK", MUSIC.low],
  ["anxious", "Nervous anticipation or worry", ["on edge", "stressed"], "INTROSPECTIVE_PRIVACY", MUSIC.lowMed],
  ["heartbroken", "Deep pain from loss or rejection", ["broken", "gutted"], "DEPARTURE_WALK", MUSIC.low],
  ["frustrated", "Blocked energy needing release", ["annoyed", "fed up"], "MENTAL_RESET_WALK", MUSIC.med],
  ["bittersweet", "Happiness and sadness at once", ["mixed feelings", "complicated"], "SUMMER_TRANSITION", MUSIC.lowMed],
  ["happy but sad", "Smiling through complicated emotion", ["smiling through tears"], "NOSTALGIC_RETURN", MUSIC.lowMed],
  ["missing something you cannot return to", "Longing for an unreachable past", ["can't go back", "gone forever"], "NOSTALGIC_RETURN", MUSIC.low],
  ["wanting change", "Ready for life to shift", ["need something different"], "FRESH_START_ALONE", MUSIC.med],
  ["scared but excited", "Nervous energy before a leap", ["butterflies", "new chapter nerves"], "FRESH_START_ALONE", MUSIC.med],
  ["feeling behind in life", "Comparing yourself to an imagined timeline", ["everyone else moved on"], "INTROSPECTIVE_PRIVACY", MUSIC.low],
  ["peaceful loneliness", "Alone but comfortable with the quiet", ["solitary peace"], "LATE_NIGHT_SOLITARY_JOURNEY", MUSIC.low],
  ["emotional release", "Letting feelings finally move through you", ["crying it out", "weight lifted"], "WEATHER_REFLECTION", MUSIC.lowMed],
  ["quiet confidence", "Calm self-assurance without performance", ["steady inside"], "FRESH_START_ALONE", MUSIC.med],
  ["acceptance", "Making peace with how things are", ["it is what it is"], "DOMESTIC_QUIET", MUSIC.lowMed],
  ["remembering who you used to be", "Confronting your past self", ["who was I", "used to be me"], "NOSTALGIC_RETURN", MUSIC.lowMed],
];

const emotionLibrary = expandWithMods(EMOTION_SEEDS, MODS, 500, ([name, desc, phrases, scene, music], mod, i) => ({
  id: `emo_lib_${i}`,
  name: mod === "alone" ? name : `${mod} ${name}`,
  description: desc,
  cues: [name, ...phrases, mod === "alone" ? name : `${mod} ${name}`],
  common_phrases: phrases,
  associated_scenes: [scene],
  music,
}));

const existingEmotions = readJson("emotions.json");
writeJson("emotions.json", {
  ...existingEmotions,
  version: 2,
  emotions: emotionLibrary,
});

// ─── 3. WEATHER CONTEXTS ────────────────────────────────────────────────────

const WEATHER_SEEDS = [
  ["rain", "Soft falling water creating enclosure", ["comfort", "sadness", "reflection", "isolation", "cinematic", "calm"], ["rain texture", "muffled", "glass"], MUSIC.lowMed],
  ["heavy rain", "Intense weather pressing inward", ["melancholy", "dramatic", "isolation"], ["loud rain", "enclosed"], MUSIC.low],
  ["drizzle", "Light persistent grey moisture", ["gentle sadness", "reflection"], ["soft wet", "grey"], MUSIC.low],
  ["snow", "Silent white stillness", ["childhood", "silence", "magic", "warmth"], ["soft crunch", "quiet"], MUSIC.lowMed],
  ["summer heat", "Warm air and open possibility", ["freedom", "adventure", "youth", "memories"], ["warm breeze", "golden"], MUSIC.med],
  ["autumn", "Cool air and fading colour", ["change", "nostalgia", "endings"], ["crisp air", "leaves"], MUSIC.lowMed],
  ["fog", "Obscured visibility and uncertainty", ["mystery", "uncertainty", "isolation"], ["muted", "soft edges"], MUSIC.low],
  ["storm", "Dramatic weather building tension", ["tension", "drama", "release"], ["thunder", "wind"], MUSIC.med],
  ["grey skies", "Overcast flat light", ["melancholy", "slow", "reflection"], ["flat light", "muted"], MUSIC.low],
  ["sunset", "Day closing with warm colour", ["bittersweet", "transition", "nostalgia"], ["golden light", "fading"], MUSIC.lowMed],
];

const weatherContexts = expandWithMods(WEATHER_SEEDS, MODS, 80, ([weather, visual, emotions, sensory, music], mod, i) => ({
  id: `weather_${i}`,
  weather,
  cues: [weather, `${weather} ${mod}`, `in the ${weather}`],
  visual_feeling: visual,
  emotional_association: emotions,
  sensory,
  music_direction: music,
}));

writeJson("weather-contexts.json", { version: 1, locale: "en-GB", entries: weatherContexts });

// ─── 4. PLACES ───────────────────────────────────────────────────────────────

const PLACE_FAMILIES = {
  home: [
    ["bedroom", "Private intimate personal space", ["introspection", "privacy", "nostalgia"], MUSIC.low],
    ["childhood home", "Return to formative domestic memory", ["nostalgia", "bittersweet"], MUSIC.lowMed],
    ["first apartment", "Early independence and new identity", ["hope", "freedom"], MUSIC.med],
    ["kitchen at night", "Domestic quiet after the day", ["peace", "reflection"], MUSIC.low],
    ["empty house", "Silence after people have gone", ["loneliness", "reflection"], MUSIC.low],
  ],
  city: [
    ["city streets", "Urban movement and anonymity", ["freedom", "reflection"], MUSIC.med],
    ["downtown", "Bright central energy", ["anticipation", "excitement"], MUSIC.med],
    ["alleyway", "Hidden urban intimacy", ["mystery", "introspection"], MUSIC.low],
    ["rooftop", "Elevated perspective over the city", ["freedom", "reflection"], MUSIC.med],
    ["neon streets", "Night city glow and motion", ["cinematic", "loneliness"], MUSIC.lowMed],
  ],
  travel: [
    ["motorway", "Long open road in motion", ["freedom", "reflection", "solitude"], MUSIC.lowMed],
    ["country road", "Slow scenic movement", ["peace", "nostalgia"], MUSIC.lowMed],
    ["train station", "Liminal waiting and departure", ["anticipation", "loneliness"], MUSIC.lowMed],
    ["airport", "Transition between worlds", ["anticipation", "anxiety"], MUSIC.med],
    ["hotel room", "Temporary anonymous shelter", ["loneliness", "reflection"], MUSIC.low],
    ["petrol station at midnight", "Temporary stop on a night journey", ["loneliness", "freedom", "reflection"], MUSIC.lowMed],
  ],
  nature: [
    ["forest", "Enclosed natural quiet", ["peace", "mystery"], MUSIC.low],
    ["beach", "Open horizon and memory", ["nostalgia", "peace", "freedom"], MUSIC.med],
    ["mountains", "Vast perspective and humility", ["awe", "reflection"], MUSIC.lowMed],
    ["lake", "Still reflective water", ["peace", "introspection"], MUSIC.low],
    ["field", "Open rural calm", ["freedom", "nostalgia"], MUSIC.lowMed],
  ],
  social: [
    ["pub", "Warm social gathering space", ["contentment", "nostalgia"], MUSIC.med],
    ["party", "High social energy", ["joy", "excitement"], MUSIC.high],
    ["concert", "Collective musical immersion", ["joy", "anticipation"], MUSIC.high],
    ["cafe", "Gentle public solitude", ["peace", "reflection"], MUSIC.lowMed],
  ],
};

const places = [];
let pIdx = 0;
for (const [family, seeds] of Object.entries(PLACE_FAMILIES)) {
  for (const mod of MODS) {
    for (const seed of seeds) {
      if (places.length >= 150) break;
      places.push({
        id: `place_${pIdx++}`,
        name: seed[0],
        family,
        cues: [seed[0], `${seed[0]} ${mod}`, `at the ${seed[0]}`],
        physical_description: seed[1],
        emotional_meaning: seed[2],
        typical_music: seed[3],
      });
    }
  }
}
while (places.length < 120) {
  const seed = PLACE_FAMILIES.travel[5];
  places.push({
    id: `place_${pIdx++}`,
    name: seed[0],
    family: "travel",
    cues: [seed[0]],
    physical_description: seed[1],
    emotional_meaning: seed[2],
    typical_music: seed[3],
  });
}

writeJson("places.json", { version: 1, locale: "en-GB", places: places.slice(0, 120) });

// ─── 5. ACTIVITIES LIBRARY ────────────────────────────────────────────────────

const ACTIVITY_SEEDS = [
  ["road trip", "Long journey for the sake of movement", ["freedom", "anticipation"], "moving", MUSIC.med],
  ["commuting", "Daily transition between worlds", ["exhaustion", "reflection"], "moving", MUSIC.lowMed],
  ["driving alone", "Private mobile solitude", ["reflection", "freedom"], "moving", MUSIC.lowMed],
  ["driving at night", "Nocturnal journey without destination", ["loneliness", "reflection"], "moving", MUSIC.lowMed],
  ["walking home", "Return journey after social end", ["reflection", "loneliness"], "moving", MUSIC.low],
  ["walking through a city", "Urban wandering when quiet", ["freedom", "reflection"], "moving", MUSIC.lowMed],
  ["walking in nature", "Grounding movement outdoors", ["peace", "relief"], "moving", MUSIC.lowMed],
  ["cooking", "Domestic creative routine", ["peace", "contentment"], "steady", MUSIC.lowMed],
  ["cleaning", "Resetting your physical space", ["relief", "reflection"], "steady", MUSIC.low],
  ["relaxing", "Deliberate rest and unwind", ["peace", "contentment"], "still", MUSIC.low],
  ["drawing", "Quiet creative focus", ["introspection", "peace"], "steady", MUSIC.low],
  ["writing", "Translating inner world to words", ["reflection", "introspection"], "steady", MUSIC.low],
  ["leaving a party", "Transition from social high to quiet", ["reflection", "loneliness"], "moving", MUSIC.low],
  ["running", "Physical release and motion", ["relief", "freedom"], "moving", MUSIC.high],
  ["cycling", "Rhythmic open-air movement", ["freedom", "joy"], "moving", MUSIC.med],
];

const activityLibrary = expandWithMods(ACTIVITY_SEEDS, MODS, 100, ([name, purpose, emotions, energy, music], mod, i) => ({
  id: `act_lib_${i}`,
  activity: name,
  cues: [name, `${name} ${mod}`],
  purpose,
  emotion: emotions,
  energy_level: energy,
  music_style: music,
}));

const existingActivities = readJson("activities.json");
writeJson("activities.json", { ...existingActivities, version: 2, library: activityLibrary });

// ─── 6. TIME CONTEXTS ─────────────────────────────────────────────────────────

const TIME_SEEDS = [
  ["morning", "Fresh start and quiet possibility", ["hopeful", "quiet", "fresh"], MUSIC.lowMed],
  ["afternoon", "Open active daylight hours", ["active", "open"], MUSIC.med],
  ["evening", "Day closing into reflection", ["reflection", "transition"], MUSIC.lowMed],
  ["night", "Privacy freedom and introspection", ["privacy", "freedom", "introspection"], MUSIC.lowMed],
  ["midnight", "Cinematic lonely dreamlike hour", ["cinematic", "lonely", "dreamlike"], MUSIC.low],
  ["2am", "Honest deep thoughts and nostalgia", ["honest", "nostalgia", "deep thoughts"], MUSIC.low],
  ["sunday", "Slow reset and comfort", ["slow", "reset", "comfort"], MUSIC.low],
  ["friday night", "Social energy and freedom", ["energy", "freedom"], MUSIC.high],
  ["dawn", "Fragile new beginning", ["hope", "peace"], MUSIC.low],
  ["golden hour", "Warm transitional light", ["nostalgia", "bittersweet"], MUSIC.lowMed],
];

const timeContexts = expandWithMods(TIME_SEEDS, ["in the city", "driving home", "alone", "after rain", "in summer"], 60, ([time, meaning, emotions, music], mod, i) => ({
  id: `time_${i}`,
  time,
  cues: [time, `${time} ${mod}`, `in the ${time}`],
  meaning,
  emotions,
  music_direction: music,
}));

writeJson("time-contexts.json", { version: 1, locale: "en-GB", contexts: timeContexts });

// ─── 7. SOCIAL CONTEXTS ─────────────────────────────────────────────────────

const SOCIAL_SEEDS = [
  ["first date", "Nervous hopeful meeting", ["anticipation", "anxiety"], MUSIC.med],
  ["breakup", "End of romantic connection", ["grief", "sadness"], MUSIC.low],
  ["friendship", "Warm platonic belonging", ["joy", "contentment"], MUSIC.med],
  ["reunion", "Reconnecting after time apart", ["nostalgia", "joy"], MUSIC.med],
  ["leaving friends", "Parting after shared time", ["sadness", "reflection"], MUSIC.lowMed],
  ["party ending", "Quiet after social peak", ["reflection", "loneliness"], MUSIC.low],
  ["alone after people leave", "Social aftermath solitude", ["loneliness", "reflection"], MUSIC.low],
  ["family memories", "Warm complicated domestic past", ["nostalgia", "bittersweet"], MUSIC.lowMed],
  ["childhood friendships", "Innocent formative bonds", ["nostalgia", "innocence"], MUSIC.med],
  ["meeting someone new", "Early connection uncertainty", ["anticipation", "hope"], MUSIC.med],
];

const socialContexts = expandWithMods(SOCIAL_SEEDS, MODS, 80, ([event, meaning, emotions, music], mod, i) => ({
  id: `social_${i}`,
  event,
  cues: [event, `${event} ${mod}`],
  meaning,
  emotion: emotions,
  music_direction: music,
}));

writeJson("social-contexts.json", { version: 1, locale: "en-GB", contexts: socialContexts });

// ─── 8. MOVEMENT ────────────────────────────────────────────────────────────

const MOVEMENT_SEEDS = [
  ["leaving", "Departing from a place or chapter", ["sadness", "anticipation"], MUSIC.lowMed],
  ["arriving", "Reaching a destination", ["relief", "anticipation"], MUSIC.med],
  ["going somewhere", "Forward motion with purpose", ["anticipation", "freedom"], MUSIC.med],
  ["coming home", "Return to familiar shelter", ["relief", "contentment"], MUSIC.lowMed],
  ["getting lost", "Disorientation that opens possibility", ["anxiety", "freedom"], MUSIC.lowMed],
  ["wandering", "Aimless reflective movement", ["reflection", "freedom"], MUSIC.lowMed],
  ["exploring", "Curious discovery", ["anticipation", "joy"], MUSIC.med],
  ["taking the long way home", "Avoidance reflection and transition", ["avoidance", "reflection", "freedom"], MUSIC.lowMed],
  ["driving nowhere", "Motion without destination for space", ["freedom", "reflection"], MUSIC.lowMed],
  ["walking until you feel better", "Movement as emotional reset", ["relief", "reflection"], MUSIC.lowMed],
];

const movements = expandWithMods(MOVEMENT_SEEDS, MODS, 80, ([movement, meaning, emotions, music], mod, i) => ({
  id: `move_${i}`,
  movement,
  cues: [movement, `${movement} ${mod}`],
  meaning,
  emotion: emotions,
  music_direction: music,
}));

writeJson("movement.json", { version: 1, locale: "en-GB", movements });

// ─── 9. SENSORY LANGUAGE ────────────────────────────────────────────────────

const SENSORY_SEEDS = [
  ["golden light", "visual", ["nostalgia", "warmth", "transition"], MUSIC.lowMed],
  ["neon glow", "visual", ["night", "urban", "cinematic"], MUSIC.lowMed],
  ["streetlights reflecting", "visual", ["night", "rain", "reflection"], MUSIC.lowMed],
  ["empty roads", "visual", ["solitude", "freedom"], MUSIC.lowMed],
  ["blurry lights", "visual", ["dreamlike", "motion"], MUSIC.low],
  ["rain tapping", "sound", ["calm", "intimacy"], MUSIC.low],
  ["distant traffic", "sound", ["urban", "loneliness"], MUSIC.lowMed],
  ["quiet room", "sound", ["peace", "introspection"], MUSIC.low],
  ["crowd noise", "sound", ["energy", "social"], MUSIC.high],
  ["cold air", "touch", ["clarity", "transition"], MUSIC.lowMed],
  ["warm blanket", "touch", ["comfort", "safety"], MUSIC.low],
  ["summer breeze", "touch", ["freedom", "nostalgia"], MUSIC.med],
  ["coffee smell", "smell", ["morning", "comfort"], MUSIC.lowMed],
  ["rain smell", "smell", ["nostalgia", "calm"], MUSIC.low],
  ["old books", "smell", ["nostalgia", "introspection"], MUSIC.low],
  ["city lights passing by", "visual", ["motion", "reflection", "night"], MUSIC.lowMed],
];

const sensoryLanguage = expandWithMods(SENSORY_SEEDS, MODS, 120, ([desc, sense, emotions, music], mod, i) => ({
  id: `sense_lang_${i}`,
  description: desc,
  sense,
  cues: [desc, `${desc} ${mod}`],
  atmosphere: emotions,
  emotional_links: emotions,
  music_direction: music,
}));

writeJson("sensory-language.json", { version: 1, locale: "en-GB", entries: sensoryLanguage });

// ─── 10. MUSIC DESCRIPTORS ────────────────────────────────────────────────────

const MUSIC_DESCRIPTOR_SEEDS = [
  ["chill", ["relaxed", "low energy", "smooth"], MUSIC.lowMed],
  ["sad", ["heartbreak", "nostalgia", "peaceful sadness"], MUSIC.low],
  ["happy", ["energetic", "joyful", "nostalgic happiness"], MUSIC.med],
  ["cinematic", ["emotional build", "atmosphere", "storytelling"], MUSIC.lowMed],
  ["dark", ["minor", "mysterious", "intense"], MUSIC.low],
  ["dreamy", ["washed textures", "slow", "floating"], MUSIC.low],
  ["ambient", ["atmospheric", "spacious", "calm"], MUSIC.low],
  ["upbeat", ["energetic", "bright", "danceable"], MUSIC.high],
  ["melancholy", ["wistful", "slow", "emotional"], MUSIC.low],
  ["cosy", ["warm", "intimate", "soft"], MUSIC.low],
  ["epic", ["building", "dramatic", "expansive"], MUSIC.med],
  ["raw", ["honest", "sparse", "emotional"], MUSIC.low],
];

const musicDescriptors = expandWithMods(MUSIC_DESCRIPTOR_SEEDS, ["vibes", "music", "songs", "playlist", "sound"], 60, ([word, meanings, music], mod, i) => ({
  id: `music_desc_${i}`,
  word,
  cues: [word, `${word} ${mod}`, `something ${word}`],
  meanings,
  music_translation: music,
}));

writeJson("music-descriptors.json", { version: 1, locale: "en-GB", descriptors: musicDescriptors });

// ─── 11. UK CONTEXT ─────────────────────────────────────────────────────────

const UK_SEEDS = [
  ["grey skies", "weather", ["melancholy", "slow", "reflection"], MUSIC.low],
  ["rainy afternoon", "weather", ["shelter", "inward", "cosy"], MUSIC.low],
  ["motorway services", "place", ["liminal", "pause", "journey"], MUSIC.lowMed],
  ["seaside town", "place", ["nostalgia", "quiet", "open air"], MUSIC.lowMed],
  ["high street", "place", ["everyday", "community", "familiar"], MUSIC.med],
  ["council estate", "place", ["youth", "nostalgia", "community"], MUSIC.med],
  ["countryside lane", "place", ["peace", "freedom", "rural"], MUSIC.lowMed],
  ["first car", "life", ["freedom", "youth", "independence"], MUSIC.med],
  ["passing driving test", "life", ["relief", "pride", "freedom"], MUSIC.med],
  ["sixth form", "life", ["youth", "anticipation", "nostalgia"], MUSIC.med],
  ["university halls", "life", ["freedom", "loneliness", "new chapter"], MUSIC.med],
  ["moving away", "life", ["bittersweet", "hope"], MUSIC.lowMed],
  ["pub closing time", "culture", ["transition", "night air"], MUSIC.med],
  ["last train", "culture", ["ending", "reflection", "loneliness"], MUSIC.lowMed],
  ["bank holiday", "culture", ["slow", "freedom", "comfort"], MUSIC.med],
  ["summer evening", "culture", ["nostalgia", "warmth", "ease"], MUSIC.med],
  ["walking home alone", "culture", ["reflection", "loneliness"], MUSIC.low],
];

const ukContext = expandWithMods(UK_SEEDS, MODS, 100, ([name, category, emotions, music], mod, i) => ({
  id: `uk_${i}`,
  name,
  category,
  cues: [name, `${name} ${mod}`],
  concepts: [category, mod],
  emotion: emotions,
  music,
}));

writeJson("uk-context.json", { version: 1, locale: "en-GB", entries: ukContext });

console.log("universal language expansion done");
