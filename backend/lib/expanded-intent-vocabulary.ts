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
  morning: ["mornin"],
  afternoon: ["arvo", "aftanoon"],
  evening: ["evenin"],
  midnight: ["midnite", "nite"],
  night: ["nite"],
  driving: ["driv", "drivin"],
  drive: ["driv"],
  motorway: ["motoway"],
  warehouse: ["wearhouse"],
  festival: ["fest", "festie", "festi"],
  halloween: ["hallowen", "haloween"],
  christmas: ["xmas", "chrimbo", "christmass"],
  valentine: ["valentines", "valentines day", "valentine's"],
};

const TERM_REGEX_CACHE_MAX = 1000;
const termRegexCache = new Map<string, RegExp>();

export const EXPANDED_GENRE_ALIASES: GenreAliasGroup[] = [
  { family: "country", terms: ["american country", "americana", "americarna", "red dirt", "red-dirt", "redirt", "cowboy", "bro country", "neo traditional country", "neotraditional country", "texas country", "oklahoma country", "red dirt country", "cowboy country", "country western", "western swing", "truck songs", "beer drinking country", "country rock", "country folk", "roots country", "appalachian", "old-time", "old time", "country gospel"] },
  { family: "hip_hop", terms: ["conscious rap", "gangsta rap", "southern rap", "atlanta rap", "miami bass", "crunk", "hyphy", "jerk rap", "cloud rap", "rage rap", "phonk", "drift phonk", "gym phonk", "aggressive phonk", "uk drill", "ukdrill", "uk drill gym", "melodic drill", "sample drill", "road rap", "grime", "grime classics", "grime workout", "uk rap", "british rap", "london rap", "london drill", "afroswing", "afro swing", "jersey club rap", "pluggnb"] },
  { family: "rock", terms: ["garage rock", "surf rock", "psychedelic rock", "prog rock", "progressive rock", "southern rock", "heartland rock", "college rock", "post punk", "post-punk", "new wave", "no wave", "math rock", "noise rock", "art rock", "britpop", "brit pop", "lad rock", "madchester", "baggy", "shoegaze", "ska punk", "pop punk", "midwest emo", "slowcore", "dream pop"] },
  { family: "electronic", terms: ["uk garage", "ukg", "uk garage chill", "ukg chill", "ukg drive", "late night ukg", "2-step", "2 step", "two step garage", "speed garage", "night bus garage", "future garage", "bassline", "uk bassline", "niche bassline", "donk", "breakbeat", "breaks", "jungle", "jungle classics", "dark jungle", "ragga jungle", "atmospheric jungle", "oldschool jungle", "old school jungle", "old skool jungle", "breakbeat hardcore", "idm", "glitch", "downtempo", "trip hop", "trip-hop", "chillout", "deep house", "tech house", "progressive house", "acid house", "electro", "electroclash", "minimal techno", "hard techno", "hardgroove", "hard groove", "schranz", "tekk", "tekno", "techno", "industrial techno", "warehouse techno", "warehouse rave", "rave techno", "ravey", "ravey stuff", "old school ravey", "hard rave", "industrial rave", "driving techno", "driving tekk", "hard trance", "90s trance", "nineties trance", "classic trance", "euro trance", "uplifting trance", "progressive trance", "goa trance", "psytrance", "acid trance", "dream trance", "driving trance", "dubstep", "old school dubstep", "oldschool dubstep", "old skool dubstep", "uk dubstep", "deep dubstep", "dubstep classics", "post-dubstep", "brostep", "bloghouse", "blog house", "electro bloghouse", "indie dance", "nu rave", "new rave", "ed banger", "blog era electro", "myspace electro", "french electro", "gabber", "hardstyle", "happy hardcore", "breakcore", "liquid dnb", "liquid drum and bass", "drum n bass", "drum'n'bass", "neurofunk", "footwork", "juke", "jersey club", "future bass", "wave", "vaporwave", "hyperpop", "pc music"] },
  { family: "jazz", terms: ["cool jazz", "hard bop", "post bop", "modal jazz", "free jazz", "spiritual jazz", "jazz fusion", "acid jazz", "nu jazz", "gypsy jazz", "dixieland", "ragtime", "big band", "jazz funk"] },
  { family: "pop", terms: ["art pop", "baroque pop", "power pop", "bubblegum pop", "electropop", "bedroom pop", "chamber pop", "jangle pop", "city pop", "japanese city pop", "tokyo city pop", "late night city pop", "80s city pop", "citypop", "city-pop", "mandopop", "cantopop", "j-pop", "jpop", "british pop", "britpop pop", "latin pop", "europop", "disco pop", "alt pop"] },
  { family: "folk", terms: ["indie folk", "freak folk", "psych folk", "folk rock", "anti folk", "americana folk", "protest folk", "british folk", "scottish folk", "welsh folk", "nordic folk", "sea shanty", "shanties"] },
  { family: "soul", terms: ["northern soul", "southern soul", "memphis soul", "philly soul", "psychedelic soul", "quiet storm", "boogie", "disco", "p-funk", "p funk", "funk rock"] },
  { family: "metal", terms: ["doom metal", "sludge metal", "stoner metal", "power metal", "symphonic metal", "progressive metal", "prog metal", "folk metal", "industrial metal", "post metal", "post-metal", "metallic hardcore", "blackgaze", "grindcore", "speed metal"] },
  { family: "classical", terms: ["romantic classical", "modern classical", "minimalism", "minimalist classical", "neoclassical", "choral", "requiem", "aria", "string quartet", "solo piano", "film orchestra", "ballet", "renaissance", "impressionist classical"] },
  { family: "indie", terms: ["indietronica", "indie sleaze", "twee", "twee pop", "slacker rock", "lo-fi indie", "lofi indie", "hypnagogic pop", "cassette pop", "chillwave", "glo-fi", "sad indie", "rainy indie"] },
  { family: "blues", terms: ["texas blues", "piedmont blues", "country blues", "jump blues", "swamp blues", "soul blues", "boogie woogie", "boogie-woogie"] },
  { family: "rnb", terms: ["90s r&b", "2000s r&b", "slow jams", "bedroom r&b", "trap soul", "pbr&b", "pbrnb", "quiet storm r&b", "uk r&b", "british r&b", "new jack"] },
  { family: "reggae", terms: ["lovers rock", "ska", "two tone", "2 tone", "reggae fusion", "dub reggae", "digital dancehall", "conscious reggae", "roots reggae", "beach reggae", "sunset reggae", "island reggae", "summer reggae", "reggae dub", "rocksteady", "ragga", "dubwise", "one drop", "rub-a-dub"] },
  { family: "latin", terms: ["corridos", "corridos tumbados", "regional mexican", "norteño", "norteno", "banda", "mariachi", "ranchera", "son cubano", "bolero", "mambo", "cha cha", "latin rock", "bossa", "mpb", "tropicalia", "urbano latino", "dembow"] },
  { family: "soundtrack", terms: ["anime ost", "anime soundtrack", "video game music", "vgm", "game score", "disney soundtrack", "musical theatre", "broadway", "west end", "trailer music", "epic score"] },
  { family: "world", terms: ["k afrobeat", "afro house", "afro tech", "gqom", "kuduro", "soukous", "rai", "gnawa", "qawwali", "bollywood", "bhangra", "desi pop", "korean ballad", "enka", "c-pop", "c pop", "fado", "flamenco", "klezmer"] },
  { family: "christmas", terms: ["christmas jazz", "christmas pop", "christmas classics", "holiday classics", "winter songs", "advent", "carols", "christmas carols"] },
];

