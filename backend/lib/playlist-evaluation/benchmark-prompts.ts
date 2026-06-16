export type PlaylistBenchmarkCategory =
  | "gym"
  | "focus"
  | "party"
  | "driving"
  | "chill"
  | "study"
  | "work"
  | "gaming"
  | "nostalgic"
  | "genre_specific"
  | "era_specific"
  | "mood_specific"
  | "mixed"
  | "contradictory"
  | "discovery"
  | "edge_case";

export type PlaylistBenchmarkPrompt = {
  id: string;
  category: PlaylistBenchmarkCategory;
  prompt: string;
  mode: "strict" | "balanced" | "chaotic";
  length: number;
  expectedGenres?: string[];
  expectedEra?: { start: number; end: number };
  expectedEnergy?: "low" | "medium" | "high";
  expectedValence?: "low" | "medium" | "high";
  expectedIdentity?: string;
  tags: string[];
};

const gym: PlaylistBenchmarkPrompt[] = [
  { id: "gym-2000s-pop-punk", category: "gym", prompt: "2000s pop punk gym workout", mode: "balanced", length: 30, expectedGenres: ["pop punk", "punk", "rock"], expectedEra: { start: 1998, end: 2012 }, expectedEnergy: "high", expectedIdentity: "gym_beast", tags: ["era", "genre", "high_energy"] },
  { id: "gym-heavy-lifting", category: "gym", prompt: "heavy lifting gym pump aggressive", mode: "balanced", length: 30, expectedGenres: ["rock", "metal", "rap"], expectedEnergy: "high", expectedIdentity: "gym_beast", tags: ["activity", "high_energy"] },
  { id: "gym-cardio-upbeat", category: "gym", prompt: "upbeat cardio running playlist", mode: "balanced", length: 25, expectedGenres: ["pop", "dance", "rock"], expectedEnergy: "high", expectedValence: "high", expectedIdentity: "gym_beast", tags: ["activity", "movement"] },
  { id: "gym-morning-boost", category: "gym", prompt: "morning gym energy boost", mode: "balanced", length: 25, expectedEnergy: "high", expectedValence: "high", expectedIdentity: "gym_beast", tags: ["activity"] },
  { id: "gym-angry-rock", category: "gym", prompt: "angry rock workout no slow songs", mode: "strict", length: 25, expectedGenres: ["rock", "metal", "punk"], expectedEnergy: "high", expectedIdentity: "gym_beast", tags: ["strict", "high_energy"] },
  { id: "gym-rap-cardio", category: "gym", prompt: "rap cardio workout high tempo", mode: "balanced", length: 30, expectedGenres: ["rap", "hip hop"], expectedEnergy: "high", expectedIdentity: "gym_beast", tags: ["genre", "activity"] },
  { id: "gym-chaotic-pr", category: "gym", prompt: "chaotic gym personal record attempt", mode: "chaotic", length: 25, expectedEnergy: "high", expectedIdentity: "gym_beast", tags: ["chaotic", "edge_energy"] },
  { id: "gym-short-pump", category: "gym", prompt: "quick pump workout", mode: "balanced", length: 20, expectedEnergy: "high", expectedIdentity: "gym_beast", tags: ["short", "low_complexity"] },
];

const focus: PlaylistBenchmarkPrompt[] = [
  { id: "focus-deep-study", category: "focus", prompt: "deep focus study session no distractions", mode: "balanced", length: 30, expectedEnergy: "low", expectedIdentity: "focus_minimalist", tags: ["activity", "low_distraction"] },
  { id: "focus-coding", category: "focus", prompt: "calm coding focus", mode: "balanced", length: 30, expectedGenres: ["ambient", "electronic", "instrumental"], expectedEnergy: "low", expectedIdentity: "focus_minimalist", tags: ["work", "low_distraction"] },
  { id: "focus-ambient-morning", category: "focus", prompt: "calm ambient morning focus coding", mode: "strict", length: 25, expectedGenres: ["ambient", "instrumental", "electronic"], expectedEnergy: "low", expectedIdentity: "focus_minimalist", tags: ["genre", "strict"] },
  { id: "focus-rainy", category: "focus", prompt: "rainy focus music for reading", mode: "balanced", length: 25, expectedEnergy: "low", expectedIdentity: "focus_minimalist", tags: ["scene"] },
  { id: "focus-late-night", category: "focus", prompt: "late night focus no vocals", mode: "strict", length: 25, expectedEnergy: "low", expectedIdentity: "focus_minimalist", tags: ["strict", "night"] },
  { id: "focus-soft-electronic", category: "focus", prompt: "soft electronic concentration", mode: "balanced", length: 25, expectedGenres: ["electronic", "ambient"], expectedEnergy: "low", expectedIdentity: "focus_minimalist", tags: ["genre"] },
  { id: "focus-office-background", category: "focus", prompt: "office background focus steady", mode: "balanced", length: 30, expectedEnergy: "low", expectedIdentity: "focus_minimalist", tags: ["work"] },
  { id: "focus-chaotic-test", category: "focus", prompt: "chaotic focus but still no distractions", mode: "chaotic", length: 25, expectedEnergy: "medium", expectedIdentity: "focus_minimalist", tags: ["contradictory", "chaotic"] },
];

const party: PlaylistBenchmarkPrompt[] = [
  { id: "party-simple", category: "party", prompt: "party", mode: "balanced", length: 30, expectedEnergy: "high", expectedValence: "high", expectedIdentity: "party_social", tags: ["low_complexity"] },
  { id: "party-house", category: "party", prompt: "house party with friends", mode: "balanced", length: 35, expectedEnergy: "high", expectedValence: "high", expectedIdentity: "party_social", tags: ["social"] },
  { id: "party-pre-drinks", category: "party", prompt: "pre drinks buzzing night out", mode: "balanced", length: 30, expectedGenres: ["pop", "dance", "rap", "garage"], expectedEnergy: "high", expectedIdentity: "party_social", tags: ["social", "night"] },
  { id: "party-70s-disco", category: "party", prompt: "70s disco party dancefloor", mode: "strict", length: 30, expectedGenres: ["disco", "funk", "soul", "dance"], expectedEra: { start: 1970, end: 1982 }, expectedEnergy: "high", expectedIdentity: "party_social", tags: ["era", "genre"] },
  { id: "party-latin-summer", category: "party", prompt: "latin summer beach party", mode: "balanced", length: 30, expectedGenres: ["latin", "reggaeton", "salsa"], expectedEnergy: "high", expectedValence: "high", expectedIdentity: "party_social", tags: ["genre", "summer"] },
  { id: "party-uk-freshers", category: "party", prompt: "freshers pre drinks ukg grime buzzing night out", mode: "balanced", length: 30, expectedGenres: ["uk garage", "garage", "grime", "rap"], expectedEnergy: "high", expectedIdentity: "party_social", tags: ["genre", "uk"] },
  { id: "party-chaos", category: "party", prompt: "party all night chaos", mode: "chaotic", length: 35, expectedEnergy: "high", expectedIdentity: "party_social", tags: ["chaotic"] },
  { id: "party-sad-upbeat", category: "party", prompt: "sad upbeat party songs", mode: "balanced", length: 25, expectedEnergy: "high", expectedValence: "medium", expectedIdentity: "party_social", tags: ["mixed_emotion"] },
];

