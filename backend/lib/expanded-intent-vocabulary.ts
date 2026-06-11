export type GenreAliasGroup = { family: string; terms: string[] };

const COMMON_MISSPELLINGS: Record<string, string[]> = {
  americana: ["americarna", "americanna", "americanana"],
  country: ["county", "cuntry", "counrty"],
  acoustic: ["accoustic", "acustic", "acuostic"],
  melancholic: ["melancolic", "melanchloic"],
  nostalgic: ["nostaligic", "nostaligia", "nostalga"],
  euphoric: ["euforic", "euphric"],
  energetic: ["energic", "energetik"],
  energised: ["energised", "energized", "energisd"],
  relaxed: ["relxed", "relaxxed"],
  anxious: ["anxious", "anxius", "anxietous"],
  morning: ["mornin", "mourning"],
  afternoon: ["arvo", "aftanoon"],
  evening: ["evenin"],
  midnight: ["midnite"],
  motorway: ["motoway"],
  warehouse: ["wearhouse"],
  festival: ["fest", "festie", "festi"],
  halloween: ["hallowen", "haloween"],
  christmas: ["xmas", "chrimbo", "christmass"],
  valentine: ["valentines", "valentines day", "valentine's"],
};

const FUZZY_TOKEN_MIN_LENGTH = 5;
const FUZZY_TOKEN_MAX_LENGTH = 18;

export const EXPANDED_GENRE_ALIASES: GenreAliasGroup[] = [
  { family: "country", terms: ["american country", "americana", "americarna", "red dirt", "red-dirt", "redirt", "cowboy", "bro country", "neo traditional country", "neotraditional country", "texas country", "oklahoma country", "red dirt country", "cowboy country", "country western", "western swing", "truck songs", "beer drinking country", "country rock", "country folk", "roots country", "appalachian", "old-time", "old time", "country gospel"] },
  { family: "hip_hop", terms: ["conscious rap", "gangsta rap", "southern rap", "atlanta rap", "miami bass", "crunk", "hyphy", "jerk rap", "cloud rap", "rage rap", "phonk", "uk drill", "ukdrill", "grime", "uk rap", "british rap", "london rap", "road rap", "afroswing", "afro swing", "jersey club rap", "pluggnb", "sample drill"] },
  { family: "rock", terms: ["garage rock", "surf rock", "psychedelic rock", "prog rock", "progressive rock", "southern rock", "heartland rock", "college rock", "post punk", "post-punk", "new wave", "no wave", "math rock", "noise rock", "art rock", "britpop", "brit pop", "lad rock", "madchester", "baggy", "shoegaze", "ska punk", "pop punk", "midwest emo", "slowcore", "dream pop"] },
  { family: "electronic", terms: ["uk garage", "ukg", "2-step", "two step garage", "speed garage", "future garage", "bassline", "donk", "breakbeat", "breaks", "idm", "glitch", "downtempo", "trip hop", "trip-hop", "chillout", "deep house", "tech house", "progressive house", "acid house", "electro", "electroclash", "minimal techno", "hard techno", "gabber", "hardstyle", "happy hardcore", "breakcore", "liquid dnb", "neurofunk", "footwork", "juke", "jersey club", "future bass", "wave", "vaporwave", "hyperpop", "pc music"] },
  { family: "jazz", terms: ["cool jazz", "hard bop", "post bop", "modal jazz", "free jazz", "spiritual jazz", "jazz fusion", "acid jazz", "nu jazz", "gypsy jazz", "dixieland", "ragtime", "big band", "jazz funk"] },
  { family: "pop", terms: ["art pop", "baroque pop", "power pop", "dream pop", "bubblegum pop", "electropop", "hyperpop", "bedroom pop", "chamber pop", "jangle pop", "city pop", "mandopop", "cantopop", "j-pop", "jpop", "british pop", "britpop pop", "latin pop", "europop", "disco pop", "alt pop"] },
  { family: "folk", terms: ["indie folk", "freak folk", "psych folk", "folk rock", "anti folk", "americana folk", "protest folk", "british folk", "scottish folk", "welsh folk", "nordic folk", "sea shanty", "shanties"] },
  { family: "soul", terms: ["northern soul", "southern soul", "memphis soul", "philly soul", "psychedelic soul", "quiet storm", "boogie", "disco", "p-funk", "p funk", "funk rock"] },
  { family: "metal", terms: ["doom metal", "sludge metal", "stoner metal", "power metal", "symphonic metal", "progressive metal", "prog metal", "folk metal", "industrial metal", "post metal", "post-metal", "metallic hardcore", "blackgaze", "grindcore", "speed metal"] },
  { family: "classical", terms: ["romantic classical", "modern classical", "minimalism", "minimalist classical", "neoclassical", "choral", "requiem", "aria", "string quartet", "solo piano", "film orchestra", "ballet", "renaissance", "impressionist classical"] },
  { family: "indie", terms: ["indietronica", "indie sleaze", "twee", "twee pop", "slacker rock", "lo-fi indie", "lofi indie", "hypnagogic pop", "cassette pop", "chillwave", "glo-fi", "sad indie", "rainy indie"] },
  { family: "blues", terms: ["texas blues", "piedmont blues", "country blues", "jump blues", "swamp blues", "soul blues", "boogie woogie", "boogie-woogie"] },
  { family: "rnb", terms: ["90s r&b", "2000s r&b", "slow jams", "bedroom r&b", "trap soul", "pbr&b", "pbrnb", "quiet storm r&b", "uk r&b", "british r&b", "new jack"] },
  { family: "reggae", terms: ["lovers rock", "ska", "two tone", "2 tone", "reggae fusion", "dub reggae", "digital dancehall", "conscious reggae"] },
  { family: "latin", terms: ["corridos", "corridos tumbados", "regional mexican", "norteño", "norteno", "banda", "mariachi", "ranchera", "son cubano", "bolero", "mambo", "cha cha", "latin rock", "bossa", "mpb", "tropicalia", "urbano latino", "dembow"] },
  { family: "soundtrack", terms: ["anime ost", "anime soundtrack", "video game music", "vgm", "game score", "disney soundtrack", "musical theatre", "broadway", "west end", "trailer music", "epic score"] },
  { family: "world", terms: ["k afrobeat", "afro house", "afro tech", "gqom", "kuduro", "soukous", "rai", "gnawa", "qawwali", "bollywood", "bhangra", "desi pop", "korean ballad", "enka", "city pop", "c-pop", "c pop", "fado", "flamenco", "klezmer"] },
  { family: "christmas", terms: ["christmas jazz", "christmas pop", "christmas classics", "holiday classics", "winter songs", "advent", "carols", "christmas carols"] },
];