export const EXPANDED_MOOD_TERMS: Record<string, string[]> = {
  melancholic: ["sad", "melancholy", "melancholic", "mourning", "blue", "lonely", "heartbroken", "heartbreak", "grief", "crying", "tearful", "wistful", "bittersweet", "yearning", "longing", "empty", "hollow", "aching", "devastated", "gutted", "proper sad", "down bad", "mardy", "fed up"],
  warm: ["warm", "cozy", "cosy", "golden", "sunny", "happy", "comforting", "comfort", "tender", "soft", "gentle", "glowing", "homey", "homely", "safe", "romantic", "sweet", "lovely", "wholesome"],
  introspective: ["introspective", "reflective", "thinking", "overthinking", "pensive", "contemplative", "diary", "private", "alone", "solitude", "existential", "spiral", "processing", "in my head", "head full", "over it"],
  nostalgic: ["nostalgic", "nostalgia", "throwback", "retro", "vintage", "old memories", "childhood", "teenage", "school days", "uni days", "sixth form", "remember", "reminiscent", "memory lane"],
  energised: ["hype", "hyped", "happy", "upbeat", "energised", "energized", "adrenaline", "pump up", "pumped", "intense", "explosive", "fired up", "buzzing", "gassed", "hard", "vibey but hard"],
  calm: ["calm", "calmly", "peaceful", "serene", "relaxed", "sleepy", "sleep", "quiet", "still", "winter", "snowy", "snow", "meditative", "ambient", "floating", "drifting", "soft focus", "chilled", "chill", "chillout", "easy", "easygoing"],
  dark: ["dark", "gothic", "noir", "ominous", "haunting", "eerie", "shadowy", "brooding", "menacing", "sinister", "moody", "grim"],
  euphoric: ["euphoric", "ecstatic", "bliss", "joyful", "triumphant", "uplifting", "celebratory", "victorious", "hands in the air", "buzzing", "on top of the world"],
  angry: ["angry", "rage", "furious", "aggressive", "vengeful", "pissed", "pissed off", "fuming", "wound up", "livid", "resentful", "defiant", "rebellious"],
};

export const EXPANDED_ACTIVITY_TERMS: Record<string, string[]> = {
  driving: ["drive", "driving", "driv", "drivin", "road trip", "highway", "motorway", "freeway", "cruise", "night drive", "nite drive", "late night motorway", "motorway in the rain", "dirt road", "backroads", "car ride", "m25", "a road", "b road"],
  workout: ["gym", "workout", "running", "run", "jogging", "lifting", "weights", "cardio", "sprint", "cycling", "boxing", "training", "five a side", "5 a side", "football training", "netball", "rugby training"],
  focus: ["study", "studying", "focus", "coding", "deep work", "writing", "reading", "homework", "revision", "revising", "coursework", "concentration", "working in the garage", "garage day", "fixing my car", "fixing cars", "fixing my volvo", "working on cars", "working on my car", "working on motorcycles", "working on motorbikes", "welding", "workshop"],
  party: ["party", "pregame", "pre game", "pres", "pre drinks", "pre-drinks", "sesh", "session", "club", "nightclub", "dancefloor", "festival", "rave", "house party", "celebration", "night out", "pub", "pub night", "beer garden"],
  sleep: ["sleep", "bedtime", "nap", "insomnia", "fall asleep", "wind down", "lullaby", "kip"],
  cleaning: ["cleaning", "clean room", "laundry", "washing", "chores", "tidying", "tidy", "reset day"],
  travel: ["flight", "airport", "train", "bus", "commute", "walking", "walk", "transit", "subway", "tube", "underground", "tram", "coach", "rail", "national rail"],
};

export const EXPANDED_TIME_TERMS: Record<"morning" | "afternoon" | "evening" | "late_night", string[]> = {
  morning: ["morning", "mornin", "sunrise", "dawn", "breakfast", "early morning", "waking up", "commute morning", "school run", "5am"],
  afternoon: ["afternoon", "arvo", "midday", "noon", "daytime", "lunch", "lunchtime", "sunny day", "lazy afternoon", "sunday afternoon"],
  evening: ["evening", "evenin", "sunset", "golden hour", "dusk", "twilight", "after work", "tea time", "teatime", "dinner"],
  late_night: ["late night", "late-night", "midnight", "midnite", "nite", "after dark", "2am", "3am", "4am", "night bus", "night tube", "last train", "night drive", "nite drive", "witching hour", "insomnia"],
};

export const EXPANDED_PLACE_TERMS: Record<"rural" | "outdoors" | "city" | "beach" | "bedroom" | "car", string[]> = {
  rural: ["rural", "country road", "small town", "village", "cowboy", "western", "red dirt", "farm", "fields", "countryside", "desert", "prairie", "barn", "truck stop"],
  outdoors: ["outdoors", "outside", "forest", "woods", "mountain", "campfire", "trail", "hiking", "walking", "lake", "river", "open air", "rain", "storm", "park", "common", "moor", "dales"],
  city: ["city", "urban", "downtown", "town centre", "city centre", "subway", "street", "nightclub", "skyscraper", "neon", "alley", "rooftop", "london", "manchester", "birmingham", "leeds", "glasgow", "bristol", "liverpool", "newcastle", "cardiff", "edinburgh", "nottingham", "sheffield"],
  beach: ["beach", "coast", "coastal", "seaside", "pier", "island", "summer", "poolside", "ocean", "sea", "surf", "tropical", "brighton", "cornwall", "devon"],
  bedroom: ["bedroom", "room", "alone", "private", "diary", "window", "floor", "flat", "apartment", "uni room", "halls", "dorm"],
  car: ["car", "cars", "volvo", "motorcycle", "motorcycles", "motorbike", "motorbikes", "bike shed", "garage", "workshop", "drive", "driving", "road trip", "motorway", "highway", "cruise", "backseat", "passenger seat", "passenger princess", "fixing cars", "under the hood", "welding"],
};

export const EXPANDED_EVENT_TERMS = [
  "wedding", "breakup", "divorce", "first date", "date night", "graduation", "prom", "freshers", "freshers week", "homecoming",
  "funeral", "wake", "birthday", "house party", "festival", "afterparty", "pre game", "pregame", "pres", "pre drinks",
  "christmas", "xmas", "chrimbo", "new year", "new year's", "halloween", "bonfire night", "guy fawkes", "valentine", "summer holiday", "vacation",
  "road trip", "moving house", "leaving home", "coming home", "exam season", "finals", "revision", "results day", "game day", "football", "match day", "bank holiday", "boxing day", "easter", "eurovision",
];