const driving: PlaylistBenchmarkPrompt[] = [
  { id: "drive-night", category: "driving", prompt: "driving at night", mode: "balanced", length: 30, expectedEnergy: "medium", expectedIdentity: "drive_nostalgic", tags: ["night", "activity"] },
  { id: "drive-backroads", category: "driving", prompt: "country lane backroads drive speeding in a 90s car", mode: "balanced", length: 30, expectedEnergy: "medium", expectedIdentity: "drive_nostalgic", tags: ["scene", "nostalgia"] },
  { id: "drive-90s-neon", category: "driving", prompt: "90s neon night drive", mode: "balanced", length: 30, expectedEra: { start: 1988, end: 2002 }, expectedEnergy: "medium", expectedIdentity: "drive_nostalgic", tags: ["era", "night"] },
  { id: "drive-rainy-highway", category: "driving", prompt: "rainy highway driving", mode: "balanced", length: 25, expectedEnergy: "medium", expectedIdentity: "drive_nostalgic", tags: ["scene"] },
  { id: "drive-sunrise", category: "driving", prompt: "happy sunrise drive", mode: "balanced", length: 25, expectedEnergy: "medium", expectedValence: "high", expectedIdentity: "drive_nostalgic", tags: ["valence"] },
  { id: "drive-late-garage", category: "driving", prompt: "late night uk garage drive", mode: "strict", length: 25, expectedGenres: ["garage", "uk garage", "electronic", "dance"], expectedEnergy: "medium", expectedIdentity: "drive_nostalgic", tags: ["genre", "strict"] },
  { id: "drive-motorway", category: "driving", prompt: "motorway drive with momentum", mode: "balanced", length: 30, expectedEnergy: "medium", expectedIdentity: "drive_nostalgic", tags: ["activity"] },
  { id: "drive-melancholy", category: "driving", prompt: "sad night drive but not sleepy", mode: "balanced", length: 25, expectedEnergy: "medium", expectedValence: "low", expectedIdentity: "drive_nostalgic", tags: ["mixed_emotion"] },
];

const chill: PlaylistBenchmarkPrompt[] = [
  { id: "chill-evening", category: "chill", prompt: "chill evening", mode: "balanced", length: 30, expectedEnergy: "low", expectedIdentity: "chill_warm", tags: ["low_complexity"] },
  { id: "chill-warm", category: "chill", prompt: "warm chill music after work", mode: "balanced", length: 30, expectedEnergy: "low", expectedIdentity: "chill_warm", tags: ["work"] },
  { id: "chill-cozy-rain", category: "chill", prompt: "cozy rainy night chill", mode: "balanced", length: 25, expectedEnergy: "low", expectedIdentity: "chill_warm", tags: ["scene", "night"] },
  { id: "chill-sunset", category: "chill", prompt: "beach sunset chill", mode: "balanced", length: 25, expectedEnergy: "low", expectedValence: "medium", expectedIdentity: "chill_warm", tags: ["scene"] },
  { id: "chill-sad-soft", category: "chill", prompt: "sad soft chill but not depressing", mode: "balanced", length: 25, expectedEnergy: "low", expectedValence: "low", expectedIdentity: "chill_warm", tags: ["mixed_emotion"] },
  { id: "chill-acoustic", category: "chill", prompt: "acoustic chill Sunday", mode: "balanced", length: 25, expectedGenres: ["acoustic", "folk", "indie"], expectedEnergy: "low", expectedIdentity: "chill_warm", tags: ["genre"] },
  { id: "chill-late-night", category: "chill", prompt: "late night calm warm playlist", mode: "strict", length: 25, expectedEnergy: "low", expectedIdentity: "chill_warm", tags: ["strict", "night"] },
  { id: "chill-chaotic", category: "chill", prompt: "chaotic chill evening somehow", mode: "chaotic", length: 25, expectedEnergy: "medium", expectedIdentity: "chill_warm", tags: ["contradictory"] },
];

const study = [
  "exam revision steady focus",
  "library study session calm",
  "homework background music no distractions",
  "study late night low energy",
  "quiet morning revision",
  "maths study playlist",
  "reading notes for hours",
  "deep work study flow",
].map((prompt, index): PlaylistBenchmarkPrompt => ({
  id: `study-${index + 1}`,
  category: "study",
  prompt,
  mode: index === 2 ? "strict" : "balanced",
  length: 25,
  expectedEnergy: "low",
  expectedIdentity: "focus_minimalist",
  tags: ["study", index === 2 ? "strict" : "focus"],
}));

const work = [
  "work playlist productive but not distracting",
  "office focus with a bit of warmth",
  "morning work energy steady",
  "admin tasks background music",
  "creative work flow",
  "coding sprint music",
  "emails and planning calm focus",
  "work from home quiet momentum",
].map((prompt, index): PlaylistBenchmarkPrompt => ({
  id: `work-${index + 1}`,
  category: "work",
  prompt,
  mode: "balanced",
  length: 25,
  expectedEnergy: index === 2 ? "medium" : "low",
  expectedIdentity: "focus_minimalist",
  tags: ["work"],
}));

const gaming = [
  "gaming montage high energy",
  "late night gaming focus",
  "racing game playlist",
  "open world exploration music",
  "competitive gaming hype",
  "cozy gaming evening",
  "cyberpunk gaming night",
  "boss fight music",
].map((prompt, index): PlaylistBenchmarkPrompt => ({
  id: `gaming-${index + 1}`,
  category: "gaming",
  prompt,
  mode: index === 0 || index === 4 || index === 7 ? "chaotic" : "balanced",
  length: 25,
  expectedEnergy: index === 0 || index === 4 || index === 7 ? "high" : "medium",
  tags: ["gaming"],
}));

