/**
 * World Purity Gate — candidate identity before ranking.
 *
 * Family allowlists alone let classic rock pass a "goth" lock.
 * Energy / mood must never compensate for world mismatch.
 * Classic safety-blanket artists only belong in their natural worlds.
 */

import { resolveVagueWorldCommit } from "../../lib/vague-world-commit";
import {
  artistForbiddenInWorld,
  artistIdentityGenreEvidence,
  artistSupportsWorld,
} from "./artist-identity-map";
import {
  OPENER_FILLER_PATTERN,
  REMIX_EDIT_BAIT_TITLE,
  maxPsychIndieOpenersForWorlds,
  sanitizePsychIndieOpenerChain,
  trackArtistName,
  demoteRemixBaitOpeners,
  shouldSuppressVagueLandfillOpeners,
} from "./opener-hygiene";

export {
  OPENER_FILLER_PATTERN,
  maxPsychIndieOpenersForWorlds,
  sanitizePsychIndieOpenerChain,
} from "./opener-hygiene";

export type WorldIdentityProfile = {
  id: string;
  /** Positive evidence in title/artist/album/genres blob. */
  requireAny: RegExp[];
  /** Instant reject when world lock is active. */
  rejectAny: RegExp[];
  /** Optional audio bands (inclusive). Missing features soft-pass. */
  energy?: { min?: number; max?: number };
  valence?: { min?: number; max?: number };
  danceability?: { min?: number; max?: number };
  instrumentalness?: { min?: number; max?: number };
  /** Reject high-popularity arena bait in soft scenes. */
  maxPopularity?: number;
};

/**
 * Artists repeatedly injected when retrieval confidence drops.
 * Allowed only inside listed world ids (or classic_rock_world).
 */
export type SafetyBlanketArtist = {
  id: string;
  pattern: RegExp;
  /** Worlds where this artist is a legitimate prototype, not filler. */
  naturalWorlds: string[];
};

export const SAFETY_BLANKET_ARTISTS: SafetyBlanketArtist[] = [
  {
    id: "blondie",
    pattern: /\bblondie\b|\bdebbie\s+harry\b/i,
    naturalWorlds: ["classic_rock_world", "new_wave_world", "punk_new_wave"],
  },
  {
    id: "fleetwood_mac",
    pattern: /\bfleetwood\s+mac\b/i,
    naturalWorlds: ["classic_rock_world"],
  },
  {
    id: "queen",
    // Avoid matching "Queens of the Stone Age" and "Storm Queen".
    pattern: /(?<!\bstorm\s)\bqueen\b(?!\s+of\s+the\s+stone)/i,
    naturalWorlds: ["classic_rock_world"],
  },
  {
    id: "led_zeppelin",
    pattern: /\bled\s+zeppelin\b/i,
    naturalWorlds: ["classic_rock_world"],
  },
  {
    id: "acdc",
    pattern: /\bac\/?dc\b/i,
    naturalWorlds: ["classic_rock_world", "gym_rock_world", "angry_rock_world"],
  },
  {
    id: "guns_n_roses",
    pattern: /\bguns\s+n'?\s*roses\b|\bgnr\b/i,
    naturalWorlds: ["classic_rock_world", "gym_rock_world", "angry_rock_world"],
  },
  {
    id: "men_at_work",
    pattern: /\bmen\s+at\s+work\b/i,
    naturalWorlds: ["classic_rock_world"],
  },
  {
    id: "journey",
    pattern: /\bjourney\b/i,
    naturalWorlds: ["classic_rock_world"],
  },
  {
    id: "bon_jovi",
    pattern: /\bbon\s+jovi\b/i,
    naturalWorlds: ["classic_rock_world", "gym_rock_world"],
  },
  {
    id: "def_leppard",
    pattern: /\bdef\s+leppard\b/i,
    naturalWorlds: ["classic_rock_world", "gym_rock_world"],
  },
  // Psych-indie retrieval filler — appears at top of library scans across unrelated worlds.
  {
    id: "tame_impala",
    pattern: /\btame\s+impala\b/i,
    naturalWorlds: ["evening_drive_world", "indie_dream_world", "rave_comedown", "nostalgia_warm_world"],
  },
  {
    id: "kasabian",
    pattern: /\bkasabian\b/i,
    naturalWorlds: ["britpop_world", "nostalgia_warm_world", "grunge_world"],
  },
  {
    id: "q_lazzarus",
    pattern: /\bq\s+lazzarus\b/i,
    naturalWorlds: ["goth_world"],
  },
  {
    id: "glenn_frey",
    pattern: /\bglenn\s+frey\b/i,
    naturalWorlds: ["classic_rock_world", "evening_drive_world"],
  },
  {
    id: "arctic_monkeys",
    pattern: /\barctic\s+monkeys\b/i,
    naturalWorlds: ["indie_dream_world", "nostalgia_warm_world", "britpop_world"],
  },
  {
    id: "the_weeknd",
    pattern: /\bthe\s+weeknd\b/i,
    naturalWorlds: ["evening_drive_world", "rave_comedown", "rnb_night_world"],
  },
  {
    id: "bon_iver",
    pattern: /\bbon\s+iver\b/i,
    naturalWorlds: [
      "chill_rainy_world",
      "sunday_chill_world",
      "soft_sad_world",
      "rainy_reading_world",
      "acoustic_sunday_world",
      "film_ending_world",
      "indie_dream_world",
    ],
  },
  {
    id: "clairo",
    pattern: /\bclairo\b/i,
    naturalWorlds: [
      "beach_sunset_world",
      "first_date_world",
      "late_night_calm_world",
      "indie_dream_world",
      "sunday_chill_world",
    ],
  },
  {
    id: "noah_kahan",
    pattern: /\bnoah\s+kahan\b/i,
    naturalWorlds: ["indie_dream_world", "soft_sad_world", "sunday_chill_world"],
  },
  {
    id: "dayglow",
    pattern: /\bdayglow\b/i,
    naturalWorlds: ["beach_sunset_world", "indie_dream_world", "summer_warm_world"],
  },
  {
    id: "gregory_alan_isakov",
    pattern: /\bgregory\s+alan\s+isakov\b/i,
    naturalWorlds: ["acoustic_sunday_world", "rainy_reading_world", "indie_dream_world"],
  },
  {
    id: "badbadnotgood",
    pattern: /\bbadbadnotgood\b/i,
    naturalWorlds: ["evening_drive_world", "coffee_soft_focus_world", "late_night_calm_world"],
  },
  {
    id: "sufjan_stevens",
    pattern: /\bsufjan\s+stevens\b/i,
    naturalWorlds: [
      "indie_dream_world",
      "soft_sad_world",
      "sunday_chill_world",
      "rainy_reading_world",
      "acoustic_sunday_world",
      "film_ending_world",
    ],
  },
  {
    id: "phoebe_bridgers",
    pattern: /\bphoebe\s+bridgers\b/i,
    naturalWorlds: [
      "indie_dream_world",
      "soft_sad_world",
      "rainy_reading_world",
      "sunday_chill_world",
      "film_ending_world",
    ],
  },
  {
    id: "jake_bugg",
    pattern: /\bjake\s+bugg\b/i,
    naturalWorlds: ["indie_dream_world", "nostalgia_warm_world", "britpop_world"],
  },
  {
    id: "the_killers",
    pattern: /\bthe\s+killers\b/i,
    naturalWorlds: ["nostalgia_warm_world", "older_sibling_world", "britpop_world"],
  },
  {
    id: "mitski",
    pattern: /\bmitski\b/i,
    naturalWorlds: ["indie_dream_world", "soft_sad_world", "sunday_chill_world", "film_ending_world"],
  },
  {
    id: "beach_house",
    pattern: /\bbeach\s+house\b/i,
    naturalWorlds: ["beach_sunset_world", "indie_dream_world", "rainy_drive_world", "late_night_calm_world"],
  },
  {
    id: "joji",
    pattern: /\bjoji\b/i,
    naturalWorlds: ["indie_dream_world", "late_night_calm_world", "sunday_chill_world"],
  },
  {
    id: "mac_demarco",
    pattern: /\bmac\s+demarco\b/i,
    naturalWorlds: ["beach_sunset_world", "indie_dream_world", "sunday_chill_world", "acoustic_sunday_world"],
  },
  {
    id: "fleet_foxes",
    pattern: /\bfleet\s+foxes\b/i,
    naturalWorlds: ["acoustic_sunday_world", "rainy_reading_world", "indie_dream_world", "sunday_chill_world"],
  },
  {
    id: "iron_and_wine",
    pattern: /\biron\s+(?:&|and)\s+wine\b/i,
    naturalWorlds: ["acoustic_sunday_world", "rainy_reading_world", "chill_rainy_world", "coffee_soft_focus_world"],
  },
];

/** Worlds that must never use classic safety blankets as filler. */
const STRICT_WORLD_IDS = new Set([
  "goth_world",
  "grunge_world",
  "lofi_world",
  "ambient_world",
  "pop_punk_world",
  "gym_rock_world",
  "angry_rock_world",
  "classic_rock_world",
  "yacht_rock_world",
  "night_drive_world",
  "dad_secret_world",
  "neon_tek_drive",
  "boss_fight",
  "quiet_rage",
  "rave_comedown",
  "melancholy_drive",
  "sleepy_gym_world",
  "disco_party_world",
  "rainy_drive_world",
  "chill_rainy_world",
  "focus_study_world",
  "sunday_chill_world",
  "feel_good_world",
  "soft_sad_world",
  "social_kitchen_world",
  "coffee_soft_focus_world",
  "evening_drive_world",
  "upbeat_chore_world",
  "gym_energy_world",
  "indie_dream_world",
  "nostalgia_warm_world",
  "party_prep_world",
  "rainy_reading_world",
  "beach_sunset_world",
  "summer_warm_world",
  "acoustic_sunday_world",
  "late_night_calm_world",
  "rnb_night_world",
  "britpop_world",
  "madchester_world",
  "uk_garage_world",
  "indie_bedroom_world",
  "pub_singalong_world",
  "80s_night_drive_world",
  "rainy_motorway_world",
  "road_trip_singalong_world",
  "petrol_station_2am_world",
  "disco_1970s_world",
  "rooftop_party_world",
  "heavy_gym_world",
  "running_energy_world",
  "arena_rock_world",
  "dad_rock_world",
  "film_ending_world",
  "dad_secret_world",
  "older_sibling_world",
  "latin_summer_rooftop_world",
  "commute_world",
  "first_date_world",
]);