export const EXPANDED_ERA_TERMS: Array<{ label: string; start: number; end: number; terms: string[]; aesthetic: string }> = [
  { label: "40s", start: 1940, end: 1949, terms: ["1940s", "40s", "forties", "wartime", "big band era"], aesthetic: "wartime big band, crooners, early jazz-pop warmth" },
  { label: "50s", start: 1950, end: 1959, terms: ["1950s", "50s", "fifties", "rock and roll era", "doo wop era"], aesthetic: "doo-wop, early rock and roll, jukebox Americana" },
  { label: "60s", start: 1960, end: 1969, terms: ["1960s", "1960's", "60s", "60's", "sixties", "british invasion", "psychedelic era", "mod era"], aesthetic: "psychedelia, folk-rock, British invasion, bright analogue" },
  { label: "70s", start: 1970, end: 1979, terms: ["1970s", "1970's", "70s", "70's", "seventies", "disco era", "classic rock era", "punk era"], aesthetic: "warm funk, disco, punk, expansive analogue rock" },
  { label: "80s", start: 1980, end: 1989, terms: ["1980s", "1980's", "80s", "80's", "eighties", "new wave era", "hair metal era", "synth era", "mtv era"], aesthetic: "neon synths, new wave, gated drums, cinematic gloss" },
  { label: "90s", start: 1990, end: 1999, terms: ["1990s", "1990's", "90s", "90's", "nineties", "grunge era", "britpop era", "madchester", "madchester era", "golden age hip hop"], aesthetic: "grunge, alt-rock, boom bap, neo-soul, raw crossover emotion" },
  { label: "00s", start: 2000, end: 2009, terms: ["2000s", "2000's", "00s", "00's", "noughties", "naughties", "aughts", "y2k", "myspace era", "ipod era"], aesthetic: "Y2K gloss, pop punk, emo, ringtone rap, post-punk revival" },
  { label: "10s", start: 2010, end: 2019, terms: ["2010s", "twenty tens", "tens", "tumblr era", "bloghouse revival", "edm era"], aesthetic: "streaming-era indie, EDM crossover, tumblr pop, trap bloom" },
  { label: "20s", start: 2020, end: 2029, terms: ["2020s", "twenty twenties", "twenties", "pandemic era", "tiktok era"], aesthetic: "hyperpop-adjacent, genre-fluid, lo-fi and emotionally complex" },
];

Object.assign(COMMON_MISSPELLINGS, {
  ambient: ["ambiant", "ambinet"],
  amapiano: ["ampiano", "amapinao"],
  bachata: ["bachatta"],
  breakbeat: ["break beat", "breakbeats"],
  classical: ["clasical", "classicall"],
  dancehall: ["dance hall"],
  dubstep: ["dub step"],
  electronic: ["electronica", "eletronic", "electonic"],
  garage: ["garidge", "garrage"],
  hardcore: ["hard core"],
  hyperpop: ["hyper pop"],
  jungle: ["junglist", "jungl"],
  lofi: ["lofi", "lowfi", "low-fi"],
  metalcore: ["metal core"],
  reggaeton: ["reggeton", "reggaeton"],
  shoegaze: ["shoe gaze", "shoegazing"],
  synthwave: ["synth wave"],
  techno: ["technoo", "tekno"],
});