const nostalgic = [
  { prompt: "nostalgic songs from school days", era: undefined },
  { prompt: "2000s nostalgia bedroom playlist", era: { start: 2000, end: 2009 } },
  { prompt: "90s rainy night sad indie", era: { start: 1988, end: 2002 }, genres: ["indie", "alternative"] },
  { prompt: "naughties Manchester bank holiday pub sesh", era: { start: 2000, end: 2009 }, genres: ["britpop", "indie", "rock", "garage", "pop"] },
  { prompt: "childhood car radio nostalgia", era: undefined },
  { prompt: "old favourites rediscovery", era: undefined },
  { prompt: "throwback house party", era: undefined },
  { prompt: "nostalgic late night drive", era: undefined },
].map((item, index): PlaylistBenchmarkPrompt => ({
  id: `nostalgic-${index + 1}`,
  category: "nostalgic",
  prompt: item.prompt,
  mode: "balanced",
  length: 30,
  expectedGenres: item.genres,
  expectedEra: item.era,
  expectedEnergy: "medium",
  expectedIdentity: index === 7 ? "drive_nostalgic" : "balanced_curator",
  tags: ["nostalgia"],
}));

const genreSpecific: PlaylistBenchmarkPrompt[] = [
  { id: "genre-red-dirt", category: "genre_specific", prompt: "american country cowboy red dirt", mode: "strict", length: 30, expectedGenres: ["country", "red dirt", "americana"], expectedEnergy: "medium", tags: ["genre", "strict"] },
  { id: "genre-uk-garage", category: "genre_specific", prompt: "late night uk garage", mode: "strict", length: 25, expectedGenres: ["garage", "uk garage", "electronic"], expectedEnergy: "medium", tags: ["genre", "strict"] },
  { id: "genre-90s-rnb", category: "genre_specific", prompt: "90s r&b slow jams late night", mode: "strict", length: 25, expectedGenres: ["rnb", "r&b", "soul"], expectedEra: { start: 1988, end: 2004 }, expectedEnergy: "low", tags: ["genre", "era"] },
  { id: "genre-grunge", category: "genre_specific", prompt: "90s grunge dark cloudy night", mode: "strict", length: 25, expectedGenres: ["grunge", "alternative", "rock"], expectedEra: { start: 1988, end: 2002 }, expectedEnergy: "medium", tags: ["genre", "era"] },
  { id: "genre-techno-drive", category: "genre_specific", prompt: "90s neon techno night drive", mode: "strict", length: 25, expectedGenres: ["techno", "electronic", "dance"], expectedEra: { start: 1988, end: 2002 }, expectedEnergy: "medium", tags: ["genre", "era", "drive"] },
  { id: "genre-indie-rain", category: "genre_specific", prompt: "indie rainy afternoon", mode: "strict", length: 25, expectedGenres: ["indie", "alternative"], expectedEnergy: "low", tags: ["genre"] },
  { id: "genre-metal-gym", category: "genre_specific", prompt: "metal gym workout", mode: "strict", length: 25, expectedGenres: ["metal", "rock"], expectedEnergy: "high", expectedIdentity: "gym_beast", tags: ["genre", "activity"] },
  { id: "genre-pop-party", category: "genre_specific", prompt: "pop party classics", mode: "strict", length: 30, expectedGenres: ["pop", "dance"], expectedEnergy: "high", expectedIdentity: "party_social", tags: ["genre", "party"] },
];

const eraSpecific = [
  { prompt: "60s road trip", era: { start: 1960, end: 1969 } },
  { prompt: "70s rock evening", era: { start: 1970, end: 1979 } },
  { prompt: "80s night drive", era: { start: 1980, end: 1989 } },
  { prompt: "90s alternative rainy night", era: { start: 1990, end: 1999 } },
  { prompt: "2000s pop punk party", era: { start: 2000, end: 2009 } },
  { prompt: "2010s indie summer", era: { start: 2010, end: 2019 } },
  { prompt: "newer favourites discovery", era: { start: 2020, end: 2026 } },
  { prompt: "old school hip hop", era: { start: 1985, end: 2005 } },
].map((item, index): PlaylistBenchmarkPrompt => ({
  id: `era-${index + 1}`,
  category: "era_specific",
  prompt: item.prompt,
  mode: "strict",
  length: 25,
  expectedEra: item.era,
  expectedEnergy: "medium",
  tags: ["era", "strict"],
}));

const moodSpecific = [
  { prompt: "happy sad driving night sunrise energy chill workout", energy: "medium", valence: "medium" },
  { prompt: "sad upbeat music", energy: "medium", valence: "low" },
  { prompt: "melancholic but moving", energy: "medium", valence: "low" },
  { prompt: "euphoric summer evening", energy: "high", valence: "high" },
  { prompt: "angry but controlled", energy: "high", valence: "low" },
  { prompt: "warm comfort songs", energy: "low", valence: "medium" },
  { prompt: "lonely late night", energy: "low", valence: "low" },
  { prompt: "confident getting ready", energy: "high", valence: "high" },
].map((item, index): PlaylistBenchmarkPrompt => ({
  id: `mood-${index + 1}`,
  category: "mood_specific",
  prompt: item.prompt,
  mode: "balanced",
  length: 25,
  expectedEnergy: item.energy as PlaylistBenchmarkPrompt["expectedEnergy"],
  expectedValence: item.valence as PlaylistBenchmarkPrompt["expectedValence"],
  tags: ["mood"],
}));

const mixed = [
  "garage with friends Saturday night",
  "bank holiday garage day with friends summer",
  "music when you don't know what you feel",
  "backroads drive with girlfriend in a 90s car",
  "beer fixing cars chatting rubbish with mates",
  "rainy gym but still energetic",
  "focus playlist with a bit of bounce",
  "night urban high energy garage with friends",
].map((prompt, index): PlaylistBenchmarkPrompt => ({
  id: `mixed-${index + 1}`,
  category: "mixed",
  prompt,
  mode: "balanced",
  length: 30,
  expectedEnergy: index === 5 || index === 7 ? "high" : "medium",
  expectedIdentity: index === 5 ? "gym_beast" : index === 6 ? "focus_minimalist" : "balanced_curator",
  tags: ["mixed"],
}));