const GOTH_IDENTITY: WorldIdentityProfile = {
  id: "goth_world",
  requireAny: [
    /\b(?:goth|gothic|darkwave|coldwave|post[-\s]?punk|deathrock|batcave|ethereal|shoegaze|industrial|ebm|synth[-\s]?goth|dark\s+electronic)\b/i,
    /\b(?:the\s+cure|siouxsie|bauhaus|sisters\s+of\s+mercy|depeche\s+mode|joy\s+division|new\s+order|cocteau|clan\s+of\s+xymox|fields\s+of\s+the\s+nephilim|christian\s+death|type\s+o\s+negative|she\s+wants\s+revenge|she\s+past\s+away|lebanon\s+hanover|boy\s+harsher|soft\s+kill|drab\s+majesty)\b/i,
  ],
  rejectAny: [
    /\b(?:reggae|dancehall|reggaeton|hip[-\s]?hop|rap\b|trap\b|country|bluegrass|gospel|motown|disco|salsa|bachata|pop\s*punk|teen\s*pop)\b/i,
    /\b(?:all[-\s]?american\s+rejects|men\s+at\s+work|journey|bon\s+jovi|def\s+leppard|ac\/?dc|metallica|offspring|blink[-\s]?182|green\s+day|blondie|fleetwood\s+mac|queen\b(?!\s+of\s+the\s+stone)|led\s+zeppelin|guns\s+n'?\s*roses)\b/i,
    /\bgotham\b/i,
  ],
  energy: { max: 0.82 },
  valence: { max: 0.62 },
};

const LOFI_IDENTITY: WorldIdentityProfile = {
  id: "lofi_world",
  requireAny: [
    /\b(?:lo-?fi|lofi|chillhop|chill\s*hop|study\s+beats?|jazzy\s+hip|boom\s+bap|instrumental\s+hip|downtempo|chill\s+beats?|chillout|chill\s+out|soft\s+beats?|bedroom\s+beats?|jazz\s+hop|lofi\s+hip)\b/i,
    /\b(?:nujabes|j\s*dilla|tomppabeats|idealism|eevee|kupla|jinsang|saib|flovry|sleepy\s+fish|lofi\.?samurai|chillhop|kudasai|emancipator|bonobo|tycho|emancipator|joji|fujitsu|potsu|birocratic|homage)\b/i,
  ],
  rejectAny: [
    /\b(?:metal|hardcore|punk|grunge|arena\s+rock|classic\s+rock|country|reggae|gospel)\b/i,
    /\b(?:journey|the\s+killers|def\s+leppard|ac\/?dc|bon\s+jovi|guns\s+n'\s+roses|queen\b(?!\s+of\s+the\s+stone)|led\s+zeppelin|blondie|fleetwood)\b/i,
  ],
  energy: { max: 0.58 },
  danceability: { max: 0.75 },
};

const AMBIENT_IDENTITY: WorldIdentityProfile = {
  id: "ambient_world",
  requireAny: [
    /\b(?:ambient|soundscape|drone|new\s+age|neoclassical|modern\s+classical|instrumental|atmospheric|minimal)\b/i,
    /\b(?:brian\s+eno|aphex|boards\s+of\s+canada|tim\s+hecker|stars\s+of\s+the\s+lid|max\s+richter|\xF3lafur|olafur|nils\s+frahm|harold\s+budd)\b/i,
  ],
  rejectAny: [
    /\b(?:party|club|rave|gym|workout|screamo|death\s+metal|trap\b|drill\b)\b/i,
    /\b(?:clean\s+bandit|the\s+1975|faye\s+webster|bruno\s+mars|drake\b|queen\b(?!\s+of\s+the\s+stone)|blondie|fleetwood|led\s+zeppelin)\b/i,
  ],
  energy: { max: 0.48 },
  danceability: { max: 0.55 },
};

const GRUNGE_IDENTITY: WorldIdentityProfile = {
  id: "grunge_world",
  requireAny: [
    /\b(?:grunge|seattle|alt[-\s]?rock|alternative\s+rock|90s?\s+grunge|post[-\s]?grunge)\b/i,
    /\b(?:nirvana|pearl\s+jam|soundgarden|alice\s+in\s+chains|stone\s+temple|mudhoney|hole\b|screaming\s+trees|temple\s+of\s+the\s+dog|mad\s+season|smashing\s+pumpkins|candlebox|mother\s+love\s+bone|melvins|babes\s+in\s+toyland|l7\b|skin\s+yard)\b/i,
  ],
  rejectAny: [
    /\b(?:reggae|disco|country|latin|k-?pop|edm\b|house\b|techno|dance\s*pop|yacht\s*rock|soft\s*rock|pop\s*punk|skate\s*punk|emo\b|easycore)\b/i,
    /\b(?:green\s+day|blink[-\s]?182|sum\s+41|offspring|good\s+charlotte|simple\s+plan|paramore|fall\s+out\s+boy|my\s+chemical|new\s+found\s+glory|yellowcard|jimmy\s+eat\s+world|all[-\s]?american\s+rejects)\b/i,
    // Adjacent 90s alt/punk can reinforce; classic/new-wave safety blankets cannot.
    /\b(?:blondie|men\s+at\s+work|journey|fleetwood\s+mac|queen\b(?!\s+of\s+the\s+stone)|led\s+zeppelin|ac\/?dc|guns\s+n'?\s*roses|bon\s+jovi|def\s+leppard|kate\s+bush|bon\s+iver|clairo|noah\s+kahan|mitski|phoebe\s+bridgers|sufjan\s+stevens)\b/i,
  ],
};

const POP_PUNK_IDENTITY: WorldIdentityProfile = {
  id: "pop_punk_world",
  requireAny: [
    /\b(?:pop\s*punk|punk\s*rock|emo|easycore|skate\s*punk|alt[-\s]?punk)\b/i,
    /\b(?:blink[-\s]?182|green\s+day|sum\s+41|paramore|jimmy\s+eat\s+world|all[-\s]?american\s+rejects|fall\s+out\s+boy|my\s+chemical|new\s+found\s+glory|good\s+charlotte|simple\s+plan|yellowcard|taking\s+back\s+sunday|the\s+used|avocado)\b/i,
  ],
  rejectAny: [
    /\b(?:classic\s*rock|arena\s*rock|yacht\s*rock|disco|reggae|country|latin|dnb|drum\s*(?:and|&)\s*bass|uk\s*garage)\b/i,
    /\b(?:blondie|fleetwood\s+mac|queen\b(?!\s+of\s+the\s+stone)|led\s+zeppelin|ac\/?dc|guns\s+n'?\s*roses|men\s+at\s+work|journey|storm\s+queen)\b/i,
  ],
};

const GYM_ROCK_IDENTITY: WorldIdentityProfile = {
  id: "gym_rock_world",
  requireAny: [
    /\b(?:hard\s*rock|metal|punk|alt[-\s]?rock|alternative\s*rock|grunge|post[-\s]?grunge|nu[-\s]?metal|garage\s*rock|punk\s*rock|stadium\s*rock|pop\s*punk)\b/i,
    /\b(?:ac\/?dc|metallica|foo\s+fighters|queens?\s+of\s+the\s+stone|rage\s+against|linkin\s+park|disturbed|godsmack|offspring|green\s+day|guns\s+n'?\s*roses|paramore|fall\s+out\s+boy|all[-\s]?american\s+rejects|the\s+clash|sonic\s+youth)\b/i,
  ],
  rejectAny: [
    /\b(?:disco|dance\s*pop|house\b|techno|reggaeton|latin|uk\s*garage|garage\s*house|bassline|soft\s*rock|yacht\s*rock|singer[-\s]?songwriter|glam\s*rock|prog(?:ressive)?\s*rock|yacht|deep\s*house|future\s*house|tech\s*house)\b/i,
    /\b(?:blondie|fleetwood\s+mac|led\s+zeppelin|storm\s+queen|mexican\s+institute|bee\s+gees|abba|chaka\s+khan|men\s+at\s+work|journey|craig\s+david|hannah\s+laing|kurupt\s+fm|artful\s+dodger|conducta|scooter)\b|(?<!\bstorm\s)\bqueen\b(?!\s+of\s+the\s+stone)/i,
  ],
  energy: { min: 0.55 },
};

const ANGRY_ROCK_IDENTITY: WorldIdentityProfile = {
  id: "angry_rock_world",
  requireAny: [
    /\b(?:metal|punk|hardcore|grunge|nu[-\s]?metal|industrial|alt[-\s]?rock|hard\s*rock|metalcore|post[-\s]?hardcore|pop\s*punk)\b/i,
    /\b(?:rage\s+against|system\s+of\s+a\s+down|slipknot|metallica|tool\b|nine\s+inch|foo\s+fighters|queens?\s+of\s+the\s+stone|disturbed|godsmack|offspring|green\s+day|ac\/?dc|paramore|guns\s+n'?\s*roses)\b/i,
  ],
  rejectAny: [
    /\b(?:disco|dance\s*pop|house\b|edm\b|uk\s*garage|soft\s*rock|yacht\s*rock|folk\b|country|latin|glam\s*rock|ballad|acoustic|interlude|the\s+only\s+exception|not\s+angry\s+anymore|hard\s+times)\b/i,
    /\b(?:blondie|fleetwood\s+mac|led\s+zeppelin|storm\s+queen|bee\s+gees|abba|men\s+at\s+work|journey|craig\s+david|hannah\s+laing|scooter)\b|(?<!\bstorm\s)\bqueen\b(?!\s+of\s+the\s+stone)/i,
  ],
  energy: { min: 0.58 },
  valence: { max: 0.55 },
};

const SLEEPY_GYM_IDENTITY: WorldIdentityProfile = {
  id: "sleepy_gym_world",
  requireAny: [
    /\b(?:chill|downtempo|ambient|lo-?fi|soft\s+electronic|dream\s+pop|trip\s+hop|deep\s+house|chillwave|indietronica|bedroom\s+pop|soft\s+indie|indie\s+electronic|synthy?\s+pop|shoegaze|slowcore|chillhop|chill\s*hop|soft\s+rock|mellow|synth\s*pop|indie\s*pop|electropop|alt\s*pop|tropical\s*house|future\s*bass|organic\s*house|warm\s*up)\b/i,
    /\b(?:bonobo|boards\s+of\s+canada|beach\s+house|washes?\b|tomppabeats|nujabes|emancipator|tycho|khruangbin|tame\s+impala|m83|chvrches|passion\s+pit|odesza|flume|disclosure|kygo|san\s+hol|lane\s+8|caribou|four\s+tet|james\s+blake|frank\s+ocean|the\s+1975|alt[-\s]?j|glass\s+animals|still\s+woozy|clairo|beabadoobee)\b/i,
  ],
  rejectAny: [
    /\b(?:drum\s*(?:and|&)\s*bass|dnb|jump\s+up|brostep|pop\s*punk|classic\s*rock|arena\s*rock|hardcore|screamo|metal|nu[-\s]?metal|hard\s+rock|gym\s+banger)\b/i,
    /\b(?:blondie|fleetwood\s+mac|queen\b(?!\s+of\s+the\s+stone)|led\s+zeppelin|ac\/?dc|paramore|queens?\s+of\s+the\s+stone|metallica|slipknot|rage\s+against)\b/i,
  ],
  energy: { max: 0.58 },
  valence: { max: 0.65 },
};

const CLASSIC_ROCK_IDENTITY: WorldIdentityProfile = {
  id: "classic_rock_world",
  requireAny: [
    /\b(?:classic\s*rock|70s?\s*rock|seventies|arena\s*rock|hard\s*rock|blues\s*rock|prog|progressive\s*rock|glam)\b/i,
    /\b(?:led\s+zeppelin|queen\b(?!\s+of\s+the\s+stone)|fleetwood\s+mac|pink\s+floyd|the\s+who|deep\s+purple|black\s+sabbath|david\s+bowie|eagles\b|aerosmith|ac\/?dc|blondie|men\s+at\s+work)\b/i,
  ],
  rejectAny: [
    /\b(?:trap\b|drill\b|reggaeton|k-?pop|hyperpop|uk\s*garage|grime|phonk)\b/i,
    /\b(?:bon\s+iver|clairo|noah\s+kahan|dayglow|gregory\s+alan\s+isakov|badbadnotgood)\b/i,
  ],
};

const BOSS_FIGHT_IDENTITY: WorldIdentityProfile = {
  id: "boss_fight",
  requireAny: [
    /\b(?:metal|metalcore|industrial|electronic|synth|soundtrack|ost|epic|orchestral|trailer|hybrid|drum\s+and\s+bass|dnb|hardstyle|breakcore|cinematic|darksynth|aggrotech)\b/i,
    /\b(?:boss|combat|battle|fight|raid|doom|quake|halo|final\s+fantasy|nier|devil\s+may\s+cry|two\s+steps\s+from\s+hell|audiomachine|immediate\s+music|celldweller|pendulum|knife\s+party)\b/i,
  ],
  rejectAny: [
    /\b(?:folk|country|singer[-\s]?songwriter|acoustic\s+ballad|bossa|smooth\s+jazz|christmas)\b/i,
    /\b(?:bob\s+dylan|bon\s+iver|amy\s+winehouse|fleetwood|james\s+taylor|ed\s+sheeran|def\s+leppard|juice\s+wrld|blondie|queen\b(?!\s+of\s+the\s+stone))\b/i,
  ],
  energy: { min: 0.55 },
  valence: { max: 0.78 },
};

const QUIET_RAGE_IDENTITY: WorldIdentityProfile = {
  id: "quiet_rage",
  requireAny: [
    /\b(?:indie|alt|alternative|post[-\s]?punk|grunge|shoegaze|industrial|dark\s+wave|metal|hard\s+rock)\b/i,
  ],
  rejectAny: [
    /\b(?:disco|funk\s+party|reggaeton|salsa|edm\s+banger|hyperpop|bubblegum)\b/i,
    /\b(?:bee\s+gees|abba|chaka\s+khan|boogie\s+oogie|call\s+me\b|blondie|fleetwood\s+mac|queen\b(?!\s+of\s+the\s+stone))\b/i,
  ],
  energy: { min: 0.35, max: 0.72 },
  danceability: { max: 0.68 },
  valence: { max: 0.55 },
  maxPopularity: 82,
};

const NEON_IDENTITY: WorldIdentityProfile = {
  id: "neon_tek_drive",
  requireAny: [
    /\b(?:synthwave|retrowave|outrun|darksynth|synth[-\s]?pop|new\s+wave|italo|eurodance|neon|cyber|80s?\s+synth|90s?\s+(?:electronic|synth|dance))\b/i,
    /\b(?:kavinsky|carpenter\s+brut|perturbator|fm[-\s]?84|the\s+midnight|gunship|droid\s+bishop|timecop|home\b|com\s+truise|miami\s+nights)\b/i,
  ],
  rejectAny: [
    /\b(?:country|bluegrass|folk\b|americana|reggae|gospel|christmas|hard\s+techno|tekkno|tekno|jump\s+up|brostep|drill\b|uk\s*drill|phonk)\b/i,
    /\b(?:meat\s+loaf|kenny\s+rogers|garth\s+brooks|johnny\s+cash|fleetwood\s+mac|led\s+zeppelin|queen\b(?!\s+of\s+the\s+stone)|french\s+montana|grima\s+x\s+azza|hannah\s+laing)\b/i,
  ],
  energy: { min: 0.4 },
};

const DISCO_PARTY_IDENTITY: WorldIdentityProfile = {
  id: "disco_party_world",
  requireAny: [
    /\b(?:disco|funk|boogie|motown|nu[-\s]?disco|soul\s+disco|dance\s+funk|philadelphia\s+soul)\b/i,
    /\b(?:bee\s+gees|chic\b|donna\s+summer|abba|boney\s+m|earth[,\s]+wind|kc\s+and\s+the\s+sunshine|gloria\s+gaynor|sylvester|chaka\s+khan|kool\s+&\s+the\s+gang|jackson\s+5|stevie\s+wonder)\b/i,
  ],
  rejectAny: [
    /\b(?:metal|black\s+sabbath|hard\s+rock|grunge|punk\s*rock|death\s+metal|thrash|hardcore|nu[-\s]?metal)\b/i,
    /\b(?:metallica|slayer|iron\s+maiden|pantera|led\s+zeppelin|ac\/?dc|guns\s+n'?\s*roses)\b/i,
  ],
  energy: { min: 0.4 },
};

const RAINY_DRIVE_IDENTITY: WorldIdentityProfile = {
  id: "rainy_drive_world",
  requireAny: [
    /\b(?:indie|dream\s+pop|shoegaze|post[-\s]?rock|ambient|slowcore|chamber\s+pop|art\s+rock|math\s+rock|singer[-\s]?songwriter|sadcore|folk[-\s]?rock)\b/i,
    /\b(?:the\s+national|war\s+on\s+drugs|beach\s+house|radiohead|bon\s+iver|phoebe\s+bridgers|sufjan|cinematic\s+orchestra|sigur|explosions\s+in\s+the\s+sky|m83|washes?|slow\s+pulp|real\s+estate|delta\s+sleep)\b/i,
  ],
  rejectAny: [
    /\b(?:hip[-\s]?hop|rap\b|trap\b|drill\b|metal|hard\s+rock|classic\s+rock|arena\s+rock|country|bluegrass|party\s+anthem|edm\b|trance|hardstyle|big\s+room|festival\s+edm|brostep|dubstep|uk\s*garage)\b/i,
    /\b(?:queen\b(?!\s+of\s+the\s+stone)|blondie|fleetwood\s+mac|led\s+zeppelin|ac\/?dc|dmx\b|highwaymen|johnny\s+cash|storm\s+queen|joel\s+corry|tiesto|tiësto|meat\s+loaf|joyner\s+lucas|drake\b|travis\s+scott|french\s+montana|suzi\s+quatro|jake\s+bugg|the\s+killers)\b/i,
  ],
  energy: { max: 0.72 },
  valence: { max: 0.62 },
};

const CHILL_RAINY_IDENTITY: WorldIdentityProfile = {
  id: "chill_rainy_world",
  requireAny: [
    /\b(?:indie|folk|acoustic|ambient|dream\s+pop|chill|soft\s+rock|singer[-\s]?songwriter|lo-?fi|downtempo|chamber)\b/i,
    /\b(?:iron\s+&\s+wine|iron\s+and\s+wine|bon\s+iver|sufjan|beach\s+house|phoebe|fleet\s+foxes|jose\s+gonzalez|elliott\s+smith|nick\s+drake)\b/i,
  ],
  rejectAny: [
    /\b(?:hip[-\s]?hop|rap\b|trap\b|drill\b|metal|hard\s+rock|hardcore|party|club|rave|gym)\b/i,
    /\b(?:dmx\b|50\s+cent|eminem|metallica|ac\/?dc|queen\b(?!\s+of\s+the\s+stone)|blondie|storm\s+queen)\b/i,
  ],
  energy: { max: 0.55 },
  valence: { max: 0.58 },
};

const FOCUS_STUDY_IDENTITY: WorldIdentityProfile = {
  id: "focus_study_world",
  requireAny: [
    /\b(?:lo-?fi|lofi|ambient|instrumental|classical|modern\s+classical|jazz|downtempo|chillhop|chill\s*hop|neoclassical|piano\s+solo|idm|study\s+beats?)\b/i,
    /\b(?:nujabes|bonobo|brian\s+eno|max\s+richter|nils\s+frahm|boards\s+of\s+canada|tomppabeats|emancipator|ludovico|yiruma|go[-\s]?go\s+penguin)\b/i,
  ],
  rejectAny: [
    /\b(?:pop\s*punk|party|club|rave|gym|workout|screamo|death\s+metal|trap\b|drill\b|hyperpop|dance\s*pop|teen\s*pop|viral\s*pop|singer[-\s]?songwriter)\b/i,
    /\b(?:olivia\s+rodrigo|taylor\s+swift|girl\s+in\s+red|billie\s+eilish|doja\s+cat|drake\b|paramore|fall\s+out\s+boy|sabrina\s+carpenter|ariana\s+grande|dua\s+lipa|charlie\s+puth|queen\b(?!\s+of\s+the\s+stone)|blondie)\b/i,
  ],
  energy: { max: 0.55 },
  danceability: { max: 0.68 },
  // Lyrical pop ballads are near-zero instrumental — when features exist, enforce.
  instrumentalness: { min: 0.25 },
};

const SUNDAY_CHILL_IDENTITY: WorldIdentityProfile = {
  id: "sunday_chill_world",
  requireAny: [
    /\b(?:folk|acoustic|singer[-\s]?songwriter|soft\s+rock|dream\s+pop|chamber|chill|lo-?fi|bedroom\s+pop|alt\s*pop|indie\s+folk|indie\s+pop|slowcore)\b/i,
    /\b(?:bon\s+iver|sufjan|iron\s+&\s+wine|iron\s+and\s+wine|beach\s+house|phoebe|fleet\s+foxes|clairo|mac\s+demarco|norah\s+jones|feist|the\s+sundays|slow\s+pulp|mitski|joji|badbadnotgood)\b/i,
  ],
  rejectAny: [
    /\b(?:metal|hardcore|trap\b|drill\b|hard\s+techno|brostep|death\s+metal|uk\s*garage|grime|phonk|psychedelic|arena\s+rock)\b/i,
    /\b(?:storm\s+queen|dmx\b|metallica|ac\/?dc|slipknot|french\s+montana|tiesto|tiësto|kasabian|tame\s+impala|q\s+lazzarus)\b/i,
  ],
  energy: { max: 0.62 },
};

const FEEL_GOOD_IDENTITY: WorldIdentityProfile = {
  id: "feel_good_world",
  requireAny: [
    /\b(?:pop|dance\s*pop|funk|soul|disco|electropop|nu[-\s]?disco|sunshine\s+pop|motown)\b/i,
    /\b(?:abba|bee\s+gees|chaka\s+khan|bruno\s+mars|dua\s+lipa|mark\s+ronson|calvin\s+harris|pharrell|justin\s+timberlake|kool\s+&\s+the\s+gang|daryl\s+hall|glass\s+animals|vampire\s+weekend)\b/i,
  ],
  rejectAny: [
    /\b(?:death\s+metal|black\s+metal|hardcore|drill\b|phonk|hard\s+techno|doom|psychedelic|slowcore|sadcore|punk|post[-\s]?punk|emo|grunge|metal|shoegaze|meme)\b/i,
    /\b(?:slipknot|cannibal|dmx\b|storm\s+queen|tame\s+impala|kasabian|q\s+lazzarus|glenn\s+frey|iggy\s+pop|jack\s+stauber|panic\s+at|my\s+chemical|fall\s+out\s+boy|paramore)\b/i,
  ],
  energy: { min: 0.42 },
  valence: { min: 0.48 },
  danceability: { min: 0.42 },
};

const SOFT_SAD_IDENTITY: WorldIdentityProfile = {
  id: "soft_sad_world",
  requireAny: [
    /\b(?:indie|folk|acoustic|singer[-\s]?songwriter|sad|ballad|slowcore|dream\s+pop|bedroom)\b/i,
    /\b(?:phoebe|bon\s+iver|sufjan|elliott\s+smith|bright\s+eyes|daughter|keaton\s+henson|iron\s+&\s+wine|adrianne\s+lenker|big\s+thief|mitski)\b/i,
  ],
  rejectAny: [
    /\b(?:party|club|rave|gym|workout|hard\s+techno|trap\b|drill\b|brostep)\b/i,
    /\b(?:storm\s+queen|tiesto|ac\/?dc|metallica|drake\b|french\s+montana)\b/i,
  ],
  energy: { max: 0.58 },
  valence: { max: 0.55 },
};

const SOCIAL_KITCHEN_IDENTITY: WorldIdentityProfile = {
  id: "social_kitchen_world",
  requireAny: [
    /\b(?:soul|funk|disco|motown|groove|nu[-\s]?disco|r&b|rnb|dance\s*pop)\b/i,
    /\b(?:abba|bee\s+gees|chaka\s+khan|amy\s+winehouse|stevie\s+wonder|kool\s+&\s+the\s+gang|daryl\s+hall|khruangbin|jungle\b|disclosure|poolside|dua\s+lipa|mark\s+ronson)\b/i,
  ],
  rejectAny: [
    /\b(?:metal|hardcore|grunge|death\s+metal|drill\b|phonk|emo|screamo|trap\b)\b/i,
    /\b(?:black\s+sabbath|metallica|slipknot|dmx\b|lil\s+peep|gym\s+class\s+heroes|tame\s+impala|kasabian)\b/i,
  ],
  energy: { min: 0.38, max: 0.85 },
  danceability: { min: 0.4 },
};

const COFFEE_SOFT_FOCUS_IDENTITY: WorldIdentityProfile = {
  id: "coffee_soft_focus_world",
  requireAny: [
    /\b(?:folk|acoustic|jazz|lo-?fi|ambient|soft\s+rock|singer[-\s]?songwriter|chamber|classical|indie\s+folk|bossa)\b/i,
    /\b(?:norah\s+jones|bon\s+iver|sufjan|nils\s+frahm|max\s+richter|feist|jose\s+gonzalez|iron\s+&\s+wine|khruangbin|go[-\s]?go\s+penguin|badbadnotgood)\b/i,
  ],
  rejectAny: [
    /\b(?:party|club|rave|gym|trap\b|drill\b|hard\s+techno|screamo|arena\s+rock|psychedelic)\b/i,
    /\b(?:olivia\s+rodrigo|storm\s+queen|tiesto|ac\/?dc|metallica|tame\s+impala|kasabian|q\s+lazzarus|wiz\s+khalifa)\b/i,
  ],
  energy: { max: 0.58 },
  valence: { max: 0.72 },
};

const EVENING_DRIVE_IDENTITY: WorldIdentityProfile = {
  id: "evening_drive_world",
  requireAny: [
    /\b(?:indie|alt|electronic|synth|dream\s+pop|soft\s+rock|post[-\s]?rock)\b/i,
    /\b(?:the\s+national|war\s+on\s+drugs|radiohead|m83|tame\s+impala|beach\s+house|the\s+1975|cinematic)\b/i,
  ],
  rejectAny: [
    /\b(?:hard\s+techno|tekkno|drill\b|death\s+metal|brostep|christmas)\b/i,
    /\b(?:tiesto|storm\s+queen|dmx\b|meat\s+loaf)\b/i,
  ],
  energy: { min: 0.3, max: 0.75 },
};

const UPBEAT_CHORE_IDENTITY: WorldIdentityProfile = {
  id: "upbeat_chore_world",
  requireAny: [
    /\b(?:pop|dance|electropop|funk|disco|hyperpop|synth|house|nu[-\s]?disco)\b/i,
    /\b(?:abba|charli|caroline\s+polachek|dua\s+lipa|calvin\s+harris|bee\s+gees|mark\s+ronson|disclosure|poolside)\b/i,
  ],
  rejectAny: [
    /\b(?:doom|death\s+metal|funeral|hardcore|drill\b|slowcore|psychedelic)\b/i,
    /\b(?:tame\s+impala|kasabian|q\s+lazzarus|the\s+doors|iron\s+maiden)\b/i,
  ],
  energy: { min: 0.45 },
  valence: { min: 0.42 },
  danceability: { min: 0.45 },
};

const GYM_ENERGY_IDENTITY: WorldIdentityProfile = {
  id: "gym_energy_world",
  requireAny: [
    /\b(?:hip\s*hop|rap|trap|edm|house|techno|drum\s*(?:and|&)\s*bass|dnb|pop\s*punk|hyperpop|workout|dance)\b/i,
    /\b(?:kendrick|eminem|travis\s+scott|dua\s+lipa|calvin\s+harris|fred\s+again|marshmello|central\s+cee|nicki\s+minaj|blink|paramore|fall\s+out\s+boy|megan\s+thee)\b/i,
  ],
  rejectAny: [
    /\b(?:classic\s+rock|arena\s+rock|prog(?:ressive)?\s+rock|psychedelic|blues\s+rock|hard\s+rock|heavy\s+metal|thrash|doom|yacht\s*rock|soft\s*rock)\b/i,
    /\b(?:the\s+doors|iron\s+maiden|led\s+zeppelin|sonic\s+youth|deep\s+purple|meat\s+loaf|storm\s+queen|blondie|fleetwood\s+mac|craig\s+david|bee\s+gees|abba|tiesto|scooter|bon\s+iver|clairo|noah\s+kahan|dayglow|gregory\s+alan\s+isakov|badbadnotgood)\b|(?<!\bstorm\s)\bqueen\b(?!\s+of\s+the\s+stone)/i,
    /\b(?:acoustic|folk|singer[-\s]?songwriter|indie\s+folk)\b/i,
  ],
  energy: { min: 0.65 },
  danceability: { min: 0.42 },
};

const INDIE_DREAM_IDENTITY: WorldIdentityProfile = {
  id: "indie_dream_world",
  requireAny: [
    /\b(?:indie|dream\s+pop|shoegaze|bedroom\s+pop|chamber\s+pop|alt|slowcore)\b/i,
    /\b(?:phoebe|beach\s+house|mazzy|cocteau|slowdive|alvvays|japanese\s+breakfast|big\s+thief|sufjan|bon\s+iver)\b/i,
  ],
  rejectAny: [
    /\b(?:classic\s+rock|arena\s+rock|metal|trap\b|drill\b|uk\s*garage)\b/i,
    /\b(?:queen\b(?!\s+of\s+the\s+stone)|led\s+zeppelin|ac\/?dc|blondie|fleetwood|men\s+at\s+work|journey)\b/i,
  ],
  energy: { max: 0.7 },
};

const NOSTALGIA_WARM_IDENTITY: WorldIdentityProfile = {
  id: "nostalgia_warm_world",
  requireAny: [
    /\b(?:indie|pop|alt|2000s|noughties|throwback|nostalg|emo|pop\s*punk|synth|britpop)\b/i,
    /\b(?:the\s+killers|franz\s+ferdinand|arctic\s+monkeys|kings\s+of\s+leon|paramore|fall\s+out\s+boy|mgmt|vampire\s+weekend|the\s+strokes|kasabian|oasis)\b/i,
  ],
  rejectAny: [
    /\b(?:hard\s+techno|tekkno|drill\b|phonk|death\s+metal)\b/i,
    /\b(?:storm\s+queen|tiesto|dmx\b|tame\s+impala|q\s+lazzarus)\b/i,
  ],
};

const PARTY_PREP_IDENTITY: WorldIdentityProfile = {
  id: "party_prep_world",
  requireAny: [
    /\b(?:disco|funk|soul|dance|pop|nu[-\s]?disco|house|electropop|motown)\b/i,
    /\b(?:abba|bee\s+gees|dua\s+lipa|calvin\s+harris|mark\s+ronson|disclosure|poolside|chaka\s+khan|dua\s+lipa|fred\s+again)\b/i,
  ],
  rejectAny: [
    /\b(?:metal|hardcore|drill\b|phonk|slowcore|acoustic\s+ballad|singer[-\s]?songwriter)\b/i,
    /\b(?:tame\s+impala|kasabian|q\s+lazzarus|iron\s+maiden|metallica|bon\s+iver|clairo|noah\s+kahan|dayglow|gregory\s+alan\s+isakov)\b/i,
    /\b(?:acoustic|folk|singer[-\s]?songwriter|indie\s+folk)\b/i,
  ],
  energy: { min: 0.48, max: 0.88 },
  danceability: { min: 0.48 },
  valence: { min: 0.45 },
};

const RAINY_READING_IDENTITY: WorldIdentityProfile = {
  id: "rainy_reading_world",
  requireAny: [
    /\b(?:folk|acoustic|singer[-\s]?songwriter|chamber|indie\s+folk|slowcore|dream\s+pop|neoclassical)\b/i,
    /\b(?:bon\s+iver|sufjan|iron\s+&\s+wine|phoebe|fleet\s+foxes|nick\s+drake|elliott\s+smith|big\s+thief|adrianne\s+lenker)\b/i,
  ],
  rejectAny: [
    /\b(?:metal|trap\b|drill\b|hard\s+techno|party|club|rave|gym)\b/i,
    /\b(?:dmx\b|storm\s+queen|tame\s+impala|kasabian|ac\/?dc)\b/i,
  ],
  energy: { max: 0.55 },
  valence: { max: 0.62 },
};

const BEACH_SUNSET_IDENTITY: WorldIdentityProfile = {
  id: "beach_sunset_world",
  requireAny: [
    /\b(?:indie\s+pop|surf|tropical|soft\s+rock|dream\s+pop|balearic|chillwave|trop\s+house)\b/i,
    /\b(?:beach\s+house|real\s+estate|mac\s+demarco|clairo|khruangbin|poolside|tame\s+impala|mgmt|washed\s+out)\b/i,
  ],
  rejectAny: [
    /\b(?:metal|hardcore|drill\b|phonk|death\s+metal|hard\s+techno)\b/i,
    /\b(?:kasabian|q\s+lazzarus|iron\s+maiden|dmx\b)\b/i,
  ],
  energy: { min: 0.35, max: 0.72 },
  valence: { min: 0.4 },
};

const SUMMER_WARM_IDENTITY: WorldIdentityProfile = {
  id: "summer_warm_world",
  requireAny: [
    /\b(?:pop|indie\s+pop|surf|tropical|funk|disco|sunshine\s+pop|dance\s*pop)\b/i,
    /\b(?:vampire\s+weekend|glass\s+animals|dua\s+lipa|calvin\s+harris|poolside|abba|bee\s+gees|harry\s+styles|bruno\s+mars)\b/i,
  ],
  rejectAny: [
    /\b(?:metal|drill\b|phonk|doom|slowcore|sadcore)\b/i,
    /\b(?:tame\s+impala|kasabian|q\s+lazzarus|glenn\s+frey)\b/i,
  ],
  energy: { min: 0.4 },
  valence: { min: 0.45 },
};

const ACOUSTIC_SUNDAY_IDENTITY: WorldIdentityProfile = {
  id: "acoustic_sunday_world",
  requireAny: [
    /\b(?:acoustic|folk|singer[-\s]?songwriter|americana|country\s+folk|indie\s+folk)\b/i,
    /\b(?:iron\s+&\s+wine|iron\s+and\s+wine|bon\s+iver|sufjan|jose\s+gonzalez|feist|norah\s+jones|fleet\s+foxes|phoebe)\b/i,
  ],
  rejectAny: [
    /\b(?:metal|trap\b|drill\b|hard\s+techno|edm|house|hyperpop)\b/i,
    /\b(?:tame\s+impala|kasabian|dmx\b|storm\s+queen)\b/i,
  ],
  energy: { max: 0.58 },
};

const LATE_NIGHT_CALM_IDENTITY: WorldIdentityProfile = {
  id: "late_night_calm_world",
  requireAny: [
    /\b(?:ambient|downtempo|soft\s+electronic|dream\s+pop|chill|lo-?fi|indie\s+folk|slowcore)\b/i,
    /\b(?:bonobo|khruangbin|beach\s+house|joji|clairo|iron\s+&\s+wine|the\s+xx|massive\s+attack|portishead)\b/i,
  ],
  rejectAny: [
    /\b(?:metal|trap\b|drill\b|hard\s+techno|party\s+anthem|gym|workout)\b/i,
    /\b(?:kasabian|q\s+lazzarus|ac\/?dc|metallica)\b/i,
  ],
  energy: { max: 0.52 },
  valence: { max: 0.65 },
};

const RNB_NIGHT_IDENTITY: WorldIdentityProfile = {
  id: "rnb_night_world",
  requireAny: [
    /\b(?:r&b|rnb|soul|neo\s+soul|quiet\s+storm|slow\s+jam)\b/i,
    /\b(?:sade|erykah\s+badu|d'angelo|frank\s+ocean|sza|usher|aaliyah|maxwell|dangelo)\b/i,
  ],
  rejectAny: [
    /\b(?:metal|hardcore|drill\b|phonk|country|bluegrass)\b/i,
    /\b(?:tame\s+impala|kasabian|metallica)\b/i,
  ],
  energy: { max: 0.68 },
};

const METAL_POP_PUNK_REJECT =
  /\b(?:pop\s*punk|skate\s*punk|emo\b|easycore|green\s+day|blink[-\s]?182|sum\s+41|fall\s+out\s+boy|my\s+chemical|new\s+found\s+glory|good\s+charlotte|simple\s+plan|yellowcard|jimmy\s+eat\s+world|all[-\s]?american\s+rejects|paramore)\b/i;

const BRITPOP_IDENTITY: WorldIdentityProfile = {
  id: "britpop_world",
  requireAny: [
    /\b(?:britpop|indie\s+rock|alternative\s+rock|madchester)\b/i,
    /\b(?:oasis|blur|pulp|suede|arctic\s+monkeys|kasabian|the\s+stone\s+roses|ocean\s+colour\s+scene)\b/i,
  ],
  rejectAny: [
    /\b(?:metal|drill\b|phonk|country|bluegrass)\b/i,
    /\b(?:tame\s+impala|q\s+lazzarus|fleetwood\s+mac|blondie)\b/i,
    REMIX_EDIT_BAIT_TITLE,
  ],
  energy: { min: 0.38 },
  valence: { min: 0.38 },
};

const FILM_ENDING_IDENTITY: WorldIdentityProfile = {
  id: "film_ending_world",
  requireAny: [
    /\b(?:cinematic|orchestral|post[-\s]?rock|ambient\s+pop|chamber|score|soundtrack|art\s+rock|slowcore|shoegaze|neoclassical)\b/i,
    /\b(?:sigur\s+ros|explosions\s+in\s+the\s+sky|godspeed|radiohead|moby|max\s+richter|olafur|james\s+blake|bon\s+iver|sufjan)\b/i,
  ],
  rejectAny: [
    /\b(?:party|club|gym|trap\b|drill\b|brostep|hard\s+techno|pop\s*punk)\b/i,
    /\b(?:kasabian|q\s+lazzarus|tame\s+impala|ac\/?dc|def\s+leppard|glenn\s+frey)\b/i,
  ],
  energy: { max: 0.72 },
  valence: { max: 0.65 },
};

const DAD_SECRET_IDENTITY: WorldIdentityProfile = {
  id: "dad_secret_world",
  requireAny: [
    /\b(?:classic\s+rock|soft\s+rock|yacht\s+rock|arena|heartland|dad\s+rock|album\s+rock|blue[-\s]?eyed\s+soul)\b/i,
    /\b(?:billy\s+joel|fleetwood\s+mac|eagles|tom\s+petty|bruce\s+springsteen|hall\s+&\s+oates|phil\s+collins|steely\s+dan|boston|journey|foreigner|reo\s+speedwagon)\b/i,
  ],
  rejectAny: [
    /\b(?:drill\b|phonk|hyperpop|trap\b|metalcore|screamo|emo)\b/i,
    /\b(?:kasabian|q\s+lazzarus|tame\s+impala|jack\s+stauber)\b/i,
  ],
};

const YACHT_ROCK_IDENTITY: WorldIdentityProfile = {
  id: "yacht_rock_world",
  requireAny: [
    /\b(?:yacht\s+rock|soft\s+rock|west\s+coast|mellow\s+rock|album\s+rock|blue[-\s]?eyed\s+soul)\b/i,
    /\b(?:hall\s+&\s+oates|steely\s+dan|michael\s+mcdonald|toto\b|christopher\s+cross|ambrosia|player\b|orleans|rupert\s+holmes|kenny\s+loggins)\b/i,
  ],
  rejectAny: [
    /\b(?:trap\b|drill\b|metal|hardcore|hyperpop|phonk|emo|screamo)\b/i,
    /\b(?:bon\s+iver|clairo|noah\s+kahan|dayglow|gregory\s+alan\s+isakov|badbadnotgood|sufjan\s+stevens|phoebe\s+bridgers)\b/i,
    /\b(?:arctic\s+monkeys|kasabian|the\s+killers|franz\s+ferdinand|vampire\s+weekend|mgmt|the\s+strokes|oasis|blur)\b/i,
  ],
  energy: { min: 0.35, max: 0.78 },
  valence: { min: 0.35 },
};

const NIGHT_DRIVE_IDENTITY: WorldIdentityProfile = {
  id: "night_drive_world",
  requireAny: [
    /\b(?:indie|alt|electronic|synth|dream\s+pop|soft\s+rock|post[-\s]?rock|chillwave)\b/i,
    /\b(?:the\s+national|war\s+on\s+drugs|m83|chromatics|kavinsky|the\s+midnight|tame\s+impala|beach\s+house|radiohead)\b/i,
  ],
  rejectAny: [
    /\b(?:metal|hardcore|trap\b|drill\b|country|bluegrass|arena\s+rock|classic\s+rock)\b/i,
    /\b(?:queen\b(?!\s+of\s+the\s+stone)|led\s+zeppelin|ac\/?dc|guns\s+n'?\s*roses|bon\s+jovi|def\s+leppard|dmx\b|travis\s+scott)\b/i,
    /\b(?:bon\s+iver|clairo|noah\s+kahan|dayglow|gregory\s+alan\s+isakov|badbadnotgood|sufjan\s+stevens)\b/i,
  ],
  energy: { min: 0.28, max: 0.72 },
  valence: { max: 0.62 },
};

const OLDER_SIBLING_IDENTITY: WorldIdentityProfile = {
  id: "older_sibling_world",
  requireAny: [
    /\b(?:indie\s+rock|britpop|alt(?:ernative)?\s+rock|post[-\s]?punk\s+revival|garage\s+rock|new\s+wave)\b/i,
    /\b(?:arctic\s+monkeys|the\s+strokes|franz\s+ferdinand|interpol|yeah\s+yeah\s+yeahs|the\s+killers|vampire\s+weekend|blur|pulp|suede|kasabian)\b/i,
  ],
  rejectAny: [
    /\b(?:country|classical|christmas|drill\b|phonk)\b/i,
    /\b(?:q\s+lazzarus|tame\s+impala|glenn\s+frey)\b/i,
  ],
};

const LATIN_SUMMER_ROOFTOP_IDENTITY: WorldIdentityProfile = {
  id: "latin_summer_rooftop_world",
  requireAny: [
    /\b(?:latin|reggaeton|salsa|bachata|cumbia|urbano|latin\s+pop|dembow|merengue)\b/i,
    /\b(?:bad\s+bunny|j\s+balvin|shakira|maluma|ozuna|daddy\s+yankee|rosalia|anitta)\b/i,
  ],
  rejectAny: [
    /\b(?:metal|country|bluegrass|christmas|goth|grunge)\b/i,
    /\b(?:kasabian|tame\s+impala|q\s+lazzarus|blondie|fleetwood\s+mac|storm\s+queen)\b/i,
  ],
  energy: { min: 0.45 },
  danceability: { min: 0.48 },
};

const COMMUTE_WORLD_IDENTITY: WorldIdentityProfile = {
  id: "commute_world",
  requireAny: [
    /\b(?:pop|indie\s+pop|electropop|alt\s+pop|synth\s*pop|dance\s*pop)\b/i,
    /\b(?:dua\s+lipa|taylor\s+swift|harry\s+styles|the\s+1975|chvrches|carly\s+rae|mark\s+ronson|calvin\s+harris)\b/i,
  ],
  rejectAny: [
    /\b(?:doom|funeral|death\s+metal|slowcore|sadcore)\b/i,
    /\b(?:kasabian|q\s+lazzarus|dmx\b|storm\s+queen)\b/i,
  ],
  energy: { min: 0.38, max: 0.78 },
};

const FIRST_DATE_IDENTITY: WorldIdentityProfile = {
  id: "first_date_world",
  requireAny: [
    /\b(?:indie\s+pop|bedroom\s+pop|soul|r&b|rnb|soft\s+rock|dream\s+pop)\b/i,
    /\b(?:clairo|mac\s+demarco|khruangbin|norah\s+jones|lianne\s+la\s+havas|daniel\s+caesar|phoebe)\b/i,
  ],
  rejectAny: [
    /\b(?:metal|hardcore|drill\b|screamo|gym)\b/i,
    /\b(?:kasabian|q\s+lazzarus|iggy\s+pop)\b/i,
  ],
  energy: { max: 0.68 },
  valence: { min: 0.35 },
};

const MADCHESTER_IDENTITY: WorldIdentityProfile = {
  id: "madchester_world",
  requireAny: [
    /\b(?:madchester|baggy|manchester|northern|britpop|indie\s+dance)\b/i,
    /\b(?:stone\s+roses|happy\s+mondays|inspiral\s+carpets|charlatans|james\b|808\s+state|new\s+order|bez\b)\b/i,
  ],
  rejectAny: [
    /\b(?:country|bluegrass|americana|singer[-\s]?songwriter|acoustic\s+folk)\b/i,
    /\b(?:bon\s+iver|phoebe\s+bridgers|sufjan\s+stevens|fleet\s+foxes|iron\s+(?:&|and)\s+wine|beach\s+house|clairo|mitski)\b/i,
    /\b(?:tame\s+impala|arctic\s+monkeys|the\s+strokes|vampire\s+weekend|real\s+estate)\b/i,
  ],
  energy: { min: 0.42 },
  danceability: { min: 0.38 },
};

const UK_GARAGE_IDENTITY: WorldIdentityProfile = {
  id: "uk_garage_world",
  requireAny: [
    /\b(?:uk\s*garage|ukg|2-?step|speed\s+garage|bassline|grime|garage\s+house)\b/i,
    /\b(?:craig\s+david|artful\s+dodger|so\s+solid|ms\s+dynamite|shy\s+fx|dj\s+luck|conducta|kurupt\s+fm)\b/i,
  ],
  rejectAny: [
    /\b(?:country|classic\s+rock|arena\s+rock|yacht\s+rock|americana|folk\b|acoustic\s+ballad)\b/i,
    /\b(?:bon\s+iver|fleetwood\s+mac|led\s+zeppelin|journey|def\s+leppard)\b/i,
  ],
  energy: { min: 0.45 },
  danceability: { min: 0.48 },
};

const INDIE_BEDROOM_IDENTITY: WorldIdentityProfile = {
  id: "indie_bedroom_world",
  requireAny: [
    /\b(?:bedroom\s+pop|indie\s+pop|lo-?fi\s+pop|chamber\s+pop|dream\s+pop)\b/i,
    /\b(?:clairo|beabadoobee|mxmtoon|girl\s+in\s+red|mac\s+demarco|joji|rex\s+orange\s+county)\b/i,
  ],
  rejectAny: [
    /\b(?:metal|hardcore|grunge|arena\s+rock|classic\s+rock|phonk|drill\b)\b/i,
    /\b(?:ac\/?dc|guns\s+n'?\s*roses|metallica|nirvana|pearl\s+jam)\b/i,
  ],
  energy: { max: 0.72 },
};

const PUB_SINGALONG_IDENTITY: WorldIdentityProfile = {
  id: "pub_singalong_world",
  requireAny: [
    /\b(?:britpop|indie\s+rock|pub\s+rock|anthem|singalong|oasis|blur|pulp|kasabian|arctic\s+monkeys)\b/i,
    /\b(?:oasis|blur|pulp|kasabian|the\s+killers|franz\s+ferdinand|ocean\s+colour\s+scene)\b/i,
  ],
  rejectAny: [
    /\b(?:ambient|lo-?fi|acoustic\s+ballad|singer[-\s]?songwriter|slowcore|dream\s+pop)\b/i,
    /\b(?:bon\s+iver|phoebe\s+bridgers|iron\s+(?:&|and)\s+wine|beach\s+house|nick\s+drake)\b/i,
  ],
  energy: { min: 0.45 },
  valence: { min: 0.38 },
};

const EIGHTIES_NIGHT_DRIVE_IDENTITY: WorldIdentityProfile = {
  id: "80s_night_drive_world",
  requireAny: [
    /\b(?:synthpop|synth[-\s]?pop|post[-\s]?punk|new\s+wave|80s|eighties|electropop)\b/i,
    /\b(?:new\s+order|depeche\s+mode|tears\s+for\s+fears|the\s+cure|joy\s+division|pet\s+shop\s+boys|a-?ha|human\s+league|gary\s+numan|ultravox)\b/i,
  ],
  rejectAny: [
    /\b(?:acoustic\s+indie|singer[-\s]?songwriter|indie\s+folk|folk\b|americana|phonk|lo-?fi\s+beats?)\b/i,
    /\b(?:bon\s+iver|phoebe\s+bridgers|sufjan\s+stevens|beach\s+house|clairo|fleet\s+foxes|gregory\s+alan\s+isakov|nimino|calvin\s+harris)\b/i,
    REMIX_EDIT_BAIT_TITLE,
  ],
  energy: { min: 0.35, max: 0.82 },
  valence: { max: 0.72 },
};

const RAINY_MOTORWAY_IDENTITY: WorldIdentityProfile = {
  id: "rainy_motorway_world",
  requireAny: [
    /\b(?:synthpop|synth[-\s]?pop|post[-\s]?punk|new\s+wave|electronic|synthwave|cinematic|darkwave|coldwave)\b/i,
    /\b(?:new\s+order|depeche\s+mode|the\s+cure|joy\s+division|chromatics|kavinsky|m83|massive\s+attack|portishead|tears\s+for\s+fears)\b/i,
  ],
  rejectAny: [
    /\b(?:acoustic\s+indie|singer[-\s]?songwriter|indie\s+folk|slowcore|sadcore|bedroom\s+pop|folk\b)\b/i,
    /\b(?:bon\s+iver|phoebe\s+bridgers|sufjan\s+stevens|beach\s+house|iron\s+(?:&|and)\s+wine|fleet\s+foxes|mitski|clairo|noah\s+kahan)\b/i,
    /\b(?:phonky|phonk|trap\b|drill\b|country|bluegrass|comedy|party\s+anthem|jump\s+up|brostep)\b/i,
    /\b(?:destructo\s+disk|mungo'?s\s+hi\s+fi|oliver\s+heldens|steve\s+lacy|funk\s+tribu|florence|mgmt)\b/i,
    REMIX_EDIT_BAIT_TITLE,
  ],
  energy: { min: 0.32, max: 0.78 },
  valence: { max: 0.62 },
};

const COUNTRY_WORLD_IDENTITY: WorldIdentityProfile = {
  id: "country_world",
  requireAny: [
    /\b(?:country|americana|red\s+dirt|outlaw\s+country|country\s+rock)\b/i,
    /\b(?:johnny\s+cash|dolly\s+parton|willie\s+nelson|luke\s+combs|chris\s+stapleton|zach\s+bryan|alan\s+jackson|george\s+strait|merle\s+haggard)\b/i,
  ],
  rejectAny: [
    /\b(?:indie\s+folk|indie\s+rock|bedroom\s+pop|r&b|hip[\s-]?hop|rap\b|trap\b|electronic\s+pop)\b/i,
    /\b(?:arctic\s+monkeys|jungle\s+giants|frank\s+ocean|bon\s+iver|michael\s+kiwanuka)\b/i,
  ],
  energy: { min: 0.35, max: 0.88 },
};

const ROAD_TRIP_SINGALONG_IDENTITY: WorldIdentityProfile = {
  id: "road_trip_singalong_world",
  requireAny: [
    /\b(?:anthem|singalong|arena|classic\s+rock|pop\s+rock|indie\s+rock|britpop|power\s+pop)\b/i,
    /\b(?:oasis|the\s+killers|journey|bon\s+jovi|foo\s+fighters|arctic\s+monkeys|vampire\s+weekend|abba|queen\b(?!\s+of\s+the\s+stone))\b/i,
  ],
  rejectAny: [
    /\b(?:acoustic\s+ballad|singer[-\s]?songwriter|slowcore|ambient|lo-?fi|chamber\s+pop|folk\b)\b/i,
    /\b(?:bon\s+iver|phoebe\s+bridgers|iron\s+(?:&|and)\s+wine|nick\s+drake|elliott\s+smith|beach\s+house)\b/i,
  ],
  energy: { min: 0.48 },
  valence: { min: 0.4 },
};

const PETROL_STATION_2AM_IDENTITY: WorldIdentityProfile = {
  id: "petrol_station_2am_world",
  requireAny: [
    /\b(?:synthpop|synth[-\s]?pop|electronic|new\s+wave|darkwave|afterhours|nocturnal|ambient\s+pop)\b/i,
    /\b(?:depeche\s+mode|new\s+order|the\s+cure|chromatics|kavinsky|massive\s+attack|portishead|pet\s+shop\s+boys)\b/i,
  ],
  rejectAny: [
    /\b(?:country|folk\b|acoustic\s+indie|singer[-\s]?songwriter|phonk|drill\b)\b/i,
    /\b(?:bon\s+iver|beach\s+house|fleet\s+foxes|clairo)\b/i,
  ],
  energy: { min: 0.28, max: 0.72 },
};

const DISCO_1970S_IDENTITY: WorldIdentityProfile = {
  id: "disco_1970s_world",
  requireAny: [
    /\b(?:disco|funk|boogie|motown|philadelphia\s+soul|nu[-\s]?disco)\b/i,
    /\b(?:bee\s+gees|chic\b|donna\s+summer|abba|boney\s+m|earth[,\s]+wind|kc\s+and\s+the\s+sunshine|gloria\s+gaynor|chaka\s+khan)\b/i,
  ],
  rejectAny: [
    /\b(?:metal|grunge|punk\s*rock|hardcore|phonk|drill\b|acoustic\s+folk)\b/i,
    /\b(?:nirvana|metallica|bon\s+iver|beach\s+house)\b/i,
  ],
  energy: { min: 0.42 },
  danceability: { min: 0.45 },
};

const ROOFTOP_PARTY_IDENTITY: WorldIdentityProfile = {
  id: "rooftop_party_world",
  requireAny: [
    /\b(?:disco|funk|house|nu[-\s]?disco|dance\s*pop|electropop|soul|latin)\b/i,
    /\b(?:dua\s+lipa|calvin\s+harris|disclosure|poolside|mark\s+ronson|fred\s+again|abba|bee\s+gees)\b/i,
  ],
  rejectAny: [
    /\b(?:metal|grunge|slowcore|acoustic\s+ballad|singer[-\s]?songwriter|folk\b)\b/i,
    /\b(?:bon\s+iver|phoebe\s+bridgers|iron\s+(?:&|and)\s+wine|nick\s+drake)\b/i,
  ],
  energy: { min: 0.5 },
  danceability: { min: 0.48 },
};

const HEAVY_GYM_IDENTITY: WorldIdentityProfile = {
  id: "heavy_gym_world",
  requireAny: [
    /\b(?:metal|hard\s*rock|nu[-\s]?metal|punk|hardcore|grunge|metalcore|thrash)\b/i,
    /\b(?:metallica|slipknot|ac\/?dc|rage\s+against|disturbed|godsmack|foo\s+fighters|linkin\s+park|pantera)\b/i,
  ],
  rejectAny: [
    /\b(?:acoustic|folk|singer[-\s]?songwriter|lo-?fi|ambient|bossa|jazz\s+ballad|yacht\s*rock)\b/i,
    /\b(?:bon\s+iver|clairo|beach\s+house|norah\s+jones|iron\s+(?:&|and)\s+wine)\b/i,
  ],
  energy: { min: 0.72 },
};

const RUNNING_ENERGY_IDENTITY: WorldIdentityProfile = {
  id: "running_energy_world",
  requireAny: [
    /\b(?:edm|house|techno|drum\s*(?:and|&)\s*bass|dnb|pop\s*punk|hyperpop|dance\s*pop|workout)\b/i,
    /\b(?:fred\s+again|calvin\s+harris|disclosure|paramore|blink[-\s]?182|dua\s+lipa|central\s+cee)\b/i,
  ],
  rejectAny: [
    /\b(?:slowcore|acoustic\s+ballad|singer[-\s]?songwriter|ambient|lo-?fi|folk\b|jazz\s+ballad)\b/i,
    /\b(?:bon\s+iver|phoebe\s+bridgers|iron\s+(?:&|and)\s+wine|nick\s+drake|beach\s+house)\b/i,
  ],
  energy: { min: 0.68 },
  danceability: { min: 0.45 },
};

const ARENA_ROCK_IDENTITY: WorldIdentityProfile = {
  id: "arena_rock_world",
  requireAny: [
    /\b(?:arena\s*rock|stadium\s*rock|classic\s*rock|hard\s*rock|anthem)\b/i,
    /\b(?:queen\b(?!\s+of\s+the\s+stone)|journey|bon\s+jovi|def\s+leppard|ac\/?dc|guns\s+n'?\s*roses|foo\s+fighters|u2\b|bryan\s+adams)\b/i,
  ],
  rejectAny: [
    /\b(?:phonk|drill\b|trap\b|lo-?fi|bedroom\s+pop|indie\s+folk)\b/i,
    /\b(?:bon\s+iver|clairo|beach\s+house|phoebe\s+bridgers|mitski)\b/i,
  ],
  energy: { min: 0.55 },
};

const DAD_ROCK_IDENTITY: WorldIdentityProfile = {
  id: "dad_rock_world",
  requireAny: [
    /\b(?:dad\s+rock|classic\s+rock|soft\s+rock|yacht\s+rock|arena|heartland|album\s+rock)\b/i,
    /\b(?:billy\s+joel|fleetwood\s+mac|eagles|tom\s+petty|bruce\s+springsteen|hall\s+&\s+oates|journey|foreigner|reo\s+speedwagon|ac\/?dc)\b/i,
  ],
  rejectAny: [
    /\b(?:drill\b|phonk|hyperpop|trap\b|emo|screamo|bedroom\s+pop)\b/i,
    /\b(?:bon\s+iver|clairo|beach\s+house|phoebe\s+bridgers|mitski|tame\s+impala)\b/i,
  ],
};

const COMEDOWN_IDENTITY: WorldIdentityProfile = {
  id: "rave_comedown",
  requireAny: [
    /\b(?:ambient|downtempo|chillout|chill\s*out|soft\s+electronic|deep\s+house|melodic\s+(?:techno|house)|afterhours|after\s*hours|idm|leftfield|trip\s+hop|balearic|organic\s+house|lo-?fi\s+house|dub\s+techno|minimal(?:\s+techno)?|float(?:ing)?|come\s*down|post[-\s]?club)\b/i,
    /\b(?:boards\s+of\s+canada|bonobo|four\s+tet|floating\s+points|nils\s+frahm|khruangbin|tame\s+impala|motorcycle|emancipator|ulrich\s+schnauss|biosphere|royksopp|röyksopp|air\b|zero\s+7|thievery|nightmares\s+on\s+wax)\b/i,
  ],
  rejectAny: [
    /\b(?:hard\s+techno|peak\s+time|uk\s+garage\s+banger|jump\s+up|brostep|festival\s+drop|drum\s*(?:and|&)\s*bass|dnb|hardstyle)\b/i,
    /\b(?:drake\b|kurupt\s+fm|stormzy|central\s+cee|queen\b(?!\s+of\s+the\s+stone)|blondie|fleetwood|ac\/?dc|metallica)\b/i,
  ],
  energy: { max: 0.58 },
  danceability: { max: 0.68 },
};

const IDENTITY_BY_LOCK_ID: Record<string, WorldIdentityProfile> = {
  goth_world: GOTH_IDENTITY,
  lofi_world: LOFI_IDENTITY,
  ambient_world: AMBIENT_IDENTITY,
  grunge_world: GRUNGE_IDENTITY,
  pop_punk_world: POP_PUNK_IDENTITY,
  gym_rock_world: GYM_ROCK_IDENTITY,
  angry_rock_world: ANGRY_ROCK_IDENTITY,
  sleepy_gym_world: SLEEPY_GYM_IDENTITY,
  classic_rock_world: CLASSIC_ROCK_IDENTITY,
  boss_fight: BOSS_FIGHT_IDENTITY,
  quiet_rage: QUIET_RAGE_IDENTITY,
  neon_tek_drive: NEON_IDENTITY,
  rave_comedown: COMEDOWN_IDENTITY,
  disco_party_world: DISCO_PARTY_IDENTITY,
  rainy_drive_world: RAINY_DRIVE_IDENTITY,
  chill_rainy_world: CHILL_RAINY_IDENTITY,
  focus_study_world: FOCUS_STUDY_IDENTITY,
  sunday_chill_world: SUNDAY_CHILL_IDENTITY,
  feel_good_world: FEEL_GOOD_IDENTITY,
  soft_sad_world: SOFT_SAD_IDENTITY,
  social_kitchen_world: SOCIAL_KITCHEN_IDENTITY,
  coffee_soft_focus_world: COFFEE_SOFT_FOCUS_IDENTITY,
  evening_drive_world: EVENING_DRIVE_IDENTITY,
  upbeat_chore_world: UPBEAT_CHORE_IDENTITY,
  gym_energy_world: GYM_ENERGY_IDENTITY,
  indie_dream_world: INDIE_DREAM_IDENTITY,
  nostalgia_warm_world: NOSTALGIA_WARM_IDENTITY,
  party_prep_world: PARTY_PREP_IDENTITY,
  rainy_reading_world: RAINY_READING_IDENTITY,
  beach_sunset_world: BEACH_SUNSET_IDENTITY,
  summer_warm_world: SUMMER_WARM_IDENTITY,
  acoustic_sunday_world: ACOUSTIC_SUNDAY_IDENTITY,
  late_night_calm_world: LATE_NIGHT_CALM_IDENTITY,
  rnb_night_world: RNB_NIGHT_IDENTITY,
  britpop_world: BRITPOP_IDENTITY,
  madchester_world: MADCHESTER_IDENTITY,
  uk_garage_world: UK_GARAGE_IDENTITY,
  indie_bedroom_world: INDIE_BEDROOM_IDENTITY,
  pub_singalong_world: PUB_SINGALONG_IDENTITY,
  "80s_night_drive_world": EIGHTIES_NIGHT_DRIVE_IDENTITY,
  rainy_motorway_world: RAINY_MOTORWAY_IDENTITY,
  country_world: COUNTRY_WORLD_IDENTITY,
  road_trip_singalong_world: ROAD_TRIP_SINGALONG_IDENTITY,
  petrol_station_2am_world: PETROL_STATION_2AM_IDENTITY,
  disco_1970s_world: DISCO_1970S_IDENTITY,
  rooftop_party_world: ROOFTOP_PARTY_IDENTITY,
  heavy_gym_world: HEAVY_GYM_IDENTITY,
  running_energy_world: RUNNING_ENERGY_IDENTITY,
  arena_rock_world: ARENA_ROCK_IDENTITY,
  dad_rock_world: DAD_ROCK_IDENTITY,
  film_ending_world: FILM_ENDING_IDENTITY,
  dad_secret_world: DAD_SECRET_IDENTITY,
  yacht_rock_world: YACHT_ROCK_IDENTITY,
  night_drive_world: NIGHT_DRIVE_IDENTITY,
  older_sibling_world: OLDER_SIBLING_IDENTITY,
  latin_summer_rooftop_world: LATIN_SUMMER_ROOFTOP_IDENTITY,
  commute_world: COMMUTE_WORLD_IDENTITY,
  first_date_world: FIRST_DATE_IDENTITY,
  melancholy_drive: {
    id: "melancholy_drive",
    requireAny: [
      /\b(?:indie|dream\s+pop|shoegaze|synth|electronic|alt|sad|melanchol|ballad)\b/i,
    ],
    rejectAny: [
      /\b(?:phonk|hardstyle|brostep|party\s+anthem|gym\s+banger|country\s+party|blondie|fleetwood\s+mac|ac\/?dc|queen\b(?!\s+of\s+the\s+stone)|dmx\b)\b/i,
    ],
    energy: { max: 0.62 },
    valence: { max: 0.55 },
  },
};

/** Title/artist tokens that must never alone admit a track into a locked world. */
const LEXICAL_BAIT_REJECT =
  /\b(?:ruin|ruins|slow|goth(?:am)?|bedroom|home|house|dark|sad|rage|quiet|soft|hard|love|heart|dream|fire|blood|shadow|ghost|angel|devil|party|dance|sleep|alone|lost|blue|black|war|fight|battle|boss|game|play|run|escape|free|rain|rainy|highway|motorway|road|drive|driving|night|storm|cloud|clouds|city|neon)\b/i;

/** Scene words in titles that look like prompt-match bait without genre evidence. */
const SCENE_TITLE_BAIT =
  /\b(?:rain(?:y|ing)?|highway|motorway|autobahn|road\s+trip|night\s+drive|driving|sunglasses\s+at\s+night|foot\s+on\s+the\s+gas|where\s+the\s+hood)\b/i;

function genresBlob(track: {
  trackName?: string | null;
  artistName?: string | null;
  albumName?: string | null;
  genrePrimary?: string | null;
  genreFamily?: string | null;
  genres?: string[] | null;
  spotifyArtistGenres?: unknown;
  albumGenres?: unknown;
}): string {
  const parts: string[] = [
    track.trackName ?? "",
    track.artistName ?? "",
    track.albumName ?? "",
    track.genrePrimary ?? "",
    track.genreFamily ?? "",
    ...(Array.isArray(track.genres) ? track.genres : []),
  ];
  if (Array.isArray(track.spotifyArtistGenres)) {
    parts.push(...track.spotifyArtistGenres.filter((g): g is string => typeof g === "string"));
  }
  if (Array.isArray(track.albumGenres)) {
    parts.push(...track.albumGenres.filter((g): g is string => typeof g === "string"));
  }
  return parts.join(" ").toLowerCase();
}

/** Genre + artist evidence only — titles must not sole-satisfy requireAny (rainy/highway bait). */
function genreArtistEvidenceBlob(track: {
  trackName?: string | null;
  artistName?: string | null;
  albumName?: string | null;
  genrePrimary?: string | null;
  genreFamily?: string | null;
  genres?: string[] | null;
  spotifyArtistGenres?: unknown;
  albumGenres?: unknown;
}): string {
  const parts: string[] = [
    track.artistName ?? "",
    track.albumName ?? "",
    track.genrePrimary ?? "",
    track.genreFamily ?? "",
    ...(Array.isArray(track.genres) ? track.genres : []),
  ];
  if (Array.isArray(track.spotifyArtistGenres)) {
    parts.push(...track.spotifyArtistGenres.filter((g): g is string => typeof g === "string"));
  }
  if (Array.isArray(track.albumGenres)) {
    parts.push(...track.albumGenres.filter((g): g is string => typeof g === "string"));
  }
  const artistEvidence = artistIdentityGenreEvidence(track.artistName);
  if (artistEvidence) parts.push(artistEvidence);
  return parts.join(" ").toLowerCase();
}

function inBand(
  value: number | null | undefined,
  band?: { min?: number; max?: number },
): boolean {
  if (!band) return true;
  if (typeof value !== "number" || !Number.isFinite(value)) return true;
  if (band.min != null && value < band.min) return false;
  if (band.max != null && value > band.max) return false;
  return true;
}

/** Infer world ids from prompt text (works even without scene-lock anchors). */
export function inferWorldIdentityIdsFromPrompt(prompt: string | null | undefined): string[] {
  if (!prompt) return [];
  const ids: string[] = [];
  const p = prompt;

  if (/\bpop[-\s]?punk\b|\b2000s?\s+punk\b|\bemo\s+pop\b/i.test(p)) ids.push("pop_punk_world");
  if (/\bgrunge\b|\bseattle\s+(?:sound|grunge)\b/i.test(p)) ids.push("grunge_world");
  if (/\b(?:madchester|stone\s+roses|happy\s+mondays|baggy)\b/i.test(p)) ids.push("madchester_world");
  if (/\b(?:madchester|britpop|oasis|stone\s+roses)\b/i.test(p)) ids.push("britpop_world");
  if (/\b(?:ukg|uk\s+garage|2-?step|speed\s+garage)\b/i.test(p)) ids.push("uk_garage_world");
  if (/\bgrime\b/i.test(p) && !/\b(?:no|not|without)\s+grime\b/i.test(p)) ids.push("uk_garage_world");
  if (/\b(?:80s?|eighties)\s+(?:night\s+)?drive\b|\bnight\s+drive\b.*\b(?:80s?|synth|synthpop)\b/i.test(p)) {
    ids.push("80s_night_drive_world");
  }
  if (
    /\b(?:empty\s+)?motorway\b.*\b(?:midnight|rain|windscreen)\b|\b(?:midnight|rain)\b.*\b(?:empty\s+)?motorway\b|\bempty\s+motorway\s+at\s+midnight\b|\brain\b.*\bwindscreen\b/i.test(p)
  ) {
    ids.push("rainy_motorway_world");
  } else if (
    /\b(?:rainy|rain)\s+motorway\b/i.test(p)
  ) {
    ids.push("rainy_motorway_world");
  } else if (
    /\brain(?:y|ing)?\b.*\b(?:driv|highway|motorway|road)\b|\b(?:driv|highway|motorway)\b.*\brain/i.test(p)
  ) {
    ids.push("rainy_drive_world");
  }
  if (
    /\bcountry\s+cowboy\b|\bcowboy\s+road\b|\b(?:country|cowboy|red\s+dirt|americana)\b.*\b(?:road|trip|drive|highway)\b/i.test(p)
  ) {
    ids.push("country_world");
  }
  if (/\broad\s+trip\b.*\b(?:sing|singalong|anthem|banger)\b|\bsingalong\b.*\broad\s+trip\b/i.test(p)) {
    ids.push("road_trip_singalong_world");
  }
  if (/\bpetrol\s+station\b.*\b2\s*am\b|\b2\s*am\b.*\bpetrol\b/i.test(p)) ids.push("petrol_station_2am_world");
  if (/\b(?:pub|pint)\b.*\b(?:sing|anthem)\b|\bpub\s+singalong\b/i.test(p)) ids.push("pub_singalong_world");
  if (/\b(?:bedroom\s+pop|indie\s+bedroom)\b/i.test(p)) ids.push("indie_bedroom_world");
  if (/\b(?:rooftop)\b.*\b(?:party|drinks?)\b|\brooftop\s+party\b/i.test(p)) ids.push("rooftop_party_world");
  if (/\bmetal\b/i.test(p) && /\b(?:gym|workout|training|lifting)\b/i.test(p)) {
    ids.push("angry_rock_world", "heavy_gym_world");
  } else if (/\b(?:heavy|hard)\s+gym\b|\bgym\s+workout\b/i.test(p)) {
    ids.push("heavy_gym_world");
  }
  if (/\b(?:running|run\b|jogging|cardio\s+run)\b/i.test(p) && /\b(?:energy|upbeat|fast|tempo)\b/i.test(p)) {
    ids.push("running_energy_world");
  }
  if (/\barena\s+rock\b/i.test(p)) ids.push("arena_rock_world");
  if (/\bdad\s+rock\b/i.test(p)) ids.push("dad_rock_world", "dad_secret_world");
  if (
    /\b(?:pregame|pre[-\s]?game|getting\s+ready\s+(?:to\s+)?go\s+out|hype\s+for\s+(?:a\s+)?night\s+out|night\s+out\s+starting)\b/i.test(p)
  ) {
    ids.push("party_prep_world");
  } else if (!ids.includes("heavy_gym_world") && /\b(?:sleepy|tired|low[-\s]?energy)\s+(?:gym|workout)\b|\b(?:gym|workout)\s+(?:sleepy|tired|chill)\b|\bchill\s+(?:gym|workout)\b/i.test(p)) {
    ids.push("sleepy_gym_world");
  } else if (
    !ids.includes("heavy_gym_world") &&
    /\bangry\s+rock\b|\bangry\b.*\b(?:rock|workout|gym)\b|\b(?:rock|gym|workout)\b.*\bangry\b|\baggressive\b.*\b(?:gym|workout|pump|lifting)\b|\b(?:gym|workout|pump|lifting)\b.*\baggressive\b/i.test(p)
  ) {
    ids.push("angry_rock_world");
  } else if (
    !ids.includes("heavy_gym_world") &&
    /\b(?:gym|workout|training|lifting|cardio|weights|pump)\b/i.test(p) &&
    /\b(?:no\s+rap|not\s+rap|no\s+edm|rock|metal|heavy)\b/i.test(p)
  ) {
    ids.push("gym_rock_world");
  } else if (
    !ids.includes("heavy_gym_world") &&
    /\b(?:need\s+energy\s+for\s+the\s+gym|energy\s+for\s+the\s+gym|workout\s+music\s+that\s+isn'?t\s+aggressive|gym\b.*\b(?:not\s+edm|no\s+edm|not\s+aggressive))\b/i.test(p)
  ) {
    ids.push("gym_energy_world");
  } else if (!ids.includes("heavy_gym_world") && /\b(?:gym|workout|training|lifting|cardio|weights|pump)\b/i.test(p)) {
    ids.push("gym_rock_world");
  }
  if (/\bgoth\b|\bgothic\b|\bdarkwave\b|\bpost[-\s]?punk\b|\bindustrial\s+goth\b/i.test(p)) {
    ids.push("goth_world");
  }
  if (/\byacht\s+rock\b/i.test(p)) {
    ids.push("yacht_rock_world");
    ids.push("dad_secret_world");
  } else if (
    /\b(?:dad\s+rock|classic\s+rock|70s?\s+rock|80s?\s+rock|seventies\s+rock|eighties\s+rock)\b/i.test(p) ||
    /\b(?:70s?|seventies)\s+rock\b/i.test(p)
  ) {
    ids.push("classic_rock_world");
  }
  if (/\bdad\s+rock\b/i.test(p)) ids.push("dad_secret_world");
  if (/\blo-?fi\b|\blofi\b|\bchillhop\b|\bstudy\s+beats?\b/i.test(p)) ids.push("lofi_world");
  if (/\bambient\b|\bsoundscape\b|\bno\s+vocals?\b/i.test(p)) ids.push("ambient_world");
  if (
    /\b(?:deep\s+)?focus\b|\bno\s+distractions?\b|\bstudy\s+session\b|\bcoding\s+focus\b|\bconcentration\b|\bexam\s+revision\b/i.test(p) &&
    !ids.includes("lofi_world") &&
    !ids.includes("ambient_world")
  ) {
    ids.push("focus_study_world");
  }
  if (/\bboss\s+(?:fight|battle)\b|\bfinal\s+boss\b/i.test(p)) {
    // Too specific to curate honestly — route to gym energy instead of a fantasy OST world.
    if (!ids.includes("gym_energy_world")) ids.push("gym_energy_world");
  }
  if (/\bquiet\s+rage\b|\bsimmer(?:ing)?\s+(?:rage|anger)\b/i.test(p)) ids.push("quiet_rage");
  if (/\b(?:rave|club)\s+comedown\b|\bpost[-\s]?rave\b/i.test(p)) ids.push("rave_comedown");
  if (/\bsynthwave\b|\bretrowave\b|\bneon\s+(?:drive|tek|techno|city|nights?|streets?)\b|\b90s?\s+neon\b/i.test(p)) {
    ids.push("neon_tek_drive");
  }
  if (
    /\b(?:70s?|seventies)\s+disco\b|\bdisco\s+(?:party|dancefloor|night)\b|\bdisco\b.*\b(?:party|dance)\b/i.test(p) ||
    (/\bdisco\b/i.test(p) && /\b(?:party|dancefloor|dancing|pregame|groove)\b/i.test(p))
  ) {
    ids.push("disco_party_world", "disco_1970s_world");
  }
  if (
    /\b(?:empty\s+)?motorway\b.*\b(?:midnight|rain|windscreen)\b|\b(?:midnight|rain)\b.*\b(?:empty\s+)?motorway\b/i.test(p) ||
    /\bempty\s+motorway\s+at\s+midnight\b/i.test(p) ||
    /\brain\b.*\bwindscreen\b/i.test(p)
  ) {
    if (!ids.includes("rainy_motorway_world")) ids.push("rainy_motorway_world");
  } else if (
    /\brain(?:y|ing)?\b.*\b(?:driv|highway|motorway|road)\b|\b(?:driv|highway|motorway)\b.*\brain/i.test(p)
  ) {
    if (!ids.includes("rainy_motorway_world")) ids.push("rainy_drive_world");
  } else if (/\b(?:cozy|chill|calm|soft)\b.*\brain|\brain(?:y|ing)?\b.*\b(?:cozy|chill|calm|night\s+chill)\b/i.test(p)) {
    ids.push("chill_rainy_world");
  }
  if (
    /\b(?:motorway|highway)\s+at\s+(?:night|midnight)\b|\b(?:empty|night)\s+(?:motorway|highway)\b|\bmotorway\s+at\s+midnight\b/i.test(p)
  ) {
    if (!ids.includes("rainy_motorway_world") && !ids.includes("rainy_drive_world")) ids.push("night_drive_world");
  }
  if (
    /\b(?:evening|sunset)\s+(?:drive|driving)\b|\b(?:night|late)\s+(?:drive|driving)\b.*\b(?:motorway|highway|road)\b/i.test(p) &&
    !ids.includes("rainy_drive_world") &&
    !ids.includes("rainy_motorway_world")
  ) {
    ids.push("evening_drive_world");
  }
  if (/\bsad\s+night\s+driv|\bmelanchol\w*\s+(?:night\s+)?driv|\bsad\b.*\bdriv|\bdriv\w*\s+.*\bsad\b/i.test(p)) {
    ids.push("melancholy_drive");
  }
  if (/\b(?:rainy|rain)\b.*\b(?:read|book|window)\b|\b(?:read|book)\b.*\b(?:rain|window)\b/i.test(p)) {
    ids.push("rainy_reading_world");
  }
  if (/\bbeach\s+sunset\b|\bsunset\b.*\b(?:beach|not too sleepy)\b/i.test(p)) {
    ids.push("beach_sunset_world");
  }
  if (/\bpre\s+drinks?\b|\bhype\s+(?:for\s+a\s+)?night\s+out\b|\bnight\s+out\s+starting\b/i.test(p)) {
    ids.push("party_prep_world");
  }
  if (/\bsongs?\s+that\s+feel\s+like\s+summer\b|\bsummer\s+vibes?\b/i.test(p)) {
    ids.push("summer_warm_world");
  }
  if (/\bacoustic\s+sunday\b/i.test(p)) {
    ids.push("acoustic_sunday_world");
  }
  if (/\b(?:late\s+night\s+wind|wind(?:ing)?\s+down)\b/i.test(p) && !ids.includes("late_night_calm_world")) {
    ids.push("late_night_calm_world");
  }
  if (/\b90s?\s+r&b\b|\bslow\s+jams?\b.*\blate\s+night\b/i.test(p)) {
    ids.push("rnb_night_world");
  }
  if (/\bbritpop\b/i.test(p)) {
    ids.push("britpop_world");
  }
  if (/\b(?:film ending|feels like a film ending|expensive and cinematic)\b/i.test(p)) {
    ids.push("film_ending_world");
  }
  if (/\b(?:songs?\s+my\s+dad|dad would secretly)\b/i.test(p)) {
    ids.push("dad_secret_world");
  }
  if (/\b(?:cool\s+older\s+sibling|older\s+sibling)\b/i.test(p)) {
    ids.push("older_sibling_world");
  }
  if (/\blatin\b/i.test(p) && /\b(?:summer|rooftop|drinks?)\b/i.test(p)) {
    ids.push("latin_summer_rooftop_world");
  } else if (/\blatin\s+summer\s+rooftop\b|\blatin.*rooftop\b/i.test(p)) {
    ids.push("latin_summer_rooftop_world");
  }
  if (/\bcommute\b|\btrain delayed\b/i.test(p)) {
    ids.push("commute_world");
  }
  if (/\bfirst\s+date\b/i.test(p)) {
    ids.push("first_date_world");
  }
  if (/\b(?:morning walk|upbeat stuff for a morning walk)\b/i.test(p)) {
    ids.push("upbeat_chore_world");
  }
  if (/\b(?:got a promotion|let'?s go+)\b/i.test(p)) {
    ids.push("feel_good_world");
  }
  if (/\b(?:ignore them and lift|ex'?s?\s+birthday)\b/i.test(p) && /\blift\b/i.test(p)) {
    ids.push("gym_energy_world");
  }

  // Vague lifestyle prompts: commit one everyday world when no named lock fired.
  if (ids.length === 0) {
    const commit = resolveVagueWorldCommit(p);
    if (commit.action === "commit" && commit.worldId) ids.push(commit.worldId);
  }

  return [...new Set(ids)];
}

/** Count library tracks that pass hard world-identity lock for this prompt. */
export function countWorldVerifiedLibrarySupply(
  tracks: Array<{
    trackId: string;
    trackName?: string | null;
    artistName?: string | null;
    albumName?: string | null;
    energy?: number | null;
    valence?: number | null;
    danceability?: number | null;
    instrumentalness?: number | null;
    popularity?: number | null;
    spotifyArtistGenres?: unknown;
    albumGenres?: unknown;
  }>,
  prompt: string,
  classMap: Map<string, {
    genrePrimary?: string;
    genreFamily?: string;
    primarySubgenre?: string;
    secondarySubgenre?: string | null;
    subGenres?: string[];
  }>,
  opts?: { reason?: string | null; anchors?: string[] | null },
): number {
  const profiles = worldIdentityProfilesForLock({
    prompt,
    reason: opts?.reason ?? null,
    anchors: opts?.anchors ?? null,
  });
  if (profiles.length === 0) return 0;
  let count = 0;
  for (const track of tracks) {
    const classification = classMap.get(track.trackId);
    if (
      passesWorldIdentity(
        {
          trackName: track.trackName ?? null,
          artistName: track.artistName ?? null,
          albumName: track.albumName ?? null,
          genrePrimary: classification?.genrePrimary ?? null,
          genreFamily: classification?.genreFamily ?? null,
          genres: classification?.subGenres ?? null,
          spotifyArtistGenres: track.spotifyArtistGenres,
          albumGenres: track.albumGenres,
          energy: track.energy ?? null,
          valence: track.valence ?? null,
          danceability: track.danceability ?? null,
          instrumentalness: track.instrumentalness ?? null,
          popularity: track.popularity ?? null,
        },
        profiles,
        { hardLock: true },
      )
    ) {
      count += 1;
    }
  }
  return count;
}

/**
 * True when artist is a known retrieval safety blanket outside their natural world.
 * Energy-compatible ≠ world-compatible.
 */
export function isSafetyBlanketOutsideWorld(
  artistName: string | null | undefined,
  activeWorldIds: string[],
): boolean {
  if (!artistName || activeWorldIds.length === 0) return false;
  const strictActive = activeWorldIds.filter((id) => STRICT_WORLD_IDS.has(id));
  if (strictActive.length === 0) return false;

  for (const blanket of SAFETY_BLANKET_ARTISTS) {
    if (!blanket.pattern.test(artistName)) continue;
    const allowed = blanket.naturalWorlds.some((w) => activeWorldIds.includes(w));
    if (!allowed) return true;
  }
  return false;
}

/** Last-line API strip for retrieval filler artists outside committed worlds. */
export function stripRetrievalFillerTracks<T extends { artistName?: string | null; artist?: string | null }>(
  tracks: T[],
  activeWorldIds: string[],
  opts?: { minKeep?: number; prompt?: string | null },
): { tracks: T[]; removed: Array<{ artist: string; reason: string }> } {
  if (tracks.length === 0 || activeWorldIds.length === 0) {
    return { tracks, removed: [] };
  }
  const minKeep = opts?.minKeep ?? Math.max(3, Math.ceil(tracks.length * 0.45));
  const vagueLandfillSuppress = shouldSuppressVagueLandfillOpeners(opts?.prompt);
  const clean: T[] = [];
  const filler: T[] = [];
  const removed: Array<{ artist: string; reason: string }> = [];
  for (const track of tracks) {
    const artist = String(track.artistName ?? track.artist ?? "").trim();
    const isFiller =
      artist &&
      OPENER_FILLER_PATTERN.test(artist) &&
      (vagueLandfillSuppress || isSafetyBlanketOutsideWorld(artist, activeWorldIds));
    if (isFiller) {
      filler.push(track);
      removed.push({ artist, reason: "retrieval_filler_outside_world" });
      continue;
    }
    clean.push(track);
  }
  if (clean.length >= minKeep) {
    return { tracks: clean, removed };
  }
  const need = minKeep - clean.length;
  return {
    tracks: [...clean, ...filler.slice(0, need)],
    removed: removed.slice(need),
  };
}

/**
 * Demote opener-slot filler artists to the tail — prevents Kasabian → Q Lazzarus chains
 * without stripping supply when the library is thin.
 */
export function demoteOpenerFillerTracks<T extends { artistName?: string | null; artist?: string | null }>(
  tracks: T[],
  activeWorldIds: string[],
  openerSlots = 3,
  prompt?: string | null,
): { tracks: T[]; demoted: Array<{ artist: string; fromIndex: number; toIndex: number }> } {
  if (tracks.length <= openerSlots || activeWorldIds.length === 0) {
    return { tracks, demoted: [] };
  }
  const vagueLandfillSuppress = shouldSuppressVagueLandfillOpeners(prompt);
  const isOutsideFiller = (artist: string): boolean => {
    if (!artist || !OPENER_FILLER_PATTERN.test(artist)) return false;
    if (vagueLandfillSuppress) return true;
    return isSafetyBlanketOutsideWorld(artist, activeWorldIds);
  };
  const maxOpeners = vagueLandfillSuppress ? 0 : maxPsychIndieOpenersForWorlds(activeWorldIds);
  const out = tracks.slice();
  const demoted: Array<{ artist: string; fromIndex: number; toIndex: number }> = [];
  const limit = Math.min(openerSlots, out.length);
  let demoteAttempts = 0;
  const maxDemoteAttempts = out.length * openerSlots;

  while (demoteAttempts < maxDemoteAttempts) {
    let outsideFillerCount = 0;
    for (let j = 0; j < limit; j++) {
      const artist = String(out[j]!.artistName ?? out[j]!.artist ?? "").trim();
      if (artist && isOutsideFiller(artist)) {
        outsideFillerCount += 1;
      }
    }
    if (outsideFillerCount <= maxOpeners) break;

    let demotedThisPass = false;
    if (maxOpeners <= 0) {
      for (let i = 0; i < limit; i++) {
        const artist = String(out[i]!.artistName ?? out[i]!.artist ?? "").trim();
        if (!artist) continue;
        const outsideBlanket = isOutsideFiller(artist);
        const psychFiller = outsideBlanket;
        if (!outsideBlanket && !psychFiller) continue;
        const [track] = out.splice(i, 1);
        if (track) {
          out.push(track);
          demoted.push({ artist, fromIndex: i, toIndex: out.length - 1 });
        }
        demoteAttempts += 1;
        demotedThisPass = true;
        break;
      }
    } else {
      let allowed = 0;
      for (let i = 0; i < limit; i++) {
        const artist = String(out[i]!.artistName ?? out[i]!.artist ?? "").trim();
        if (!artist || !isOutsideFiller(artist)) continue;
        allowed += 1;
        if (allowed > maxOpeners) {
          const [track] = out.splice(i, 1);
          if (track) {
            out.push(track);
            demoted.push({ artist, fromIndex: i, toIndex: out.length - 1 });
          }
          demoteAttempts += 1;
          demotedThisPass = true;
          break;
        }
      }
    }
    if (!demotedThisPass) break;
  }

  return { tracks: out, demoted };
}

/** Count psych-indie opener fillers in the first N slots (algorithm-smell chain detector). */
export function countPsychIndieOpenerFillers<T extends { artistName?: string | null; artist?: string | null }>(
  tracks: T[],
  openerSlots = 3,
  activeWorldIds?: string[],
): number {
  return tracks
    .slice(0, openerSlots)
    .filter((track) => {
      const artist = trackArtistName(track);
      if (!artist || !OPENER_FILLER_PATTERN.test(artist)) return false;
      if (activeWorldIds && activeWorldIds.length > 0) {
        return isSafetyBlanketOutsideWorld(artist, activeWorldIds);
      }
      return true;
    }).length;
}

export type OpenerHygieneDiagnostics = {
  retrievalFillerStripped?: number;
  retrievalFillerRemoved?: Array<{ artist: string; reason: string }>;
  openerFillerDemoted?: number;
  openerFillerDemotedArtists?: string[];
  remixBaitDemoted?: number;
  remixBaitDemotedTitles?: string[];
  psychIndieOpenerSanitized?: number;
  psychIndieOpenerSanitizedArtists?: string[];
  psychIndieOpenerMaxAllowed?: number;
  vagueLandfillSuppressed?: boolean;
};

/** Last-mile strip + demote + sanitize on the API payload track list. */
export function applyFinalApiOpenerHygiene<
  T extends { artistName?: string | null; artist?: string | null; trackName?: string | null; name?: string | null; title?: string | null },
>(tracks: T[], inferredWorldIds: string[], opts?: { minKeep?: number; prompt?: string | null }): {
  tracks: T[];
  diagnostics: OpenerHygieneDiagnostics;
} {
  let out = tracks;
  const diagnostics: OpenerHygieneDiagnostics = {};
  const minKeep = opts?.minKeep ?? 3;
  const vagueLandfillSuppress = shouldSuppressVagueLandfillOpeners(opts?.prompt);
  if (vagueLandfillSuppress) diagnostics.vagueLandfillSuppressed = true;

  if (inferredWorldIds.length > 0 && out.length > 0) {
    const fillerStrip = stripRetrievalFillerTracks(out, inferredWorldIds, {
      minKeep,
      prompt: opts?.prompt,
    });
    if (fillerStrip.removed.length > 0) {
      out = fillerStrip.tracks;
      diagnostics.retrievalFillerStripped = fillerStrip.removed.length;
      diagnostics.retrievalFillerRemoved = fillerStrip.removed.slice(0, 12);
    }
    const openerDemote = demoteOpenerFillerTracks(out, inferredWorldIds, 3, opts?.prompt);
    if (openerDemote.demoted.length > 0) {
      out = openerDemote.tracks;
      diagnostics.openerFillerDemoted = openerDemote.demoted.length;
      diagnostics.openerFillerDemotedArtists = openerDemote.demoted.slice(0, 8).map((d) => d.artist);
    }
    const remixDemote = demoteRemixBaitOpeners(out, inferredWorldIds, 3);
    if (remixDemote.demoted.length > 0) {
      out = remixDemote.tracks;
      diagnostics.remixBaitDemoted = remixDemote.demoted.length;
      diagnostics.remixBaitDemotedTitles = remixDemote.demoted.slice(0, 8).map((d) => d.title);
    }
  }

  if (out.length > 3) {
    const maxPsychOpeners = vagueLandfillSuppress
      ? 0
      : maxPsychIndieOpenersForWorlds(inferredWorldIds);
    diagnostics.psychIndieOpenerMaxAllowed = maxPsychOpeners;
    const openerSanitize = sanitizePsychIndieOpenerChain(out, 3, maxPsychOpeners);
    if (openerSanitize.demoted.length > 0) {
      out = openerSanitize.tracks;
      diagnostics.psychIndieOpenerSanitized = openerSanitize.demoted.length;
      diagnostics.psychIndieOpenerSanitizedArtists = openerSanitize.demoted.slice(0, 8).map((d) => d.artist);
    }
  }

  return { tracks: out, diagnostics };
}

/** Reorder delivery rows to match the sanitized API track order. */
export function syncTracksToApiOrder<T extends { trackId: string }, U extends { id?: string }>(
  deliveryTracks: T[],
  apiTracks: U[],
): T[] {
  const byId = new Map(deliveryTracks.map((t) => [t.trackId, t]));
  return apiTracks
    .map((t) => (t.id ? byId.get(t.id) : undefined))
    .filter((t): t is T => !!t);
}

/** Apply opener hygiene to pipeline delivery tracks before terminal freeze. */
export function applyPreFreezeOpenerHygieneToDelivery<
  T extends { trackId: string; artistName?: string | null; trackName?: string | null },
>(tracks: readonly T[], inferredWorldIds: string[], opts?: { minKeep?: number; prompt?: string | null }): {
  tracks: T[];
  diagnostics: OpenerHygieneDiagnostics;
} {
  const apiShape = tracks.map((track) => ({
    artistName: track.artistName,
    artist: track.artistName,
    trackName: track.trackName,
    id: track.trackId,
  }));
  const hygiene = applyFinalApiOpenerHygiene(apiShape, inferredWorldIds, opts);
  return {
    tracks: syncTracksToApiOrder([...tracks], hygiene.tracks),
    diagnostics: hygiene.diagnostics,
  };
}

/** Structured opener-hygiene metrics for dashboards and integration tests. */
export function buildOpenerHygieneMetrics(
  diagnostics: OpenerHygieneDiagnostics,
  opts?: {
    preFreezeApplied?: boolean;
    postFreezeApplied?: boolean;
    pipelineOpenerIds?: string[];
    apiOpenerIds?: string[];
  },
): Record<string, unknown> {
  const pipelineOpeners = opts?.pipelineOpenerIds ?? [];
  const apiOpeners = opts?.apiOpenerIds ?? [];
  return {
    preFreezeApplied: opts?.preFreezeApplied ?? false,
    postFreezeApplied: opts?.postFreezeApplied ?? false,
    retrievalFillerStripped: diagnostics.retrievalFillerStripped ?? 0,
    openerFillerDemoted: diagnostics.openerFillerDemoted ?? 0,
    psychIndieOpenerSanitized: diagnostics.psychIndieOpenerSanitized ?? 0,
    psychIndieOpenerMaxAllowed: diagnostics.psychIndieOpenerMaxAllowed ?? null,
    demotedArtists: [
      ...(diagnostics.openerFillerDemotedArtists ?? []),
      ...(diagnostics.psychIndieOpenerSanitizedArtists ?? []),
    ].slice(0, 12),
    openerOrderAligned:
      pipelineOpeners.length > 0 && apiOpeners.length > 0
        ? pipelineOpeners.slice(0, 3).join("|") === apiOpeners.slice(0, 3).join("|")
        : null,
  };
}

export function worldIdentityProfilesForLock(opts: {
  reason?: string | null;
  anchors?: string[] | null;
  prompt?: string | null;
}): WorldIdentityProfile[] {
  const ids = new Set<string>(opts.anchors ?? []);
  const reason = opts.reason ?? "";
  const ukSceneLock = reason.startsWith("uk_hip_hop_scene_lock:");
  const m = reason.match(/cultural_scene_lock:([a-z0-9_]+)/i);
  if (m?.[1]) ids.add(m[1]);
  if (!ukSceneLock) {
    for (const inferred of inferWorldIdentityIdsFromPrompt(opts.prompt)) {
      ids.add(inferred);
    }
  }
  if (ids.has("rainy_night_drive")) ids.add("rainy_drive_world");
  if (/\b(?:rave|club)\s+comedown\b|\bcomedown\b.*\b(?:rave|club|bus)\b|\bpost[-\s]?rave\b/i.test(opts.prompt ?? "")) {
    ids.add("rave_comedown");
  }

  const prompt = opts.prompt ?? "";
  const lower = prompt.toLowerCase();

  const profileForId = (id: string): WorldIdentityProfile | null => {
    if (id === "rave_comedown") {
      return {
        ...COMEDOWN_IDENTITY,
        energy: { max: 0.62 },
        valence: { max: 0.58 },
      };
    }
    const base = IDENTITY_BY_LOCK_ID[id];
    if (!base) return null;
    if (id === "goth_world" && /\bdanceable\b/i.test(lower)) {
      return {
        ...base,
        energy: { max: 0.88 },
        valence: { max: 0.78 },
        // Soft preference only — a hard danceability min falsely thinned Cure /
        // darkwave tracks tagged below 0.4 in Spotify audio features.
      };
    }
    if (id === "sleepy_gym_world") {
      return {
        ...base,
        energy: { max: /\bchill\b|\blow[-\s]?energy\b/i.test(lower) ? 0.68 : base.energy?.max },
      };
    }
    if (
      (id === "gym_rock_world" || id === "angry_rock_world" || id === "heavy_gym_world") &&
      /\bmetal\b/i.test(lower)
    ) {
      return {
        ...base,
        rejectAny: [...base.rejectAny, METAL_POP_PUNK_REJECT],
      };
    }
    if (id === "neon_tek_drive" && /\b90s?\b|\bnineties\b|\bneon\b/i.test(lower)) {
      return {
        ...base,
        requireAny: [
          /\b(?:synthwave|retrowave|outrun|darksynth|synth[-\s]?pop|new\s+wave|italo|eurodance|neon|cyber|80s?\s+synth|90s?\s+(?:electronic|synth|dance|pop))\b/i,
          /\b(?:kavinsky|carpenter\s+brut|perturbator|fm[-\s]?84|the\s+midnight|gunship|timecop|com\s+truise|miami\s+nights|daft\s+punk|justice|lcd\s+soundsystem)\b/i,
        ],
        rejectAny: [
          ...base.rejectAny,
          /\b(?:hard\s+techno|tekkno|tekno|jump\s+up|brostep|drum\s*(?:and|&)\s*bass|dnb|uk\s*drill|phonk|modern\s+bass)\b/i,
        ],
      };
    }
    if (id === "boss_fight" && /\bemotional\b|\bsoundtrack\b/i.test(lower)) {
      return {
        ...base,
        energy: { min: 0.48 },
        valence: { max: 0.72 },
        requireAny: [
          /\b(?:metal|metalcore|industrial|electronic|synth|soundtrack|ost|epic|orchestral|trailer|hybrid|drum\s+and\s+bass|dnb|hardstyle|breakcore|cinematic|darksynth|aggrotech|game\s+score)\b/i,
          /\b(?:boss|combat|battle|fight|raid|doom|quake|halo|final\s+fantasy|nier|devil\s+may\s+cry|two\s+steps\s+from\s+hell|audiomachine|immediate\s+music|celldweller|pendulum|knife\s+party)\b/i,
        ],
        rejectAny: [
          ...base.rejectAny,
          /\b(?:ballad|acoustic|singer[-\s]?songwriter|love\s+song|lullaby)\b/i,
          /\b(?:christina\s+perri|debbie\s+harry|ed\s+sheeran|adele\b|sam\s+smith)\b/i,
        ],
      };
    }
    return base;
  };

  const out: WorldIdentityProfile[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const profile = profileForId(id);
    if (profile) out.push(profile);
  }
  return out;
}

/**
 * Hard world lock: reject off-identity bait.
 * Soft: apply rejectAny + safety blankets; do not require positive evidence.
 *
 * Multiple profiles (e.g. scene-lock merges) use UNION semantics:
 * - reject if ANY profile rejectAny matches
 * - admit if ANY profile requireAny matches
 * Energy never compensates for missing world evidence.
 */
export function passesWorldIdentity(
  track: {
    trackName?: string | null;
    artistName?: string | null;
    albumName?: string | null;
    genrePrimary?: string | null;
    genreFamily?: string | null;
    genres?: string[] | null;
    spotifyArtistGenres?: unknown;
    albumGenres?: unknown;
    energy?: number | null;
    valence?: number | null;
    danceability?: number | null;
    instrumentalness?: number | null;
    popularity?: number | null;
  },
  profiles: WorldIdentityProfile[],
  opts: { hardLock: boolean },
): boolean {
  if (profiles.length === 0) return true;
  const blob = genresBlob(track);
  const evidence = genreArtistEvidenceBlob(track);
  const titleArtist = `${track.trackName ?? ""} ${track.artistName ?? ""}`.toLowerCase();
  const title = String(track.trackName ?? "").toLowerCase();
  const activeIds = profiles.map((p) => p.id);

  if (isSafetyBlanketOutsideWorld(track.artistName, activeIds)) {
    return false;
  }
  if (artistForbiddenInWorld(track.artistName, activeIds)) {
    return false;
  }

  for (const profile of profiles) {
    for (const re of profile.rejectAny) {
      if (re.test(blob) || re.test(titleArtist)) return false;
    }
  }

  const primary = profiles[0]!;
  const hasPositiveEvidence = profiles.some((profile) =>
    profile.requireAny.some((re) => re.test(evidence)),
  ) || artistSupportsWorld(track.artistName, activeIds);

  if (opts.hardLock && LEXICAL_BAIT_REJECT.test(titleArtist)) {
    const titleIsBaitToken = /^(?:ruin|ruins|slow|goth|gotham|bedroom|dark|sad|rage|quiet|boss|fight|home|love|dream|shadow|rain|rainy|highway|night|drive)$/i.test(
      title.replace(/[^a-z0-9\s]/g, "").trim(),
    );
    if ((titleIsBaitToken || /\bgotham\b/i.test(title) || SCENE_TITLE_BAIT.test(title)) && !hasPositiveEvidence) {
      return false;
    }
  }

  // Audio bands from the primary (most specific) profile only.
  if (!inBand(track.energy, primary.energy)) return false;
  if (!inBand(track.valence, primary.valence)) return false;
  if (!inBand(track.danceability, primary.danceability)) return false;
  if (!inBand(track.instrumentalness, primary.instrumentalness)) return false;
  if (
    primary.maxPopularity != null &&
    typeof track.popularity === "number" &&
    track.popularity > primary.maxPopularity
  ) {
    return false;
  }

  if (opts.hardLock) {
    // Positive world evidence must come from genres/artist/album — not title bait
    // ("Rainy Dayz", "Highwayman", "Sunglasses At Night").
    if (hasPositiveEvidence) return true;
    return false;
  }
  return true;
}

/**
 * Estimate 0–1 world membership for ranking diagnostics.
 * Low scores should hard-filter before ranking, not be rescued by energy affinity.
 */
export function estimateWorldMembership(
  track: {
    trackName?: string | null;
    artistName?: string | null;
    albumName?: string | null;
    genrePrimary?: string | null;
    genreFamily?: string | null;
    genres?: string[] | null;
    spotifyArtistGenres?: unknown;
    albumGenres?: unknown;
    energy?: number | null;
    valence?: number | null;
    danceability?: number | null;
    instrumentalness?: number | null;
    popularity?: number | null;
  },
  profiles: WorldIdentityProfile[],
): number {
  if (profiles.length === 0) return 0.5;
  if (!passesWorldIdentity(track, profiles, { hardLock: true })) return 0;
  const evidence = genreArtistEvidenceBlob(track);
  let best = 0.35;
  for (const profile of profiles) {
    if (profile.requireAny.some((re) => re.test(evidence))) best = Math.max(best, 0.92);
    else best = Math.max(best, 0.55);
  }
  return best;
}