EXPANDED_GENRE_ALIASES.push(
  {
    family: "electronic",
    terms: [
      "ambient house", "ambient techno", "balearic", "balearic beat", "big beat", "bleep techno", "breaks garage", "chicago house",
      "classic house", "deep techno", "detroit techno", "dub techno", "electro house", "euphoric hardstyle", "fidget house",
      "future house", "future rave", "garage house", "ghetto house", "hard dance", "hard house", "italo disco", "italo house",
      "lo-fi house", "melodic house", "melodic techno", "organic house", "outsider house", "peak time techno", "progressive breaks",
      "raw techno", "space disco", "techno bunker", "tribal house", "uk funky", "uk funky house", "vocal house", "y2k trance",
      "breakbeat garage", "4x4 garage", "dark garage", "dubstep rollers", "140 dubstep", "bass music", "future beats",
      "chillstep", "melodic dubstep", "drumstep", "jump up dnb", "rollers dnb", "deep dnb", "dark dnb", "old school dnb",
      "rave breaks", "warehouse breaks", "acid breaks", "electro swing", "nu disco", "filter house", "french house",
      "complextro", "synth pop", "synthpop", "dark synth", "darkwave synth", "coldwave", "minimal wave", "new beat",
    ],
  },
  {
    family: "hip_hop",
    terms: [
      "boom bap", "golden era rap", "east coast rap", "west coast rap", "g-funk", "dirty south", "trap", "drill", "brooklyn drill",
      "chicago drill", "detroit rap", "memphis rap", "philly rap", "uk trap", "uk road rap", "manchester rap", "birmingham rap",
      "scouse rap", "aussie drill", "ny drill", "jersey drill", "rage beats", "rage trap", "plugg", "drumless rap", "abstract hip hop",
      "alt hip hop", "experimental hip hop", "jazz rap", "lo-fi rap", "emo rap", "sad rap", "melodic rap", "afro trap",
      "trap metal", "horrorcore", "battle rap", "political rap", "backpack rap", "underground rap", "mixtape rap",
    ],
  },
  {
    family: "rock",
    terms: [
      "alternative rock", "alt rock", "arena rock", "blues rock", "classic rock", "desert rock", "emo", "emo rock", "folk punk",
      "glam rock", "goth rock", "grunge", "hard rock", "indie rock", "jangle rock", "krautrock", "lo-fi rock", "new romantic",
      "post hardcore", "post-hardcore", "power pop rock", "proto punk", "pub rock", "riot grrrl", "soft rock", "space rock",
      "stoner rock", "yacht rock", "dad rock", "landfill indie", "blog rock", "new york rock", "manchester indie",
      "sheffield indie", "scottish indie", "welsh indie", "pop punk", "pop-punk", "skate punk", "skate-punk",
      "mall punk", "melodic punk", "emo pop punk", "emo pop", "scene kid", "scene kids", "scene music",
      "warped tour", "vans warped tour", "tony hawk", "tony hawk soundtrack", "tony hawk pro skater", "pro skater soundtrack",
      "skate video soundtrack", "skate game soundtrack", "burnout soundtrack", "need for speed soundtrack",
      "american pie soundtrack", "2000s youth culture", "myspace rock", "myspace emo", "myspace scene",
      "limewire rock", "guitar hero rock", "rock band game soundtrack",
    ],
  },
  {
    family: "pop",
    terms: [
      "afropop", "alt-pop", "bedroom hyperpop", "brat pop", "breakup pop", "country pop", "dance pop", "dark pop", "girl pop",
      "indie pop", "k-pop", "kpop", "latin pop", "leftfield pop", "main pop", "mainstream pop", "pop rap", "pop rock",
      "sad pop", "scandi pop", "sophisti-pop", "teen pop", "uk pop", "viral pop", "tiktok pop", "internet pop", "queer pop",
      "sad girl pop", "sad boy pop", "dreamy pop", "night drive pop",
    ],
  },
  {
    family: "rnb",
    terms: [
      "alt r&b", "alternative r&b", "contemporary r&b", "dark r&b", "indie r&b", "neo soul", "neo-soul", "new jack swing",
      "r&b slow jams", "silky r&b", "smooth r&b", "soulful r&b", "uk soul", "modern soul", "bedroom soul", "quiet storm",
      "lover's r&b", "late night r&b", "trap r&b",
    ],
  },
  {
    family: "latin",
    terms: [
      "bachata", "cumbia", "latin trap", "latin urbano", "merengue", "música mexicana", "musica mexicana", "nueva musica mexicana",
      "perreo", "reggaeton", "reggaetón", "salsa", "salsa romantica", "tango", "tejano", "urbano", "urbano latino",
      "vallenato", "mexican pop", "latin indie", "latin alternative",
    ],
  },
  {
    family: "world",
    terms: [
      "afrobeats", "afrobeat", "amapiano", "arab pop", "azonto", "bossa nova", "brazilian funk", "desi hip hop", "flamenco pop",
      "highlife", "indian pop", "japanese rock", "j-rock", "j rock", "japanese indie", "k-indie", "korean indie", "k-hip hop",
      "k hip hop", "k-r&b", "k r&b", "mandopop ballad", "soca", "zouk", "kompa", "mbaqanga", "south african house",
      "turkish pop", "anatolian rock", "rai pop", "bhangra pop",
    ],
  },
  {
    family: "metal",
    terms: [
      "alt metal", "alternative metal", "black metal", "death metal", "deathcore", "djent", "gothic metal", "groove metal",
      "hair metal", "hardcore metal", "melodic death metal", "metalcore", "nu metal", "progressive death metal", "thrash metal",
      "post black metal", "screamo", "industrial metal workout",
    ],
  },
  {
    family: "jazz",
    terms: [
      "bebop", "big band swing", "bossanova jazz", "bossa jazz", "contemporary jazz", "jazz rap", "jazztronica", "latin jazz",
      "lounge jazz", "smooth jazz", "vocal jazz", "jazz piano", "jazz cafe", "late night jazz", "rainy jazz",
    ],
  },
  {
    family: "classical",
    terms: [
      "baroque", "classical era", "classical focus", "contemporary classical", "dark academia classical", "impressionism",
      "modern composition", "orchestral", "piano focus", "study classical", "string ensemble", "symphonic", "opera",
      "ambient classical", "cinematic classical",
    ],
  },
  {
    family: "soundtrack",
    terms: [
      "cinematic", "cinematic score", "film music", "movie score", "tv soundtrack", "series soundtrack", "trailer score",
      "epic orchestral", "fantasy soundtrack", "sci-fi soundtrack", "horror soundtrack", "anime opening", "anime ending",
      "jrpg soundtrack", "racing game soundtrack", "open world soundtrack", "boss fight", "main character soundtrack",
    ],
  },
  {
    family: "reggae",
    terms: [
      "dancehall", "afro dancehall", "bashment", "dub", "dub poetry", "lovers rock uk", "modern reggae", "reggae rock",
      "ska revival", "ska rock", "sound system", "uk reggae", "roots dub", "dancehall party",
    ],
  },
  {
    family: "folk",
    terms: [
      "alt folk", "celtic folk", "dark folk", "folk pop", "indie acoustic", "modern folk", "neo folk", "pastoral folk",
      "singer songwriter folk", "trad folk", "uk folk", "irish folk", "scottish folk songs", "welsh folk songs",
    ],
  },
  {
    family: "indie",
    terms: [
      "alternative indie", "bedroom indie", "blog era indie", "college indie", "dreamy indie", "indie pop rock", "indie surf",
      "lo-fi bedroom", "sad bedroom", "slacker indie", "soft indie", "uk indie", "garage indie", "indie disco", "indie party",
    ],
  }
);

EXPANDED_MOOD_TERMS.anxious = [
  "anxious", "anxiety", "nervous", "uneasy", "restless", "on edge", "panicky", "overwhelmed", "stressed", "stressy", "wired",
  "tense", "paranoid", "spiralling", "spiraling", "can't settle", "too much in my head",
];
EXPANDED_MOOD_TERMS.confident = [
  "confident", "cocky", "bold", "swagger", "main character", "unbothered", "cool", "icy", "clean", "sharp", "boss", "powerful",
  "self assured", "walking in", "entrance music", "feel myself", "hot girl", "bad bitch", "big energy",
];
EXPANDED_MOOD_TERMS.romantic = [
  "romantic", "love", "loved up", "crush", "date", "date night", "flirty", "sensual", "sexy", "intimate", "slow dance", "yearning",
  "soft love", "honeymoon", "valentine", "late night love", "bedroom",
];
EXPANDED_MOOD_TERMS.chaotic = [
  "chaotic", "messy", "unhinged", "feral", "manic", "wild", "mad one", "no thoughts", "reckless", "unpredictable", "mayhem",
  "carnage", "rowdy", "silly", "deranged", "brainrot",
];
EXPANDED_MOOD_TERMS.dreamy = [
  "dreamy", "ethereal", "hazy", "foggy", "floaty", "spacey", "glossy", "soft light", "otherworldly", "celestial", "angelic",
  "shimmering", "cloudy", "sleepy but awake",
];
EXPANDED_MOOD_TERMS.brooding = [
  "brooding", "serious", "heavy", "grave", "stern", "cold", "detached", "stoic", "hard faced", "quiet anger", "dark focus",
  "villain", "villain arc",
];
EXPANDED_MOOD_TERMS.playful = [
  "playful", "cheeky", "silly", "fun", "bouncy", "cute", "camp", "goofy", "lighthearted", "carefree", "sparkly", "bubblegum",
  "feel good", "good mood",
];
EXPANDED_MOOD_TERMS.spiritual = [
  "spiritual", "transcendent", "sacred", "ritual", "meditative", "prayer", "church", "gospel feeling", "healing", "grounded",
  "awe", "cosmic", "universe", "higher power",
];