const contradictory = [
  "sleepy gym workout",
  "sad party bangers",
  "chaotic deep focus no distractions",
  "aggressive chill evening",
  "silent club night",
  "happy funeral songs",
  "fast ambient study",
  "depressing summer party",
].map((prompt, index): PlaylistBenchmarkPrompt => ({
  id: `contradictory-${index + 1}`,
  category: "contradictory",
  prompt,
  mode: index === 2 ? "chaotic" : "balanced",
  length: 25,
  expectedEnergy: index === 0 || index === 1 || index === 7 ? "high" : "medium",
  tags: ["contradictory", "edge_case"],
}));

const discovery = [
  "discover new music",
  "songs I forgot I liked",
  "hidden gems from my library",
  "surprise me but keep it coherent",
  "deep cuts for tonight",
  "rediscover old favourites",
  "new-to-me energy playlist",
  "balanced discovery mix",
].map((prompt, index): PlaylistBenchmarkPrompt => ({
  id: `discovery-${index + 1}`,
  category: "discovery",
  prompt,
  mode: index === 3 ? "chaotic" : "balanced",
  length: 30,
  expectedEnergy: "medium",
  tags: ["discovery"],
}));

const edgeCase = [
  "vibe",
  "music",
  "night",
  "winter cozy not christmas",
  "holiday but not festive",
  "xmas party",
  "zzzzzz obscure thing",
  "americarna red-dirt cowboy county",
].map((prompt, index): PlaylistBenchmarkPrompt => ({
  id: `edge-${index + 1}`,
  category: "edge_case",
  prompt,
  mode: index >= 3 ? "strict" : "balanced",
  length: 25,
  expectedEnergy: "medium",
  expectedGenres: index === 7 ? ["country", "red dirt", "americana"] : undefined,
  tags: ["edge_case", index === 7 ? "misspelling" : "vague"],
}));