export const EXPANDED_MOOD_TERMS: Record<string, string[]> = {
  melancholic: ["sad", "melancholy", "melancholic", "blue", "lonely", "heartbroken", "heartbreak", "grief", "crying", "tearful", "wistful", "bittersweet", "yearning", "longing", "empty", "hollow", "aching", "devastated", "gutted", "proper sad", "down bad", "mardy", "fed up"],
  warm: ["warm", "cozy", "cosy", "golden", "sunny", "comforting", "comfort", "tender", "soft", "gentle", "glowing", "homey", "homely", "safe", "romantic", "sweet", "lovely", "wholesome"],
  introspective: ["introspective", "reflective", "thinking", "overthinking", "pensive", "contemplative", "diary", "private", "alone", "solitude", "existential", "spiral", "processing", "in my head", "head full", "over it"],
  nostalgic: ["nostalgic", "nostalgia", "throwback", "retro", "vintage", "old memories", "childhood", "teenage", "school days", "uni days", "sixth form", "remember", "reminiscent", "memory lane"],
  energised: ["hype", "hyped", "energised", "energized", "adrenaline", "pump up", "pumped", "intense", "explosive", "fired up", "buzzing", "gassed", "party", "rave", "mosh", "gym", "workout"],
  calm: ["calm", "peaceful", "serene", "relaxed", "sleepy", "sleep", "quiet", "still", "meditative", "ambient", "floating", "drifting", "soft focus", "chilled", "chill", "chillout", "easy", "easygoing"],
  dark: ["dark", "gothic", "noir", "ominous", "haunting", "eerie", "shadowy", "brooding", "menacing", "sinister", "moody", "grim"],
  euphoric: ["euphoric", "ecstatic", "bliss", "joyful", "triumphant", "uplifting", "celebratory", "victorious", "hands in the air", "buzzing", "on top of the world"],
  angry: ["angry", "rage", "furious", "aggressive", "vengeful", "pissed", "pissed off", "fuming", "wound up", "livid", "resentful", "defiant", "rebellious"],
};