EXPANDED_ACTIVITY_TERMS.workout.push(
  "hiit", "crossfit", "powerlifting", "bodybuilding", "leg day", "push day", "pull day", "upper body", "lower body", "deadlift",
  "squat", "bench press", "pr attempt", "personal record", "treadmill", "spin class", "peloton", "rowing", "hyrox", "warmup",
  "cool down", "stretching", "mobility", "yoga flow", "pilates", "calisthenics", "climbing", "bouldering", "skateboarding"
);
EXPANDED_ACTIVITY_TERMS.focus.push(
  "essay writing", "exam cram", "dissertation", "thesis", "revision session", "library grind", "deep work block", "programming",
  "debugging", "design work", "creative writing", "journaling", "paperwork", "admin", "emails", "planning", "notion setup",
  "clean focus", "adhd focus", "pomodoro", "flow state", "reading fiction", "reading textbook"
);
EXPANDED_ACTIVITY_TERMS.party.push(
  "girls night", "boys night", "pres at mine", "uni pres", "freshers pres", "kitchen pres", "afters", "after party", "club queue",
  "uber to the club", "housewarming", "dinner party", "bbq", "garden party", "pub crawl", "karaoke", "wedding reception",
  "dance party", "festival campsite", "warehouse party"
);
EXPANDED_ACTIVITY_TERMS.driving.push(
  "school run", "commuting", "commute", "m1", "m6", "m4", "m62", "a1", "a roads", "b roads", "ring road", "dual carriageway",
  "city driving", "traffic", "rush hour", "late drive home", "petrol station", "service station", "windows down", "car stereo",
  "passenger seat", "long drive", "short drive", "road rage", "night motorway"
);
EXPANDED_ACTIVITY_TERMS.travel.push(
  "airport lounge", "boarding", "plane", "flying", "long haul", "holiday travel", "train home", "train to london", "tube ride",
  "elizabeth line", "overground", "bus home", "night bus", "coach trip", "interrail", "backpacking", "walking around town",
  "city break", "hotel room"
);
EXPANDED_ACTIVITY_TERMS.sleep.push(
  "wind down", "sleepy", "falling asleep", "bed", "bedroom at night", "insomnia", "nap", "power nap", "sleep playlist",
  "calm down", "night routine", "rain sleep"
);
EXPANDED_ACTIVITY_TERMS.cleaning.push(
  "deep clean", "reset room", "sunday reset", "washing up", "dishes", "hoovering", "vacuuming", "mopping", "decluttering",
  "laundry day", "spring clean", "cleaning motivation"
);
EXPANDED_ACTIVITY_TERMS.cooking = [
  "cooking", "cook", "meal prep", "making dinner", "kitchen", "baking", "barbecue", "bbq", "sunday roast", "breakfast cooking",
  "wine and cooking", "date night cooking", "chopping vegetables",
];
EXPANDED_ACTIVITY_TERMS.gaming = [
  "gaming", "video games", "xbox", "playstation", "pc gaming", "ranked", "competitive gaming", "fps", "racing game", "minecraft",
  "open world", "boss fight", "final boss", "mmorpg", "late night gaming", "cozy gaming", "cyberpunk game",
];
EXPANDED_ACTIVITY_TERMS.social = [
  "hanging out", "with friends", "with mates", "group chat", "getting ready", "preparing to go out", "walking with friends",
  "coffee with friends", "pub with mates", "catch up", "social anxiety", "meeting people",
];
EXPANDED_ACTIVITY_TERMS.creative = [
  "painting", "drawing", "sketching", "making art", "photography", "editing photos", "video editing", "writing songs",
  "producing music", "studio session", "crafting", "sewing", "designing", "brainstorming",
];

EXPANDED_PLACE_TERMS.rural.push("country pub", "country lane", "layby", "hills", "valley", "woods at night", "farm road", "lake district", "peak district", "yorkshire dales", "highlands");
EXPANDED_PLACE_TERMS.outdoors.push("garden", "back garden", "balcony", "rooftop garden", "field walk", "dog walk", "canal walk", "riverside", "waterfall", "beach walk", "snow", "heatwave", "thunderstorm");
EXPANDED_PLACE_TERMS.city.push("camden", "shoreditch", "soho", "brixton", "hackney", "peckham", "dalston", "croydon", "west end", "tube station", "bus stop", "estate", "high street", "city lights", "student halls");
EXPANDED_PLACE_TERMS.beach.push("ibiza", "mallorca", "marbella", "benidorm", "beach bar", "boat party", "seafront", "promenade", "sun lounger", "holiday pool", "pool party");
EXPANDED_PLACE_TERMS.bedroom.push("student room", "shared house", "bedsit", "studio flat", "window open", "messy room", "floor crying", "getting ready in room", "mirror", "wardrobe");
EXPANDED_PLACE_TERMS.car.push("uber", "taxi", "cab", "van", "truck", "lorry", "first car", "old car", "90s car", "windows down", "aux cord", "car park", "multi storey", "drive thru");

EXPANDED_EVENT_TERMS.push(
  "anniversary", "baby shower", "bar mitzvah", "bat mitzvah", "christening", "engagement party", "hen do", "stag do", "leavers", "leaving party",
  "retirement party", "promotion", "new job", "job interview", "first day", "last day", "payday", "moving day", "housewarming", "flat warming",
  "uni move in", "freshers night", "club night", "rave comedown", "comedown", "afterparty comedown", "hangover", "sunday scaries",
  "exam results", "gcse results", "a level results", "deadline", "all nighter", "sports day", "cup final", "world cup", "euros",
  "christmas eve", "christmas morning", "christmas party", "new year's eve", "new year's day", "valentine's day", "pancake day",
  "easter sunday", "notting hill carnival", "pride", "ramadan", "eid", "diwali", "hanukkah", "lunar new year", "thanksgiving",
  "halloween party", "bonfire", "fireworks", "summer solstice", "winter solstice"
);

EXPANDED_TIME_TERMS.morning.push("5am", "6am", "7am", "8am", "early doors", "school morning", "gym morning", "commute sunrise", "cold morning");
EXPANDED_TIME_TERMS.afternoon.push("2pm", "3pm", "4pm", "after lunch", "hot afternoon", "bank holiday afternoon", "study afternoon");
EXPANDED_TIME_TERMS.evening.push("5pm", "6pm", "7pm", "8pm", "after dinner", "pre drinks time", "getting ready", "blue hour", "evening commute");
EXPANDED_TIME_TERMS.late_night.push("11pm", "12am", "1am", "5am", "after party", "club closing", "last orders", "walk home at night", "late shift");