const launchCalibrationSeeds: Array<{
  prompt: string;
  category: PlaylistBenchmarkCategory;
  mode?: PlaylistBenchmarkPrompt["mode"];
  length?: number;
  expectedGenres?: string[];
  expectedEra?: { start: number; end: number };
  expectedEnergy?: PlaylistBenchmarkPrompt["expectedEnergy"];
  expectedValence?: PlaylistBenchmarkPrompt["expectedValence"];
  expectedIdentity?: string;
  tags: string[];
}> = [
  { prompt: "90s neon nite driv tekk vibey but hard", category: "driving", mode: "strict", expectedGenres: ["techno", "electronic"], expectedEra: { start: 1988, end: 2002 }, expectedEnergy: "high", expectedIdentity: "drive_nostalgic", tags: ["launch_calibration", "slang", "fragmented", "typo", "era"] },
  { prompt: "garage with mates fixing cars", category: "mixed", expectedEnergy: "medium", tags: ["launch_calibration", "british", "social", "activity", "environment"] },
  { prompt: "old school ravey stuff", category: "genre_specific", mode: "strict", expectedGenres: ["rave", "electronic", "dance"], expectedEra: { start: 1988, end: 2005 }, expectedEnergy: "high", tags: ["launch_calibration", "slang", "era", "genre"] },
  { prompt: "late night motorway in the rain", category: "driving", expectedEnergy: "medium", expectedValence: "low", expectedIdentity: "drive_nostalgic", tags: ["launch_calibration", "british", "environment", "scene"] },
  { prompt: "lofi but not boring", category: "focus", expectedGenres: ["lo-fi", "lofi", "electronic"], expectedEnergy: "medium", expectedIdentity: "focus_minimalist", tags: ["launch_calibration", "contradictory", "shorthand"] },
  { prompt: "pub garden after work but still lively", category: "party", expectedEnergy: "medium", expectedValence: "high", expectedIdentity: "party_social", tags: ["launch_calibration", "british", "social", "activity"] },
  { prompt: "mardy rainy bus home", category: "chill", expectedEnergy: "low", expectedValence: "low", tags: ["launch_calibration", "british", "slang", "transit"] },
  { prompt: "proper gassed pres before town", category: "party", expectedEnergy: "high", expectedIdentity: "party_social", tags: ["launch_calibration", "british", "slang", "social"] },
  { prompt: "uni kitchen pres messy but happy", category: "party", expectedEnergy: "high", expectedValence: "high", expectedIdentity: "party_social", tags: ["launch_calibration", "british", "social", "environment"] },
  { prompt: "drivin home after shift half dead", category: "driving", expectedEnergy: "low", expectedValence: "low", expectedIdentity: "drive_nostalgic", tags: ["launch_calibration", "typo", "activity", "fatigue"] },
  { prompt: "sunday garage cold hands warm mates", category: "mixed", expectedEnergy: "medium", expectedValence: "medium", tags: ["launch_calibration", "fragmented", "social", "environment"] },
  { prompt: "rain windscreen no talking", category: "driving", expectedEnergy: "low", expectedValence: "low", expectedIdentity: "drive_nostalgic", tags: ["launch_calibration", "fragmented", "environment"] },
  { prompt: "city lights but not clubby", category: "chill", expectedEnergy: "medium", tags: ["launch_calibration", "contradictory", "environment"] },
  { prompt: "old corsa night drive cheap speakers", category: "driving", expectedEra: { start: 1995, end: 2010 }, expectedEnergy: "medium", expectedIdentity: "drive_nostalgic", tags: ["launch_calibration", "scene", "era", "environment"] },
  { prompt: "cleaning room finding old photos", category: "nostalgic", expectedEnergy: "low", expectedValence: "medium", tags: ["launch_calibration", "activity", "nostalgia"] },
  { prompt: "study but not sleepy please", category: "study", expectedEnergy: "medium", expectedIdentity: "focus_minimalist", tags: ["launch_calibration", "contradictory", "activity"] },
  { prompt: "gym but anxious not angry", category: "gym", expectedEnergy: "high", expectedValence: "low", expectedIdentity: "gym_beast", tags: ["launch_calibration", "mixed_emotion", "negation"] },
  { prompt: "party but heartbroken", category: "party", expectedEnergy: "high", expectedValence: "low", expectedIdentity: "party_social", tags: ["launch_calibration", "contradictory", "mixed_emotion"] },
  { prompt: "sad but I need to move", category: "mixed", expectedEnergy: "medium", expectedValence: "low", tags: ["launch_calibration", "mixed_emotion", "abstract"] },
  { prompt: "angry walk home in drizzle", category: "mixed", expectedEnergy: "medium", expectedValence: "low", tags: ["launch_calibration", "activity", "environment", "emotion"] },
  { prompt: "motorway rain 2am no destination", category: "driving", expectedEnergy: "medium", expectedValence: "low", expectedIdentity: "drive_nostalgic", tags: ["launch_calibration", "fragmented", "scene"] },
  { prompt: "warehouse tekk sweat concrete", category: "genre_specific", mode: "strict", expectedGenres: ["techno", "electronic"], expectedEnergy: "high", tags: ["launch_calibration", "fragmented", "genre", "environment"] },
  { prompt: "rave but older not tiktok", category: "genre_specific", mode: "strict", expectedGenres: ["rave", "electronic"], expectedEra: { start: 1988, end: 2010 }, expectedEnergy: "high", tags: ["launch_calibration", "era", "negation"] },
  { prompt: "naughties indie sleaze pres", category: "era_specific", mode: "strict", expectedGenres: ["indie", "rock", "pop"], expectedEra: { start: 2000, end: 2012 }, expectedEnergy: "high", tags: ["launch_calibration", "british", "era", "social"] },
  { prompt: "manchster rainy nite indie", category: "genre_specific", mode: "strict", expectedGenres: ["indie", "alternative", "rock"], expectedEnergy: "medium", expectedValence: "low", tags: ["launch_calibration", "typo", "british", "environment"] },
  { prompt: "brum underpass late bus", category: "mixed", expectedEnergy: "low", expectedValence: "low", tags: ["launch_calibration", "british", "environment", "transit"] },
  { prompt: "london tube 11pm tired but wired", category: "mixed", expectedEnergy: "medium", tags: ["launch_calibration", "british", "transit", "mixed_emotion"] },
  { prompt: "football training cold floodlights", category: "gym", expectedEnergy: "high", expectedIdentity: "gym_beast", tags: ["launch_calibration", "activity", "environment"] },
  { prompt: "five a side changing room hype", category: "gym", expectedEnergy: "high", expectedIdentity: "gym_beast", tags: ["launch_calibration", "british", "activity", "social"] },
  { prompt: "coding at 3am slightly feral", category: "focus", expectedEnergy: "medium", expectedIdentity: "focus_minimalist", tags: ["launch_calibration", "slang", "time", "activity"] },
  { prompt: "spreadsheet grind tea gone cold", category: "work", expectedEnergy: "low", expectedIdentity: "focus_minimalist", tags: ["launch_calibration", "work", "fragmented"] },
  { prompt: "emails but make it less dead", category: "work", expectedEnergy: "medium", expectedIdentity: "focus_minimalist", tags: ["launch_calibration", "work", "slang"] },
  { prompt: "focus pls no words no drama", category: "focus", mode: "strict", expectedEnergy: "low", expectedIdentity: "focus_minimalist", tags: ["launch_calibration", "shorthand", "negation"] },
  { prompt: "calm but with pulse", category: "focus", expectedEnergy: "medium", expectedIdentity: "focus_minimalist", tags: ["launch_calibration", "contradictory", "abstract"] },
  { prompt: "brain fog morning reset", category: "chill", expectedEnergy: "low", tags: ["launch_calibration", "abstract", "mood"] },
  { prompt: "new chapter not cringe", category: "mood_specific", expectedEnergy: "medium", expectedValence: "high", tags: ["launch_calibration", "abstract", "negation"] },
  { prompt: "main character but not cheesy", category: "mixed", expectedEnergy: "medium", tags: ["launch_calibration", "abstract", "negation"] },
  { prompt: "film ending walking home alone", category: "chill", expectedEnergy: "low", expectedValence: "low", tags: ["launch_calibration", "abstract", "scene"] },
  { prompt: "villain arc gym no corny stuff", category: "gym", expectedEnergy: "high", expectedIdentity: "gym_beast", tags: ["launch_calibration", "abstract", "activity", "negation"] },
  { prompt: "soft apocalypse sunrise", category: "mixed", expectedEnergy: "medium", expectedValence: "medium", tags: ["launch_calibration", "abstract", "contradictory"] },
  { prompt: "nostalgic but futuristic", category: "contradictory", expectedEnergy: "medium", tags: ["launch_calibration", "contradictory", "abstract"] },
  { prompt: "happy but it hurts", category: "mood_specific", expectedEnergy: "medium", expectedValence: "medium", tags: ["launch_calibration", "mixed_emotion", "abstract"] },
  { prompt: "quiet rage", category: "mood_specific", expectedEnergy: "medium", expectedValence: "low", tags: ["launch_calibration", "contradictory", "emotion"] },
  { prompt: "peaceful panic", category: "contradictory", expectedEnergy: "medium", expectedValence: "low", tags: ["launch_calibration", "contradictory", "emotion"] },
  { prompt: "romantic but doomed", category: "mood_specific", expectedEnergy: "low", expectedValence: "low", tags: ["launch_calibration", "mixed_emotion"] },
  { prompt: "summer but lonely", category: "mood_specific", expectedEnergy: "medium", expectedValence: "low", tags: ["launch_calibration", "mixed_emotion", "season"] },
  { prompt: "winter but no christmas obviously", category: "chill", mode: "strict", expectedEnergy: "low", tags: ["launch_calibration", "negation", "season"] },
  { prompt: "holiday but not festive", category: "edge_case", mode: "strict", expectedEnergy: "medium", tags: ["launch_calibration", "negation", "edge_case"] },
  { prompt: "xmas party actual christmas", category: "party", mode: "strict", expectedEnergy: "high", expectedValence: "high", tags: ["launch_calibration", "season", "party"] },
  { prompt: "bonfire night walk home", category: "mixed", expectedEnergy: "medium", expectedValence: "medium", tags: ["launch_calibration", "british", "event", "scene"] },
  { prompt: "freshers flu pre drinks", category: "party", expectedEnergy: "medium", expectedIdentity: "party_social", tags: ["launch_calibration", "british", "social", "mixed_emotion"] },
  { prompt: "first date nerves warm pub", category: "mood_specific", expectedEnergy: "medium", expectedValence: "medium", tags: ["launch_calibration", "social", "emotion"] },
  { prompt: "after breakup cleaning flat", category: "chill", expectedEnergy: "low", expectedValence: "low", tags: ["launch_calibration", "activity", "emotion"] },
  { prompt: "moving house boxes everywhere", category: "work", expectedEnergy: "medium", tags: ["launch_calibration", "activity", "environment"] },
  { prompt: "airport 5am half asleep", category: "mixed", expectedEnergy: "low", tags: ["launch_calibration", "transit", "time"] },
  { prompt: "train window grey morning", category: "chill", expectedEnergy: "low", expectedValence: "low", tags: ["launch_calibration", "transit", "environment"] },
  { prompt: "coach trip lads sleeping", category: "driving", expectedEnergy: "low", tags: ["launch_calibration", "british", "social", "transit"] },
  { prompt: "passenger seat princess night", category: "driving", expectedEnergy: "medium", expectedIdentity: "drive_nostalgic", tags: ["launch_calibration", "slang", "social", "driving"] },
  { prompt: "bike shed summer evening", category: "chill", expectedEnergy: "medium", expectedValence: "high", tags: ["launch_calibration", "environment", "season"] },
  { prompt: "welding in garage focus", category: "focus", expectedEnergy: "medium", expectedIdentity: "focus_minimalist", tags: ["launch_calibration", "activity", "environment"] },
  { prompt: "painting room late night", category: "focus", expectedEnergy: "low", tags: ["launch_calibration", "activity", "environment"] },
  { prompt: "cooking for mates warm chaos", category: "party", expectedEnergy: "medium", expectedValence: "high", expectedIdentity: "party_social", tags: ["launch_calibration", "social", "activity"] },
  { prompt: "bbq but cloudy", category: "party", expectedEnergy: "medium", expectedValence: "high", tags: ["launch_calibration", "social", "contradictory"] },
  { prompt: "garden beers not too rowdy", category: "party", expectedEnergy: "medium", expectedValence: "high", expectedIdentity: "party_social", tags: ["launch_calibration", "british", "social", "negation"] },
  { prompt: "club queue freezing", category: "party", expectedEnergy: "high", expectedIdentity: "party_social", tags: ["launch_calibration", "social", "environment"] },
  { prompt: "afterparty kitchen sunrise", category: "party", expectedEnergy: "medium", expectedIdentity: "party_social", tags: ["launch_calibration", "social", "time"] },
  { prompt: "rave comedown bus home", category: "chill", expectedGenres: ["electronic", "dance"], expectedEnergy: "low", expectedValence: "low", tags: ["launch_calibration", "genre", "transit", "mixed_emotion"] },
  { prompt: "jungle classics but not too mad", category: "genre_specific", mode: "strict", expectedGenres: ["jungle", "drum and bass", "electronic"], expectedEnergy: "high", tags: ["launch_calibration", "genre", "negation"] },
  { prompt: "liquid dnb rainy focus", category: "focus", mode: "strict", expectedGenres: ["drum and bass", "dnb", "electronic"], expectedEnergy: "medium", expectedIdentity: "focus_minimalist", tags: ["launch_calibration", "genre", "activity"] },
  { prompt: "speed garage night bus", category: "genre_specific", mode: "strict", expectedGenres: ["garage", "uk garage", "electronic"], expectedEnergy: "high", tags: ["launch_calibration", "genre", "transit"] },
  { prompt: "grime walk through estate", category: "genre_specific", mode: "strict", expectedGenres: ["grime", "rap", "hip hop"], expectedEnergy: "high", tags: ["launch_calibration", "genre", "environment"] },
  { prompt: "old skool dubstep dark room", category: "genre_specific", mode: "strict", expectedGenres: ["dubstep", "electronic"], expectedEra: { start: 2005, end: 2012 }, expectedEnergy: "medium", tags: ["launch_calibration", "genre", "era"] },
  { prompt: "bloghouse messy indie dance", category: "genre_specific", mode: "strict", expectedGenres: ["electronic", "indie", "dance"], expectedEra: { start: 2005, end: 2012 }, expectedEnergy: "high", tags: ["launch_calibration", "genre", "era"] },
  { prompt: "madchester pub walk", category: "genre_specific", mode: "strict", expectedGenres: ["madchester", "indie", "rock"], expectedEra: { start: 1988, end: 1996 }, expectedEnergy: "medium", tags: ["launch_calibration", "genre", "era", "british"] },
  { prompt: "britpop sunny bus ride", category: "genre_specific", mode: "strict", expectedGenres: ["britpop", "rock", "indie"], expectedEra: { start: 1993, end: 2002 }, expectedEnergy: "medium", tags: ["launch_calibration", "genre", "era"] },
  { prompt: "quiet storm rnb raining", category: "genre_specific", mode: "strict", expectedGenres: ["rnb", "soul", "quiet storm"], expectedEnergy: "low", expectedValence: "low", tags: ["launch_calibration", "genre", "mood"] },
  { prompt: "neo soul cooking evening", category: "chill", expectedGenres: ["soul", "rnb"], expectedEnergy: "low", expectedValence: "medium", tags: ["launch_calibration", "genre", "activity"] },
  { prompt: "alt country petrol station", category: "genre_specific", mode: "strict", expectedGenres: ["country", "americana", "folk"], expectedEnergy: "medium", tags: ["launch_calibration", "genre", "environment"] },
  { prompt: "red dirt truck stop rain", category: "genre_specific", mode: "strict", expectedGenres: ["country", "red dirt", "americana"], expectedEnergy: "medium", expectedValence: "low", tags: ["launch_calibration", "genre", "environment"] },
  { prompt: "county music cowboy sad", category: "genre_specific", mode: "strict", expectedGenres: ["country", "americana"], expectedEnergy: "medium", expectedValence: "low", tags: ["launch_calibration", "typo", "genre"] },
  { prompt: "americarna dusty road", category: "genre_specific", mode: "strict", expectedGenres: ["americana", "country", "folk"], expectedEnergy: "medium", tags: ["launch_calibration", "typo", "genre"] },
  { prompt: "shoegazy rainy corridor", category: "genre_specific", mode: "strict", expectedGenres: ["shoegaze", "indie", "alternative"], expectedEnergy: "medium", expectedValence: "low", tags: ["launch_calibration", "slang", "genre"] },
  { prompt: "dream pop bedroom floor", category: "chill", expectedGenres: ["dream pop", "indie", "pop"], expectedEnergy: "low", tags: ["launch_calibration", "genre", "environment"] },
  { prompt: "post punk cold city", category: "genre_specific", mode: "strict", expectedGenres: ["post punk", "rock", "alternative"], expectedEnergy: "medium", expectedValence: "low", tags: ["launch_calibration", "genre", "environment"] },
  { prompt: "goth but danceable", category: "genre_specific", mode: "strict", expectedGenres: ["goth", "post punk", "alternative", "electronic"], expectedEnergy: "medium", expectedValence: "low", tags: ["launch_calibration", "genre", "contradictory"] },
  { prompt: "metal but not screamy gym", category: "gym", mode: "strict", expectedGenres: ["metal", "rock"], expectedEnergy: "high", expectedIdentity: "gym_beast", tags: ["launch_calibration", "genre", "negation", "activity"] },
  { prompt: "rap but introspective night", category: "genre_specific", mode: "strict", expectedGenres: ["rap", "hip hop"], expectedEnergy: "medium", expectedValence: "low", tags: ["launch_calibration", "genre", "mixed_emotion"] },
  { prompt: "conscious rap rainy bus", category: "genre_specific", mode: "strict", expectedGenres: ["rap", "hip hop"], expectedEnergy: "medium", tags: ["launch_calibration", "genre", "transit"] },
  { prompt: "phonk gym but not meme", category: "gym", mode: "strict", expectedGenres: ["phonk", "hip hop", "electronic"], expectedEnergy: "high", expectedIdentity: "gym_beast", tags: ["launch_calibration", "genre", "negation"] },
  { prompt: "hyperpop getting ready", category: "party", mode: "strict", expectedGenres: ["hyperpop", "pop", "electronic"], expectedEnergy: "high", expectedIdentity: "party_social", tags: ["launch_calibration", "genre", "activity"] },
  { prompt: "city pop midnight clean", category: "chill", mode: "strict", expectedGenres: ["city pop", "pop"], expectedEnergy: "medium", tags: ["launch_calibration", "genre", "time"] },
  { prompt: "anime ost study but cool", category: "study", mode: "strict", expectedGenres: ["soundtrack", "anime"], expectedEnergy: "medium", expectedIdentity: "focus_minimalist", tags: ["launch_calibration", "genre", "activity"] },
  { prompt: "video game loading screen nostalgia", category: "gaming", expectedEnergy: "medium", tags: ["launch_calibration", "gaming", "nostalgia"] },
  { prompt: "boss fight but emotional", category: "gaming", expectedEnergy: "high", expectedValence: "medium", tags: ["launch_calibration", "gaming", "mixed_emotion"] },
  { prompt: "cozy minecraft rain", category: "gaming", expectedEnergy: "low", expectedValence: "medium", tags: ["launch_calibration", "gaming", "environment"] },
  { prompt: "racing game night motorway", category: "gaming", expectedEnergy: "high", tags: ["launch_calibration", "gaming", "driving"] },
  { prompt: "cyberpunk alley 3am", category: "gaming", expectedEnergy: "medium", expectedValence: "low", tags: ["launch_calibration", "gaming", "environment", "time"] },
  { prompt: "🛣️🌧️ 2am drive", category: "driving", expectedEnergy: "medium", expectedValence: "low", expectedIdentity: "drive_nostalgic", tags: ["launch_calibration", "emoji", "driving", "environment"] },
  { prompt: "🔥 gym rage", category: "gym", expectedEnergy: "high", expectedIdentity: "gym_beast", tags: ["launch_calibration", "emoji", "activity"] },
  { prompt: "💔 but dancing", category: "party", expectedEnergy: "high", expectedValence: "low", expectedIdentity: "party_social", tags: ["launch_calibration", "emoji", "contradictory"] },
  { prompt: "🌧️ window sad indie", category: "genre_specific", expectedGenres: ["indie", "alternative"], expectedEnergy: "low", expectedValence: "low", tags: ["launch_calibration", "emoji", "genre"] },
  { prompt: "🛠️ garage tunes", category: "mixed", expectedEnergy: "medium", tags: ["launch_calibration", "emoji", "activity"] },
  { prompt: "🌅 new start", category: "mood_specific", expectedEnergy: "medium", expectedValence: "high", tags: ["launch_calibration", "emoji", "abstract"] },
  { prompt: "😎 pres bangers", category: "party", expectedEnergy: "high", expectedValence: "high", expectedIdentity: "party_social", tags: ["launch_calibration", "emoji", "slang"] },
  { prompt: "😴 focus but awake", category: "focus", expectedEnergy: "medium", expectedIdentity: "focus_minimalist", tags: ["launch_calibration", "emoji", "contradictory"] },
  { prompt: "late nite rd trip", category: "driving", expectedEnergy: "medium", expectedIdentity: "drive_nostalgic", tags: ["launch_calibration", "shorthand", "typo"] },
  { prompt: "gym rn hard no skips", category: "gym", expectedEnergy: "high", expectedIdentity: "gym_beast", tags: ["launch_calibration", "shorthand", "activity"] },
  { prompt: "study sesh lowkey", category: "study", expectedEnergy: "low", expectedIdentity: "focus_minimalist", tags: ["launch_calibration", "shorthand", "slang"] },
  { prompt: "sad-ish drive ish", category: "driving", expectedEnergy: "medium", expectedValence: "low", expectedIdentity: "drive_nostalgic", tags: ["launch_calibration", "shorthand", "mixed_emotion"] },
  { prompt: "not boring not loud just locked in", category: "focus", expectedEnergy: "medium", expectedIdentity: "focus_minimalist", tags: ["launch_calibration", "negation", "fragmented"] },
  { prompt: "no sad no cheesy upbeat clean room", category: "chill", expectedEnergy: "medium", expectedValence: "high", tags: ["launch_calibration", "negation", "activity"] },
  { prompt: "not christmas winter warmth", category: "chill", mode: "strict", expectedEnergy: "low", tags: ["launch_calibration", "negation", "season"] },
  { prompt: "not gym but still pumped", category: "mood_specific", expectedEnergy: "high", tags: ["launch_calibration", "negation", "activity"] },
  { prompt: "no rap just heavy workout", category: "gym", mode: "strict", expectedGenres: ["rock", "metal"], expectedEnergy: "high", expectedIdentity: "gym_beast", tags: ["launch_calibration", "negation", "genre"] },
  { prompt: "no guitar electronic focus", category: "focus", mode: "strict", expectedGenres: ["electronic", "ambient"], expectedEnergy: "low", expectedIdentity: "focus_minimalist", tags: ["launch_calibration", "negation", "genre"] },
  { prompt: "warm sad old songs not depressing", category: "nostalgic", expectedEnergy: "low", expectedValence: "low", tags: ["launch_calibration", "mixed_emotion", "negation"] },
  { prompt: "energetic but emotionally ruined", category: "mood_specific", expectedEnergy: "high", expectedValence: "low", tags: ["launch_calibration", "mixed_emotion", "contradictory"] },
  { prompt: "dark but safe", category: "chill", expectedEnergy: "low", expectedValence: "low", tags: ["launch_calibration", "mixed_emotion", "abstract"] },
  { prompt: "bright but anxious", category: "mood_specific", expectedEnergy: "medium", expectedValence: "medium", tags: ["launch_calibration", "mixed_emotion", "contradictory"] },
  { prompt: "empty but hopeful", category: "mood_specific", expectedEnergy: "low", expectedValence: "medium", tags: ["launch_calibration", "mixed_emotion", "abstract"] },
  { prompt: "fast but calm", category: "contradictory", expectedEnergy: "medium", tags: ["launch_calibration", "contradictory"] },
  { prompt: "slow but hype", category: "contradictory", expectedEnergy: "medium", tags: ["launch_calibration", "contradictory"] },
  { prompt: "party for introverts", category: "party", expectedEnergy: "medium", expectedIdentity: "party_social", tags: ["launch_calibration", "contradictory", "social"] },
  { prompt: "alone in crowd", category: "mood_specific", expectedEnergy: "medium", expectedValence: "low", tags: ["launch_calibration", "abstract", "social"] },
  { prompt: "music for pretending life is fine", category: "mood_specific", expectedEnergy: "medium", expectedValence: "low", tags: ["launch_calibration", "abstract", "mixed_emotion"] },
  { prompt: "playlist for a cancelled plan", category: "chill", expectedEnergy: "low", expectedValence: "low", tags: ["launch_calibration", "abstract", "social"] },
  { prompt: "songs for waiting outside in cold", category: "chill", expectedEnergy: "low", expectedValence: "low", tags: ["launch_calibration", "scene", "environment"] },
  { prompt: "music for walking past your old school", category: "nostalgic", expectedEnergy: "low", expectedValence: "low", tags: ["launch_calibration", "scene", "nostalgia"] },
  { prompt: "soundtrack to leaving town", category: "driving", expectedEnergy: "medium", expectedValence: "low", expectedIdentity: "drive_nostalgic", tags: ["launch_calibration", "abstract", "driving"] },
];