export const EXPANDED_ACTIVITY_TERMS: Record<string, string[]> = {
  driving: ["drive", "driving", "road trip", "highway", "motorway", "freeway", "cruise", "night drive", "dirt road", "backroads", "car ride", "m25", "a road", "b road"],
  workout: ["gym", "workout", "running", "run", "jogging", "lifting", "weights", "cardio", "sprint", "cycling", "boxing", "training", "five a side", "5 a side", "football training", "netball", "rugby training"],
  focus: ["study", "studying", "focus", "coding", "deep work", "writing", "reading", "homework", "revision", "revising", "coursework", "concentration"],
  party: ["party", "pregame", "pre game", "pres", "pre drinks", "pre-drinks", "sesh", "session", "club", "nightclub", "dancefloor", "festival", "rave", "house party", "celebration", "night out", "pub", "pub night", "beer garden"],
  sleep: ["sleep", "bedtime", "nap", "insomnia", "fall asleep", "wind down", "lullaby", "kip"],
  cleaning: ["cleaning", "clean room", "laundry", "washing", "chores", "tidying", "tidy", "reset day"],
  travel: ["flight", "airport", "train", "bus", "commute", "walking", "walk", "transit", "subway", "tube", "underground", "tram", "coach", "rail", "national rail"],
};

export const EXPANDED_TIME_TERMS: Record<"morning" | "afternoon" | "evening" | "late_night", string[]> = {
  morning: ["morning", "mornin", "sunrise", "dawn", "breakfast", "early morning", "waking up", "commute morning", "school run"],
  afternoon: ["afternoon", "arvo", "midday", "noon", "daytime", "lunch", "lunchtime", "sunny day", "lazy afternoon", "sunday afternoon"],
  evening: ["evening", "evenin", "sunset", "golden hour", "dusk", "twilight", "after work", "tea time", "teatime", "dinner"],
  late_night: ["late night", "late-night", "midnight", "midnite", "after dark", "2am", "3am", "4am", "night bus", "night tube", "last train", "night drive", "witching hour", "insomnia"],
};

export const EXPANDED_PLACE_TERMS: Record<"rural" | "outdoors" | "city" | "beach" | "bedroom" | "car", string[]> = {
  rural: ["rural", "country road", "small town", "village", "cowboy", "western", "red dirt", "farm", "fields", "countryside", "desert", "prairie", "barn", "truck stop"],
  outdoors: ["outdoors", "outside", "forest", "woods", "mountain", "campfire", "trail", "hiking", "walking", "lake", "river", "open air", "rain", "storm", "park", "common", "moor", "dales"],
  city: ["city", "urban", "downtown", "town centre", "city centre", "subway", "street", "nightclub", "skyscraper", "neon", "alley", "rooftop", "warehouse", "london", "manchester", "birmingham", "leeds", "glasgow", "bristol", "liverpool", "newcastle", "cardiff", "edinburgh", "nottingham", "sheffield"],
  beach: ["beach", "coast", "coastal", "seaside", "pier", "island", "summer", "poolside", "ocean", "sea", "surf", "tropical", "brighton", "cornwall", "devon"],
  bedroom: ["bedroom", "room", "alone", "private", "diary", "window", "floor", "flat", "apartment", "uni room", "halls", "dorm"],
  car: ["car", "drive", "driving", "road trip", "motorway", "highway", "cruise", "backseat", "passenger seat", "passenger princess"],
};

export const EXPANDED_EVENT_TERMS = [
  "wedding", "breakup", "divorce", "first date", "date night", "graduation", "prom", "freshers", "freshers week", "homecoming",
  "funeral", "wake", "birthday", "house party", "festival", "afterparty", "pre game", "pregame", "pres", "pre drinks",
  "christmas", "xmas", "chrimbo", "new year", "new year's", "halloween", "bonfire night", "guy fawkes", "valentine", "summer holiday", "holiday", "vacation",
  "road trip", "moving house", "leaving home", "coming home", "exam season", "finals", "revision", "results day", "game day", "football", "match day", "bank holiday", "boxing day", "easter", "eurovision",
];