EXPANDED_ERA_TERMS.unshift(
  { label: "20s-30s", start: 1920, end: 1939, terms: ["1920s", "1930s", "20s jazz", "30s jazz", "roaring twenties", "great depression era", "swing era", "early jazz age"], aesthetic: "early jazz, swing, crooners, ballroom warmth" }
);
EXPANDED_ERA_TERMS.find((era) => era.label === "40s")?.terms.push("post war", "post-war", "wartime jazz", "crooner era");
EXPANDED_ERA_TERMS.find((era) => era.label === "50s")?.terms.push("jukebox", "sock hop", "early soul", "early country pop", "rockabilly");
EXPANDED_ERA_TERMS.find((era) => era.label === "60s")?.terms.push("motown era", "girl groups", "surf era", "folk revival", "mod", "soul sixties");
EXPANDED_ERA_TERMS.find((era) => era.label === "70s")?.terms.push("glam era", "prog era", "singer songwriter era", "roots reggae era", "funk era", "yacht rock era");
EXPANDED_ERA_TERMS.find((era) => era.label === "80s")?.terms.push("post disco", "early hip hop", "new romantic era", "arena rock era", "synthpop era", "80s goth");
EXPANDED_ERA_TERMS.find((era) => era.label === "90s")?.terms.push("rave era", "jungle era", "trip hop era", "90s r&b", "90s house", "90s country", "90s emo");
EXPANDED_ERA_TERMS.find((era) => era.label === "00s")?.terms.push(
  "blog era", "garage revival", "indie sleaze era", "crunk era", "snap music", "limewire era", "emo noughties",
  "kerrang era", "kerrang tv", "mtv2 era", "tony hawk era", "tony hawk soundtrack", "pro skater era",
  "need for speed soundtrack", "burnout soundtrack", "warped tour era", "myspace era rock", "scene kid era",
  "guitar hero era", "rock band era",
);
EXPANDED_ERA_TERMS.find((era) => era.label === "10s")?.terms.push("soundcloud era", "trap era", "future bass era", "tropical house era", "vine era", "tumblr indie", "2016 summer");
EXPANDED_ERA_TERMS.find((era) => era.label === "20s")?.terms.push("lockdown era", "post pandemic", "reels era", "algorithm era", "2020 lockdown", "2021 summer", "2022", "2023", "2024", "2025", "2026");

function pushUniqueTerms(target: string[], terms: string[]): void {
  for (const term of terms) {
    if (!target.includes(term)) target.push(term);
  }
}

// Universal semantic music ontology expansion. Keep these high-precision aliases:
// they enrich retrieval/intent coverage without changing scoring, fallback, or trust gates.
EXPANDED_GENRE_ALIASES.push(
  {
    family: "rock",
    terms: [
      "aor", "adult oriented rock", "album rock", "anthemic rock", "bar rock", "college rock", "heartland rock",
      "modern rock", "post grunge", "post-grunge", "radio rock", "roots rock", "skate rock", "surf punk",
      "third wave ska punk", "emo revival", "swancore", "easycore", "orgcore", "melodic hardcore punk",
      "basement show", "house show punk", "diy punk", "hardcore scene", "straight edge", "youth crew",
      "download festival rock", "reading festival rock", "leeds festival rock", "slam dunk festival",
    ],
  },
  {
    family: "metal",
    terms: [
      "arena metal", "bay area thrash", "beatdown hardcore", "blackened death metal", "crossover thrash",
      "doomgaze", "funeral doom", "industrial metal", "melodic metalcore", "modern metal", "nwobhm",
      "old school death metal", "osdm", "post metal", "progressive metalcore", "slam death metal",
      "stoner doom", "technical death metal", "viking metal", "warped tour metalcore", "kerrang metal",
    ],
  },
  {
    family: "pop",
    terms: [
      "adult contemporary", "alt z", "bubblegum bass", "chill pop", "dance-pop", "diva pop", "europop",
      "girl group pop", "heartbreak pop", "idol pop", "main character pop", "maximalist pop", "new jack pop",
      "sad bangers", "soft pop", "summer pop", "synth pop", "y2k pop", "2010s tumblr pop",
    ],
  },
  {
    family: "hip_hop",
    terms: [
      "blog rap", "cloud trap", "conscious hip hop", "detroit scam rap", "dirty south rap", "drumless hip hop",
      "frat rap", "golden age rap", "horrorcore rap", "hyphy movement", "jazz hip hop", "jerk movement",
      "mixtape era", "ny drill", "sample drill", "soundcloud rap", "uk grime", "uk garage rap",
    ],
  },
  {
    family: "electronic",
    terms: [
      "acid techno", "afterhours techno", "ambient dnb", "bass house", "bassline house", "berlin techno",
      "big room", "clubland", "deep dubstep", "detroit house", "donk rave", "dub techno", "edm festival",
      "electro pop", "electroclash", "future garage", "garage revival", "happy hardcore", "hard dance",
      "hardstyle gym", "ibiza house", "leftfield bass", "night bus garage", "progressive electronic",
      "rave soundtrack", "speed garage", "uk bass", "warehouse rave", "white isle",
    ],
  },
  {
    family: "country",
    terms: [
      "appalachian country", "country soul", "country trap", "cowboy songs", "driving country", "heartland country",
      "nashville sound", "neo-traditional country", "red dirt scene", "road trip country", "southern gothic country",
      "truck stop country", "western songs", "working man country",
    ],
  },
  {
    family: "indie",
    terms: [
      "blog indie", "brooklyn indie", "c86", "college radio indie", "festival indie", "indie sleaze revival",
      "landfill indie", "new rave indie", "nme indie", "pitchfork indie", "post punk revival", "twee indie",
      "tumblr indie", "urban outfitters indie",
    ],
  },
  {
    family: "soundtrack",
    terms: [
      "action movie soundtrack", "coming of age soundtrack", "cult film soundtrack", "driving game soundtrack",
      "fifa soundtrack", "forza soundtrack", "gta radio", "gta soundtrack", "gran turismo soundtrack",
      "madden soundtrack", "movie montage", "need for speed underground", "nhl soundtrack", "racing game soundtrack",
      "rom com soundtrack", "skate film soundtrack", "ssx soundtrack", "teen movie soundtrack", "tv theme",
    ],
  },
  {
    family: "world",
    terms: [
      "alt k-pop", "anime rock", "enka pop", "j-pop rock", "japanese indie rock",
      "korean r&b", "latin alternative", "mandopop", "shibuya-kei", "visual kei",
    ],
  },
  {
    family: "reggae",
    terms: [
      "2 tone ska", "ska punk", "ska punk revival", "skinhead reggae", "soundclash", "third wave ska",
    ],
  },
  {
    family: "soul",
    terms: [
      "deep funk", "disco funk", "rare groove", "southern funk", "street soul", "yacht soul",
    ],
  },
  {
    family: "jazz",
    terms: [
      "coffee shop jazz", "dark jazz", "jazz noir", "jazztronica", "lofi jazz", "rainy jazz", "spiritual jazz",
      "study jazz", "uk jazz",
    ],
  },
);

pushUniqueTerms(EXPANDED_ACTIVITY_TERMS.workout, [
  "arms day", "back day", "cardio session", "couch to 5k", "gym class", "gym playlist", "half marathon training",
  "marathon training", "morning run", "night run", "park run", "pre workout", "running faster", "spin bike",
  "strongman", "trail running", "ultramarathon", "workout finisher",
]);
pushUniqueTerms(EXPANDED_ACTIVITY_TERMS.focus, [
  "building an app", "coding late", "coding sprint", "debugging session", "finishing a project", "flow coding",
  "founder mode", "launching product", "night shift coding", "productivity sprint", "shipping a feature",
  "starting business", "writing code", "working harder", "working on startup",
]);
pushUniqueTerms(EXPANDED_ACTIVITY_TERMS.driving, [
  "autobahn", "canyon drive", "coastal drive", "empty road", "first car drive", "motorcycle ride", "rainy motorway drive",
  "restoring a car", "road trip through scotland", "sunday drive", "volvo drive", "windows down driving",
]);
pushUniqueTerms(EXPANDED_ACTIVITY_TERMS.focus, [
  "bike repair", "car restoration", "classic car restoration", "diy project", "fixing a car", "fixing my volvo",
  "garage work", "mechanic work", "motorcycle maintenance", "restoring a volvo", "troubleshooting electrics",
  "woodworking", "workbench", "workshop day",
]);
pushUniqueTerms(EXPANDED_ACTIVITY_TERMS.gaming, [
  "burnout", "fifa", "forza", "gran turismo", "gta", "guitar hero", "madden", "need for speed", "nhl",
  "racing game", "rock band", "ssx", "tony hawk", "tony hawk pro skater",
]);
pushUniqueTerms(EXPANDED_ACTIVITY_TERMS.creative, [
  "building something", "creative block", "design sprint", "finishing art", "making a video", "photo editing",
  "renovating", "songwriting", "starting a project", "writing a script",
]);