const launchCalibrationPrompts: PlaylistBenchmarkPrompt[] = launchCalibrationSeeds.map((seed, index) => ({
  id: `launch-calibration-${String(index + 1).padStart(3, "0")}`,
  category: seed.category,
  prompt: seed.prompt,
  mode: seed.mode ?? "balanced",
  length: seed.length ?? 30,
  expectedGenres: seed.expectedGenres,
  expectedEra: seed.expectedEra,
  expectedEnergy: seed.expectedEnergy,
  expectedValence: seed.expectedValence,
  expectedIdentity: seed.expectedIdentity,
  tags: seed.tags,
}));

const scalingScenes = [
  "rainy evening",
  "sunny morning",
  "late night",
  "long drive",
  "small gathering",
  "solo work",
  "weekend reset",
  "city walk",
  "country roads",
  "bedroom nostalgia",
  "pub night",
  "garage afternoon",
  "quiet library",
  "summer garden",
  "winter non christmas",
  "Friday commute",
  "Sunday clean up",
  "coding sprint",
  "gaming lobby",
  "old favourites",
  "new discoveries",
  "gym warm up",
  "study break",
  "after work",
  "midnight focus",
  "road trip",
  "pre drinks",
  "calm dinner",
  "festival memory",
  "low mood lift",
  "high energy reset",
  "mellow background",
] as const;