export const EXPANDED_ERA_TERMS: Array<{ label: string; start: number; end: number; terms: string[]; aesthetic: string }> = [
  { label: "40s", start: 1940, end: 1949, terms: ["1940s", "40s", "forties", "wartime", "big band era"], aesthetic: "wartime big band, crooners, early jazz-pop warmth" },
  { label: "50s", start: 1950, end: 1959, terms: ["1950s", "50s", "fifties", "rock and roll era", "doo wop era"], aesthetic: "doo-wop, early rock and roll, jukebox Americana" },
  { label: "60s", start: 1960, end: 1969, terms: ["1960s", "1960's", "60s", "60's", "sixties", "british invasion", "psychedelic era", "mod era"], aesthetic: "psychedelia, folk-rock, British invasion, bright analogue" },
  { label: "70s", start: 1970, end: 1979, terms: ["1970s", "1970's", "70s", "70's", "seventies", "disco era", "classic rock era", "punk era"], aesthetic: "warm funk, disco, punk, expansive analogue rock" },
  { label: "80s", start: 1980, end: 1989, terms: ["1980s", "1980's", "80s", "80's", "eighties", "new wave era", "hair metal era", "synth era", "mtv era"], aesthetic: "neon synths, new wave, gated drums, cinematic gloss" },
  { label: "90s", start: 1990, end: 1999, terms: ["1990s", "1990's", "90s", "90's", "nineties", "grunge era", "britpop era", "golden age hip hop"], aesthetic: "grunge, alt-rock, boom bap, neo-soul, raw crossover emotion" },
  { label: "00s", start: 2000, end: 2009, terms: ["2000s", "2000's", "00s", "00's", "noughties", "naughties", "aughts", "y2k", "myspace era", "ipod era"], aesthetic: "Y2K gloss, pop punk, emo, ringtone rap, post-punk revival" },
  { label: "10s", start: 2010, end: 2019, terms: ["2010s", "twenty tens", "tens", "tumblr era", "bloghouse revival", "edm era"], aesthetic: "streaming-era indie, EDM crossover, tumblr pop, trap bloom" },
  { label: "20s", start: 2020, end: 2029, terms: ["2020s", "twenty twenties", "twenties", "pandemic era", "tiktok era"], aesthetic: "hyperpop-adjacent, genre-fluid, lo-fi and emotionally complex" },
];

export function termRegex(terms: string[]): RegExp {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const typoVariants = (token: string): string[] => {
    if (
      !/^[a-z]+$/i.test(token) ||
      token.length < FUZZY_TOKEN_MIN_LENGTH ||
      token.length > FUZZY_TOKEN_MAX_LENGTH
    ) {
      return [];
    }

    const lower = token.toLowerCase();
    const variants = new Set<string>();
    for (let i = 0; i < lower.length; i++) {
      variants.add(`${lower.slice(0, i)}[a-z]${lower.slice(i + 1)}`);
      variants.add(`${lower.slice(0, i)}${lower.slice(i + 1)}`);
      variants.add(`${lower.slice(0, i)}[a-z]${lower.slice(i)}`);
      if (i < lower.length - 1) {
        variants.add(`${lower.slice(0, i)}${lower[i + 1]}${lower[i]}${lower.slice(i + 2)}`);
      }
    }
    return [...variants];
  };
  const tokenPattern = (token: string): string => {
    const escaped = escape(token);
    if (!/^[a-z]+$/i.test(token) || token.length < FUZZY_TOKEN_MIN_LENGTH) return escaped;
    const misspellings = COMMON_MISSPELLINGS[token.toLowerCase()] ?? [];
    const variants = [...typoVariants(token), ...misspellings.map(escape)];
    return `(?:${escaped}${variants.length ? `|${variants.join("|")}` : ""})`;
  };
  const source = terms
    .flatMap((term) => [term, ...(COMMON_MISSPELLINGS[term.toLowerCase()] ?? [])])
    .map((term) => term.trim().split(/[\s_-]+/).filter(Boolean).map(tokenPattern).join("[\\s_-]*"))
    .join("|");
  if (!source) return /a^/i;
  return new RegExp(`\\b(?:${source})\\b`, "i");
}