pushUniqueTerms(EXPANDED_MOOD_TERMS.euphoric, [
  "achievement", "after a long struggle", "champion", "finished the project", "glorious", "made it", "overcome",
  "proud", "redemption", "unstoppable", "victory lap", "winning",
]);
pushUniqueTerms(EXPANDED_MOOD_TERMS.angry, [
  "chip on my shoulder", "clenched jaw", "destroy everything", "fight back", "furious focus", "prove them wrong",
  "revenge gym", "righteous anger", "spite", "war mode",
]);
pushUniqueTerms(EXPANDED_MOOD_TERMS.nostalgic, [
  "old games", "old mtv", "old photos", "school memories", "teen memories", "throwback tv", "y2k nostalgia",
]);
pushUniqueTerms(EXPANDED_MOOD_TERMS.calm, [
  "decompress", "grounding", "peaceful focus", "quiet confidence", "regulated", "soft reset", "wellness",
]);
pushUniqueTerms(EXPANDED_MOOD_TERMS.melancholic, [
  "breakup recovery", "divorce", "grieving", "heartbreak recovery", "missing someone", "moving on", "sad but hopeful",
]);
pushUniqueTerms(EXPANDED_MOOD_TERMS.confident, [
  "boss mode", "can't lose", "comeback", "main stage", "power walk", "self belief", "walk in like you own it",
]);

pushUniqueTerms(EXPANDED_PLACE_TERMS.city, [
  "berlin", "chicago", "detroit", "downtown", "glasgow", "liverpool", "los angeles", "manhattan", "new york",
  "seattle", "tokyo", "underground club", "urban night",
]);
pushUniqueTerms(EXPANDED_PLACE_TERMS.rural, [
  "american south", "countryside drive", "farmhouse", "nashville", "open road", "scottish highlands", "wales",
]);
pushUniqueTerms(EXPANDED_PLACE_TERMS.car, [
  "classic car", "classic car meet", "old volvo", "project car", "volvo 480", "volvo 480 turbo", "workshop garage",
]);
pushUniqueTerms(EXPANDED_PLACE_TERMS.outdoors, [
  "autumn leaves", "blizzard", "cloudy day", "fog", "forest road", "mountains", "rain storm", "snowy night",
  "spring morning", "storm clouds", "summer evening", "sunrise", "sunset", "thunderstorm", "windy day", "winter night",
]);
pushUniqueTerms(EXPANDED_PLACE_TERMS.bedroom, [
  "internet bedroom", "myspace profile", "tumblr room", "youtube rabbit hole",
]);

pushUniqueTerms(EXPANDED_EVENT_TERMS, [
  "anniversary dinner", "breakup recovery", "career change", "divorce papers", "exam success", "finishing project",
  "first date nerves", "first day at work", "funeral reflection", "graduation party", "job interview nerves",
  "launch day", "moving city", "new chapter", "personal growth", "promotion celebration", "starting over",
]);

EXPANDED_ERA_TERMS.find((era) => era.label === "80s")?.terms.push(
  "vh1 classics", "miami vice", "john hughes movie", "synthwave nostalgia", "arcade era",
);
EXPANDED_ERA_TERMS.find((era) => era.label === "90s")?.terms.push(
  "seattle scene", "sub pop", "britpop battle", "mtv unplugged", "skate video era", "playstation era",
);
EXPANDED_ERA_TERMS.find((era) => era.label === "00s")?.terms.push(
  "purevolume", "last.fm era", "nme era", "download festival era", "slam dunk era", "fifa soundtrack era",
  "gta radio era", "need for speed underground", "burnout 3", "ssx tricky", "guitar hero soundtrack",
);
EXPANDED_ERA_TERMS.find((era) => era.label === "10s")?.terms.push(
  "bloghouse revival", "edm festival boom", "instagram era", "lofi beats era", "spotify era", "youtube era",
);
EXPANDED_ERA_TERMS.find((era) => era.label === "20s")?.terms.push(
  "algorithm pop", "bedroom producer era", "hyperpop era", "reels era", "tiktok sound", "viral song",
);

// Life-state, emotional-transition, personality, and global-scene expansion.
EXPANDED_GENRE_ALIASES.push(
  {
    family: "world",
    terms: [
      "african jazz", "afro jazz", "afro latin", "arabic electronic", "balkan brass", "bossa pop",
      "brazilian funk", "brazilian jazz", "brazilian pop", "desi indie", "french pop", "german techno",
      "highlife guitar", "japanese ambient", "japanese fusion", "japanese jazz", "japanese metal",
      "korean indie", "korean rock", "nordic folk", "nordic metal", "scandi pop", "south african jazz",
      "spanish indie", "turkish psych", "uk afro swing", "welsh rock",
    ],
  },
  {
    family: "electronic",
    terms: [
      "after work house", "airport ambient", "ambient pop", "city lights electronic", "coding electronic",
      "deep focus electronic", "desert techno", "forest psytrance", "german techno club", "night drive synth",
      "productivity techno", "rainy ukg", "sunset house", "train journey ambient", "winter ambient",
    ],
  },
  {
    family: "folk",
    terms: [
      "autumn folk", "cabin folk", "coffee shop acoustic", "grief folk", "healing folk", "mountain folk",
      "moving house folk", "new beginning folk", "rainy folk", "recovery acoustic", "road folk", "spring folk",
      "winter folk",
    ],
  },
  {
    family: "soul",
    terms: [
      "confidence soul", "healing soul", "hopeful soul", "motivational soul", "recovery soul", "wedding soul",
    ],
  },
  {
    family: "rock",
    terms: [
      "comeback rock", "confidence rock", "driving through rain rock", "finishing project rock", "garage work rock",
      "motivational rock", "rainy motorway rock", "rebuilding life rock", "road trip alt rock", "unstoppable rock",
    ],
  },
);