const scalingIntents: Array<Pick<PlaylistBenchmarkPrompt, "category" | "mode" | "expectedEnergy" | "expectedIdentity"> & { label: string }> = [
  { label: "steady focus", category: "focus", mode: "balanced", expectedEnergy: "low", expectedIdentity: "focus_minimalist" },
  { label: "work flow", category: "work", mode: "balanced", expectedEnergy: "low", expectedIdentity: "focus_minimalist" },
  { label: "study session", category: "study", mode: "balanced", expectedEnergy: "low", expectedIdentity: "focus_minimalist" },
  { label: "gym momentum", category: "gym", mode: "balanced", expectedEnergy: "high", expectedIdentity: "gym_beast" },
  { label: "party energy", category: "party", mode: "balanced", expectedEnergy: "high", expectedIdentity: "party_social" },
  { label: "driving flow", category: "driving", mode: "balanced", expectedEnergy: "medium", expectedIdentity: "drive_nostalgic" },
  { label: "warm chill", category: "chill", mode: "balanced", expectedEnergy: "low", expectedIdentity: "chill_warm" },
  { label: "discovery mix", category: "discovery", mode: "balanced", expectedEnergy: "medium", expectedIdentity: "balanced_curator" },
  { label: "nostalgic mix", category: "nostalgic", mode: "balanced", expectedEnergy: "medium", expectedIdentity: "balanced_curator" },
  { label: "gaming energy", category: "gaming", mode: "chaotic", expectedEnergy: "high", expectedIdentity: "balanced_curator" },
  { label: "mixed mood", category: "mixed", mode: "balanced", expectedEnergy: "medium", expectedIdentity: "balanced_curator" },
  { label: "contradictory stress", category: "contradictory", mode: "balanced", expectedEnergy: "medium", expectedIdentity: "balanced_curator" },
];

const scalingPrompts: PlaylistBenchmarkPrompt[] = Array.from({ length: 130 }, (_, index) => {
  const scene = scalingScenes[index % scalingScenes.length]!;
  const intent = scalingIntents[index % scalingIntents.length]!;
  return {
    id: `scaling-${String(index + 1).padStart(3, "0")}`,
    category: intent.category,
    prompt: `${scene} ${intent.label}`,
    mode: intent.mode,
    length: index % 5 === 0 ? 20 : index % 7 === 0 ? 35 : 25,
    expectedEnergy: intent.expectedEnergy,
    expectedIdentity: intent.expectedIdentity,
    tags: ["scaling", scene.replace(/\s+/g, "_"), intent.label.replace(/\s+/g, "_")],
  };
});

export const PLAYLIST_BENCHMARK_PROMPTS: PlaylistBenchmarkPrompt[] = [
  ...gym,
  ...focus,
  ...party,
  ...driving,
  ...chill,
  ...launchCalibrationPrompts,
  ...study,
  ...work,
  ...gaming,
  ...nostalgic,
  ...genreSpecific,
  ...eraSpecific,
  ...moodSpecific,
  ...mixed,
  ...contradictory,
  ...discovery,
  ...edgeCase,
  ...scalingPrompts,
];

if (PLAYLIST_BENCHMARK_PROMPTS.length < 250) {
  throw new Error("Playlist benchmark suite must contain at least 250 prompts");
}