pushUniqueTerms(EXPANDED_ACTIVITY_TERMS.focus, [
  "burnout recovery", "career change", "deep focus entry", "exam revision", "fatigue prevention", "focus entry",
  "getting back on track", "life admin", "rebuilding life", "rebuilding my life", "recovery routine",
  "starting again", "study fatigue", "work burnout",
]);
pushUniqueTerms(EXPANDED_ACTIVITY_TERMS.workout, [
  "build phase", "build up", "cooldown", "cool down", "energy peak", "finish strong", "gym cooldown",
  "gym finisher", "gym peak", "peak energy", "peak set", "workout arc", "workout warmup", "warm up", "warmup",
]);
pushUniqueTerms(EXPANDED_ACTIVITY_TERMS.driving, [
  "departure", "driving through scotland", "driving through wales", "empty motorway", "highland drive",
  "midnight motorway", "rainy a road", "roadtrip cruise", "roadtrip departure", "roadtrip sunset",
  "sunset cruise", "top gear roadtrip vibes",
]);
pushUniqueTerms(EXPANDED_ACTIVITY_TERMS.travel, [
  "airport anxiety", "airport departure", "airport waiting", "first trip alone", "moving abroad", "train station",
  "train window", "travel nerves",
]);
pushUniqueTerms(EXPANDED_ACTIVITY_TERMS.social, [
  "friendship", "making friends", "meeting someone new", "reconnecting with friends", "social battery",
]);
pushUniqueTerms(EXPANDED_ACTIVITY_TERMS.creative, [
  "creative confidence", "portfolio work", "studio flow", "work in progress",
]);

pushUniqueTerms(EXPANDED_MOOD_TERMS.melancholic, [
  "alone after breakup", "divorced", "empty house", "grief", "grieving", "illness", "loneliness", "lonely",
  "lost", "mourning", "post breakup", "sad to hopeful", "widowed",
]);
pushUniqueTerms(EXPANDED_MOOD_TERMS.warm, [
  "first home", "friendship warmth", "home again", "new parent", "parenthood", "settling in", "soft hope",
]);
pushUniqueTerms(EXPANDED_MOOD_TERMS.euphoric, [
  "promotion", "success", "survived it", "things are getting better", "triumph after struggle",
]);
pushUniqueTerms(EXPANDED_MOOD_TERMS.confident, [
  "ambitious", "back in control", "competitive", "confidence building", "focused personality", "level up",
  "personal growth", "rebuilding confidence", "self improvement", "starting over strong",
]);
pushUniqueTerms(EXPANDED_MOOD_TERMS.calm, [
  "anxious to calm", "calm after chaos", "illness recovery", "peace after grief", "restoring balance",
]);
pushUniqueTerms(EXPANDED_MOOD_TERMS.angry, [
  "angry to motivated", "channel anger", "turn anger into focus",
]);
pushUniqueTerms(EXPANDED_MOOD_TERMS.nostalgic, [
  "first job", "student life", "university days", "uni memories", "youth culture",
]);
pushUniqueTerms(EXPANDED_MOOD_TERMS.dreamy, [
  "dreaming of change", "future self", "soft future", "starting a new chapter",
]);
pushUniqueTerms(EXPANDED_MOOD_TERMS.introspective, [
  "figuring life out", "life transition", "looking back", "moving home", "questioning everything", "retirement",
  "turning point",
]);

pushUniqueTerms(EXPANDED_PLACE_TERMS.city, [
  "atlanta", "bristol", "brooklyn", "cardiff", "ibiza town", "kingston", "memphis", "new orleans",
  "paris", "rio", "stockholm", "toronto",
]);
pushUniqueTerms(EXPANDED_PLACE_TERMS.rural, [
  "desert road", "empty fields", "farm town", "small town night", "suburban estate", "suburban streets",
]);
pushUniqueTerms(EXPANDED_PLACE_TERMS.outdoors, [
  "cold rain", "desert", "dry heat", "golden autumn", "heavy rain", "humid night", "icy morning",
  "misty forest", "stormy night", "summer night", "warm rain",
]);
pushUniqueTerms(EXPANDED_PLACE_TERMS.bedroom, [
  "first flat", "new apartment", "student bedroom", "university room",
]);

pushUniqueTerms(EXPANDED_EVENT_TERMS, [
  "becoming a parent", "burnout recovery", "divorce recovery", "empty nest", "first job", "getting married",
  "grief recovery", "illness recovery", "leaving university", "losing someone", "marriage", "midlife reset",
  "moving back home", "parenthood", "rebuilding confidence", "rebuilding my life", "recovering from illness",
  "retirement", "starting a business", "starting university", "student life", "university", "work burnout",
]);

pushUniqueTerms(EXPANDED_TIME_TERMS.morning, ["fresh start morning", "new chapter morning", "recovery morning"]);
pushUniqueTerms(EXPANDED_TIME_TERMS.evening, ["after a hard day", "evening reset", "sunset transition"]);
pushUniqueTerms(EXPANDED_TIME_TERMS.late_night, ["can't sleep", "life thoughts at night", "night thoughts", "overthinking at 2am"]);

EXPANDED_ERA_TERMS.find((era) => era.label === "50s")?.terms.push("early television era", "teen dance era");
EXPANDED_ERA_TERMS.find((era) => era.label === "60s")?.terms.push("counterculture", "motown tv", "woodstock era");
EXPANDED_ERA_TERMS.find((era) => era.label === "70s")?.terms.push("cbgb", "disco club era", "punk club era");
EXPANDED_ERA_TERMS.find((era) => era.label === "80s")?.terms.push("college radio", "hair metal mtv", "vh1 era");
EXPANDED_ERA_TERMS.find((era) => era.label === "90s")?.terms.push("alternative nation", "britpop tv", "cd wallet era", "napster era");
EXPANDED_ERA_TERMS.find((era) => era.label === "00s")?.terms.push(
  "emo scene", "facebook era", "ipod nano", "kerrang magazine", "mtv2 rock countdown", "myspace profile song",
  "purevolume bands", "warped tour summer", "youtube early days",
);
EXPANDED_ERA_TERMS.find((era) => era.label === "10s")?.terms.push(
  "boiler room era", "festival edm era", "soundcloud upload", "tumblr dashboard",
);
EXPANDED_ERA_TERMS.find((era) => era.label === "20s")?.terms.push(
  "discord music scene", "lockdown walks", "playlist culture", "tiktok discovery",
);

export function termRegex(terms: string[]): RegExp {
  const cacheKey = terms.join("\u0001").toLowerCase();
  const cached = termRegexCache.get(cacheKey);
  if (cached) return cached;
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const source = terms
    .flatMap((term) => [term, ...(COMMON_MISSPELLINGS[term.toLowerCase()] ?? [])])
    .map((term) => term.trim().split(/[\s_-]+/).filter(Boolean).map(escape).join("[\\s_-]+"))
    .sort((a, b) => b.length - a.length)
    .join("|");
  const regex = source ? new RegExp(`\\b(?:${source})\\b`, "i") : /a^/i;
  termRegexCache.set(cacheKey, regex);
  if (termRegexCache.size > TERM_REGEX_CACHE_MAX) {
    const oldestKey = termRegexCache.keys().next().value;
    if (oldestKey !== undefined) termRegexCache.delete(oldestKey);
  }
  return regex;
}
