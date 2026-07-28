/**
 * Cultural world profiles — anchor artists + forbidden lists, not Spotify genres alone.
 * Wired from CommittedWorld via getCulturalProfile(worldId).
 */

export type CulturalWorldProfile = {
  worldId: string;
  anchorArtists: RegExp[];
  /** Literal artist names for Spotify anchor search and coverage counting. */
  anchorArtistNames?: string[];
  anchorTracks: RegExp[];
  /** Canonical legendary tracks — opener thesis candidates. */
  legendaryTracks?: RegExp[];
  /** Adjacent artists that belong in the world but aren't canonical anchors. */
  adjacentArtists?: string[];
  /** Major scene artists — tier below anchor, above deep cuts. */
  majorArtists?: string[];
  /** Lesser-known but world-correct tracks for dig-deeper retrieval. */
  deepCuts?: string[];
  /** Obscure but valid artists when anchors are exhausted. */
  forgottenArtists?: string[];
  /** Cult / niche artists that still belong. */
  cultArtists?: string[];
  /** Era-neighbour artists for expansion without breaking integrity. */
  eraExtensions?: string[];
  /** Artists acceptable as adjacency without being anchors (expansion filter). */
  acceptableAdjacency?: string[];
  /** Modern artists that fit without breaking era integrity. */
  acceptableModernArtists?: string[];
  /** Artists to never surface for this world (beyond regex forbidden lists). */
  avoidArtists?: string[];
  /** Genre tokens that betray this world. */
  avoidGenres?: string[];
  /** Energy bands that break world immersion. */
  avoidEnergyPatterns?: Array<{ min?: number; max?: number; reason: string }>;
  /** Human-readable ban reasons for logging. */
  avoidReasons?: string[];
  preferredEras: { min?: number; max?: number };
  energyRange: { min?: number; max?: number };
  instrumentation: string[];
  vocalStyle: string[];
  forbiddenArtists: RegExp[];
  forbiddenPatterns: RegExp[];
  openerRules: {
    minWorldIdentityScore: number;
    preferAnchorArtist: boolean;
    /** Anchor artist always beats adjacent for track 1. */
    anchorBeatsAdjacent?: boolean;
    sequencing?: "cinematic_to_reflective" | "high_energy_cooldown";
  };
};

/** Profile id aliases — resolve prompt/world ids to canonical profiles. */
const CULTURAL_PROFILE_ALIASES: Record<string, string> = {
  "80s_drive": "80s_night_drive_world",
  gym_world: "gym_rock_world",
  disco_world: "disco_1970s_world",
};

/** V15 priority anchor order — thesis selection and expansion search order. */
const PRIORITY_ANCHOR_ORDER: Record<string, string[]> = {
  "80s_night_drive_world": [
    "The Cure",
    "New Order",
    "Depeche Mode",
    "Tears for Fears",
    "Simple Minds",
    "Pet Shop Boys",
    "M83",
  ],
  rainy_motorway_world: [
    "M83",
    "Chromatics",
    "The War on Drugs",
    "Depeche Mode",
    "New Order",
  ],
  rainy_drive_world: ["M83", "Chromatics", "The War on Drugs", "Depeche Mode"],
  madchester_world: [
    "The Stone Roses",
    "Happy Mondays",
    "Oasis",
    "New Order",
    "Inspiral Carpets",
  ],
  disco_1970s_world: [
    "Bee Gees",
    "Michael Jackson",
    "Chic",
    "Donna Summer",
    "Earth, Wind & Fire",
    "Sister Sledge",
    "KC and the Sunshine Band",
    "Gloria Gaynor",
  ],
  disco_world: [
    "Bee Gees",
    "Michael Jackson",
    "Chic",
    "Donna Summer",
    "Earth, Wind & Fire",
    "Sister Sledge",
    "KC and the Sunshine Band",
  ],
  gym_rock_world: [
    "Metallica",
    "AC/DC",
    "Guns N' Roses",
    "Foo Fighters",
    "Black Sabbath",
    "Iron Maiden",
  ],
  gym_world: ["Metallica", "AC/DC", "Guns N' Roses", "Slayer", "Rage Against the Machine"],
  heavy_gym_world: ["Metallica", "Slayer", "Megadeth", "AC/DC", "Foo Fighters"],
  classic_rock_world: [
    "Queen",
    "AC/DC",
    "Eagles",
    "Fleetwood Mac",
    "Tom Petty",
    "Led Zeppelin",
    "Guns N' Roses",
  ],
  country_world: [
    "Johnny Cash",
    "Dolly Parton",
    "Willie Nelson",
    "Luke Combs",
    "Chris Stapleton",
    "Zach Bryan",
    "Alan Jackson",
  ],
};

/** Priority-ordered anchor names for thesis selection and retrieval expansion. */
export function getPriorityAnchorOrder(profile: CulturalWorldProfile): string[] {
  const priority = PRIORITY_ANCHOR_ORDER[profile.worldId];
  if (priority && priority.length > 0) return priority;
  if (profile.anchorArtistNames && profile.anchorArtistNames.length > 0) {
    return profile.anchorArtistNames;
  }
  return profile.anchorArtists
    .map((re) => re.source.replace(/\\b/g, "").replace(/\\/g, "").trim())
    .filter((s) => s.length > 1);
}

/** Extract literal anchor artist names from profile (explicit list or regex sources). */
export function extractAnchorArtistNames(profile: CulturalWorldProfile): string[] {
  return getPriorityAnchorOrder(profile);
}

export function extractAdjacentArtistNames(profile: CulturalWorldProfile): string[] {
  return profile.adjacentArtists ?? [];
}

export function extractMajorArtistNames(profile: CulturalWorldProfile): string[] {
  return profile.majorArtists ?? [];
}

export function extractDeepCutNames(profile: CulturalWorldProfile): string[] {
  return profile.deepCuts ?? [];
}

export function extractForgottenArtistNames(profile: CulturalWorldProfile): string[] {
  return profile.forgottenArtists ?? [];
}

export function extractCultArtistNames(profile: CulturalWorldProfile): string[] {
  return profile.cultArtists ?? [];
}

export function extractEraExtensionNames(profile: CulturalWorldProfile): string[] {
  return profile.eraExtensions ?? [];
}

export function extractAcceptableAdjacencyNames(profile: CulturalWorldProfile): string[] {
  return profile.acceptableAdjacency ?? [];
}

export function matchesAcceptableAdjacency(artistName: string, profile: CulturalWorldProfile): boolean {
  const artist = String(artistName ?? "").trim().toLowerCase();
  if (!artist) return false;
  return (profile.acceptableAdjacency ?? []).some((adj) => artist.includes(adj.toLowerCase()));
}

export function matchesAdjacentArtist(artistName: string, profile: CulturalWorldProfile): boolean {
  const artist = String(artistName ?? "").trim().toLowerCase();
  if (!artist) return false;
  return (profile.adjacentArtists ?? []).some((adj) => artist.includes(adj.toLowerCase()));
}

export function matchesAvoidArtist(artistName: string, profile: CulturalWorldProfile): boolean {
  const artist = String(artistName ?? "").trim().toLowerCase();
  if (!artist) return false;
  if (
    (profile.avoidArtists ?? []).some((a) => {
      const needle = a.toLowerCase().trim();
      if (!needle) return false;
      if (artist.includes(needle) || needle.includes(artist)) return true;
      const artistTokens = artist.split(/[+&/]/).map((t) => t.trim()).filter(Boolean);
      return artistTokens.some((token) => needle.includes(token) || token.includes(needle));
    })
  ) {
    return true;
  }
  return profile.forbiddenArtists.some((re) => re.test(artistName));
}

export function matchesAvoidGenre(genreBlob: string, profile: CulturalWorldProfile): boolean {
  const blob = String(genreBlob ?? "").toLowerCase();
  if (!blob) return false;
  return (profile.avoidGenres ?? []).some((g) => blob.includes(g.toLowerCase().trim()));
}

export function matchesAvoidEnergy(
  energy: number | null | undefined,
  profile: CulturalWorldProfile,
): string | null {
  if (typeof energy !== "number" || !Number.isFinite(energy)) return null;
  for (const pattern of profile.avoidEnergyPatterns ?? []) {
    const hasMin = pattern.min != null;
    const hasMax = pattern.max != null;
    if (!hasMin && !hasMax) continue;
    const aboveMin = hasMin ? energy >= pattern.min! : true;
    const belowMax = hasMax ? energy <= pattern.max! : true;
    if (aboveMin && belowMax) return pattern.reason;
  }
  return null;
}

const LANDFILL: RegExp[] = [
  /\bbon\s+iver\b/i,
  /\bphoebe\s+bridgers\b/i,
  /\bclairo\b/i,
  /\bnoah\s+kahan\b/i,
  /\bsufjan\s+stevens\b/i,
  /\bbeach\s+house\b/i,
  /\biron\s+(?:&|and)\s+wine\b/i,
  /\bfleet\s+foxes\b/i,
  /\bmac\s+demarco\b/i,
  /\bdayglow\b/i,
  /\bgregory\s+alan\s+isakov\b/i,
];

const HIP_HOP_PARTY: RegExp[] = [
  /\b(?:hip[\s-]?hop|rap|trap|drill|grime|party\s+anthem|club\s+banger)\b/i,
];

const ACOUSTIC_BREAKUP: RegExp[] = [
  /\b(?:acoustic\s+version|unplugged|heartbreak|breakup|skinny\s+love|pink\s+moon)\b/i,
  /\b(?:nick\s+drake|iron\s+(?:&|and)\s+wine|damien\s+rice)\b/i,
];

const REMIX_EDIT_BAIT: RegExp[] = [
  /\b(?:remix|rework|re-?edit|extended\s+mix|club\s+mix|dub\s+mix|radio\s+edit|dj\s+edit|bootleg|flip)\b/i,
  /\bcalvin\s+harris\b/i,
  /\bnimino\b/i,
];

const PARTY_PHONKY_COMEDY: RegExp[] = [
  /\b(?:phonky|phonk)\b/i,
  /\b(?:comedy|party\s+anthem|jump\s+up|brostep|dubstep|uk\s+garage|ukg)\b/i,
  /\bfunk\s+tribu\b/i,
];

const CULTURAL_PROFILES: Record<string, CulturalWorldProfile> = {
  classic_rock_world: {
    worldId: "classic_rock_world",
    anchorArtists: [
      /\bqueen\b/i,
      /\bac\/?dc\b/i,
      /\beagles\b/i,
      /\bfleetwood\s+mac\b/i,
      /\btom\s+petty\b/i,
      /\bled\s+zeppelin\b/i,
      /\bguns\s+n['']?\s*roses\b/i,
    ],
    anchorArtistNames: ["Queen", "AC/DC", "Eagles", "Fleetwood Mac", "Tom Petty", "Led Zeppelin", "Guns N' Roses"],
    adjacentArtists: ["Bruce Springsteen", "Def Leppard", "Foreigner", "Boston", "Kansas"],
    majorArtists: ["Aerosmith", "Van Halen", "ZZ Top", "Rush", "Deep Purple"],
    deepCuts: ["Thin Lizzy", "Bad Company", "Creedence Clearwater Revival", "The Who", "Cream"],
    forgottenArtists: ["Blue Öyster Cult", "Foghat", "Styx", "REO Speedwagon"],
    cultArtists: ["Mountain", "Grand Funk Railroad"],
    eraExtensions: ["Dire Straits", "Journey", "Boston", "Styx"],
    acceptableAdjacency: ["Tom Petty", "Dire Straits", "ELO", "Boston", "Journey", "Foreigner", "Def Leppard"],
    acceptableModernArtists: ["Foo Fighters", "Muse"],
    avoidArtists: ["Bon Iver", "Phoebe Bridgers", "Clairo", "Noah Kahan", "Storm Queen", "Fred again.."],
    anchorTracks: [/\bdon'?t\s+stop\s+me\s+now\b/i, /\bback\s+in\s+black\b/i, /\bhotel\s+california\b/i],
    legendaryTracks: [/\bdon'?t\s+stop\s+me\s+now\b/i, /\bback\s+in\s+black\b/i, /\bhotel\s+california\b/i, /\bwelcome\s+to\s+the\s+jungle\b/i],
    preferredEras: { min: 1968, max: 1995 },
    energyRange: { min: 0.45, max: 0.92 },
    instrumentation: ["electric guitar", "drums", "bass", "arena rock"],
    vocalStyle: ["rock vocal", "anthemic"],
    forbiddenArtists: [...LANDFILL],
    forbiddenPatterns: [],
    openerRules: { minWorldIdentityScore: 0.8, preferAnchorArtist: true, anchorBeatsAdjacent: true },
  },
  dad_rock_world: {
    worldId: "dad_rock_world",
    anchorArtists: [
      /\bqueen\b/i,
      /\bac\/?dc\b/i,
      /\beagles\b/i,
      /\bfleetwood\s+mac\b/i,
      /\btom\s+petty\b/i,
      /\bjourney\b/i,
    ],
    anchorArtistNames: ["Queen", "AC/DC", "Eagles", "Fleetwood Mac", "Tom Petty", "Journey"],
    adjacentArtists: ["Bruce Springsteen", "Def Leppard", "Foreigner", "Boston", "Kansas"],
    majorArtists: ["Aerosmith", "Van Halen", "ZZ Top", "Rush", "Deep Purple", "Foreigner", "Boston"],
    deepCuts: ["Thin Lizzy", "Bad Company", "Creedence Clearwater Revival", "The Who", "Cream", "Kansas"],
    forgottenArtists: ["Blue Öyster Cult", "Foghat", "Styx", "REO Speedwagon"],
    cultArtists: ["Mountain", "Grand Funk Railroad"],
    eraExtensions: ["Dire Straits", "Journey", "Boston", "Styx"],
    acceptableAdjacency: ["Tom Petty", "Dire Straits", "ELO", "Boston", "Journey", "Foreigner", "Def Leppard"],
    anchorTracks: [/\bdon'?t\s+stop\s+believin\b/i, /\bgo\s+your\s+own\s+way\b/i],
    preferredEras: { min: 1970, max: 1992 },
    energyRange: { min: 0.42, max: 0.88 },
    instrumentation: ["classic rock", "soft rock", "yacht rock"],
    vocalStyle: ["singalong", "heartland"],
    forbiddenArtists: [...LANDFILL],
    forbiddenPatterns: [],
    openerRules: { minWorldIdentityScore: 0.8, preferAnchorArtist: true, anchorBeatsAdjacent: true },
  },
  rainy_motorway_world: {
    worldId: "rainy_motorway_world",
    anchorArtists: [
      /\bm83\b/i,
      /\bchromatics\b/i,
      /\bwar\s+on\s+drugs\b/i,
      /\bdepeche\s+mode\b/i,
      /\bnew\s+order\b/i,
    ],
    anchorArtistNames: ["M83", "Chromatics", "The War on Drugs", "Depeche Mode", "New Order"],
    adjacentArtists: ["Röyksopp", "Tycho", "Com Truise", "Washed Out", "College"],
    majorArtists: ["The Cure", "Pet Shop Boys", "Tears for Fears", "Ultravox", "Gary Numan"],
    deepCuts: ["Cocteau Twins", "Slowdive", "My Bloody Valentine", "Boards of Canada", "Moby"],
    forgottenArtists: ["Clan of Xymox", "Minimal Compact", "Section 25"],
    cultArtists: ["John Foxx", "Visage", "Japan"],
    eraExtensions: ["Simple Minds", "Talk Talk", "OMD"],
    acceptableAdjacency: ["The Cure", "Pet Shop Boys", "Gary Numan", "Ultravox", "Cocteau Twins"],
    anchorTracks: [/\bmidnight\s+city\b/i, /\btick\s+of\s+the\s+clock\b/i, /\benjoy\s+the\s+silence\b/i],
    legendaryTracks: [/\bmidnight\s+city\b/i, /\btick\s+of\s+the\s+clock\b/i, /\benjoy\s+the\s+silence\b/i, /\bblue\s+monday\b/i],
    acceptableModernArtists: ["M83", "Chromatics", "The War on Drugs"],
    avoidArtists: [
      "Drake",
      "Travis Scott",
      "Wallows",
      "Jungle Giants",
      "Bon Iver",
      "Phoebe Bridgers",
      "BLK",
      "KURUPT FM",
      "Kurupt FM",
      "Destructo Disk",
      "Mungo's Hi Fi",
      "Oliver Heldens",
      "Steve Lacy",
      "Funk Tribu",
      "Florence",
      "Florence + The Machine",
      "Florence and the Machine",
      "MGMT",
      "Oasis",
      "Onyx Deimos",
      "Calvin Harris",
      "David Guetta",
      "Tiësto",
      "Tiesto",
      "Martin Garrix",
      "Avicii",
      "The Smiths",
      "The 1975",
    ],
    avoidGenres: ["uk garage", "grime", "phonk", "festival", "party anthem", "brostep", "dubstep"],
    avoidEnergyPatterns: [{ min: 0.85, reason: "party_festival_energy" }],
    avoidReasons: [
      "oasis_onyx_deimos_break_motorway_nocturne",
      "party_festival_artists_break_rainy_drive",
    ],
    preferredEras: { min: 1980, max: 2015 },
    energyRange: { min: 0.32, max: 0.78 },
    instrumentation: ["synth", "electronic", "cinematic", "shoegaze"],
    vocalStyle: ["atmospheric", "nocturnal"],
    forbiddenArtists: [
      ...LANDFILL,
      /\bwallows\b/i,
      /\bjungle\s+giants\b/i,
      /\bdrake\b/i,
      /\btravis\s+scott\b/i,
      /\bdestructo\s+disk\b/i,
      /\bmungo'?s\s+hi\s+fi\b/i,
      /\boliver\s+heldens\b/i,
      /\bsteve\s+lacy\b/i,
      /\bfunk\s+tribu\b/i,
      /\bflorence\b/i,
      /\bmgmt\b/i,
    ],
    forbiddenPatterns: [
      ...HIP_HOP_PARTY,
      ...ACOUSTIC_BREAKUP,
      ...PARTY_PHONKY_COMEDY,
      ...REMIX_EDIT_BAIT,
      /\blo-?fi\b/i,
      /\bchillhop\b/i,
      /\b(?:ukg|uk\s+garage|grime|dnb|drum\s+and\s+bass)\b/i,
      /\b(?:random\s+indie|indie\s+folk|bedroom\s+pop)\b/i,
    ],
    openerRules: {
      minWorldIdentityScore: 0.8,
      preferAnchorArtist: true,
      sequencing: "cinematic_to_reflective",
    },
  },
  rainy_drive_world: {
    worldId: "rainy_drive_world",
    anchorArtists: [
      /\bm83\b/i,
      /\bchromatics\b/i,
      /\bwar\s+on\s+drugs\b/i,
      /\bdepeche\s+mode\b/i,
    ],
    anchorTracks: [/\bmidnight\s+city\b/i, /\btick\s+of\s+the\s+clock\b/i],
    preferredEras: { min: 1980, max: 2015 },
    energyRange: { min: 0.3, max: 0.75 },
    instrumentation: ["synth", "electronic", "cinematic"],
    vocalStyle: ["atmospheric", "melancholic"],
    forbiddenArtists: [...LANDFILL, /\bwallows\b/i, /\bjungle\s+giants\b/i, /\bdrake\b/i, /\btravis\s+scott\b/i],
    forbiddenPatterns: [...HIP_HOP_PARTY, ...ACOUSTIC_BREAKUP, /\blo-?fi\b/i, /\b(?:ukg|uk\s+garage|grime|dnb|drum\s+and\s+bass)\b/i],
    openerRules: {
      minWorldIdentityScore: 0.8,
      preferAnchorArtist: true,
      sequencing: "cinematic_to_reflective",
    },
  },
  night_drive_world: {
    worldId: "night_drive_world",
    anchorArtists: [/\bm83\b/i, /\bchromatics\b/i, /\bwar\s+on\s+drugs\b/i, /\bdepeche\s+mode\b/i],
    anchorTracks: [/\bmidnight\s+city\b/i],
    preferredEras: { min: 1980, max: 2015 },
    energyRange: { min: 0.28, max: 0.72 },
    instrumentation: ["synth", "electronic", "dream pop"],
    vocalStyle: ["nocturnal", "cinematic"],
    forbiddenArtists: [...LANDFILL, /\bdrake\b/i, /\btravis\s+scott\b/i, /\bjungle\s+giants\b/i],
    forbiddenPatterns: [...HIP_HOP_PARTY],
    openerRules: {
      minWorldIdentityScore: 0.8,
      preferAnchorArtist: true,
      sequencing: "cinematic_to_reflective",
    },
  },
  "80s_night_drive_world": {
    worldId: "80s_night_drive_world",
    anchorArtists: [
      /\bthe\s+cure\b/i,
      /\bnew\s+order\b/i,
      /\bdepeche\s+mode\b/i,
      /\btears\s+for\s+fears\b/i,
      /\bsimple\s+minds\b/i,
      /\bpet\s+shop\s+boys\b/i,
      /\bm83\b/i,
      /\ba\s+flock\s+of\s+seagulls\b/i,
    ],
    anchorArtistNames: [
      "The Cure",
      "New Order",
      "Depeche Mode",
      "Tears for Fears",
      "Simple Minds",
      "Pet Shop Boys",
      "M83",
    ],
    adjacentArtists: ["Duran Duran", "Ultravox", "Gary Numan", "Chromatics", "A Flock of Seagulls"],
    majorArtists: ["OMD", "Ultravox", "Talk Talk", "Japan", "ABC", "Human League", "A-ha", "Roxy Music", "Peter Gabriel", "Prefab Sprout"],
    deepCuts: ["Heaven 17", "Visage", "John Foxx", "Yazoo", "Erasure", "Orchestral Manoeuvres in the Dark"],
    forgottenArtists: ["China Crisis", "Associates", "Teardrop Explodes", "Wire"],
    cultArtists: ["Japan", "Talk Talk", "Cocteau Twins"],
    eraExtensions: ["Duran Duran", "Gary Numan", "A Flock of Seagulls", "Simple Minds"],
    acceptableAdjacency: ["OMD", "Ultravox", "Talk Talk", "Japan", "ABC", "Human League", "A-ha", "Roxy Music"],
    avoidArtists: [
      "Florence",
      "Florence and the Machine",
      "Florence + The Machine",
      "The 1975",
      "Fleetwood Mac",
      "Bon Iver",
      "nimino",
      "Calvin Harris",
      "Fred again..",
      "Fred Again",
      "French Montana",
      "Gray Squat Rave",
    ],
    avoidGenres: ["trap", "hyperpop", "drill", "phonk", "uk drill", "cloud rap"],
    avoidEnergyPatterns: [{ min: 0.88, reason: "party_banger_energy" }],
    avoidReasons: [
      "modern_trap_hyperpop_breaks_80s_night_drive",
      "fred_again_french_montana_gray_squat_rave",
    ],
    anchorTracks: [/\benjoy\s+the\s+silence\b/i, /\bblue\s+monday\b/i, /\bjust\s+like\s+heaven\b/i],
    legendaryTracks: [
      /\benjoy\s+the\s+silence\b/i,
      /\bblue\s+monday\b/i,
      /\bjust\s+like\s+heaven\b/i,
      /\bfriday\s+i'?m\s+in\s+love\b/i,
      /\bmidnight\s+city\b/i,
    ],
    preferredEras: { min: 1978, max: 2012 },
    energyRange: { min: 0.35, max: 0.82 },
    instrumentation: ["synthpop", "new wave", "post-punk", "synth"],
    vocalStyle: ["synth vocal", "coldwave"],
    forbiddenArtists: [
      ...LANDFILL,
      /\bthe\s+1975\b/i,
      /\bfleetwood\s+mac\b/i,
      /\bnimino\b/i,
      /\bcalvin\s+harris\b/i,
    ],
    forbiddenPatterns: [...ACOUSTIC_BREAKUP, ...REMIX_EDIT_BAIT],
    openerRules: {
      minWorldIdentityScore: 0.8,
      preferAnchorArtist: true,
      anchorBeatsAdjacent: true,
      sequencing: "cinematic_to_reflective",
    },
  },
  madchester_world: {
    worldId: "madchester_world",
    anchorArtists: [
      /\bstone\s+roses\b/i,
      /\bhappy\s+mondays\b/i,
      /\bnew\s+order\b/i,
      /\boasis\b/i,
      /\binspiral\s+carpets\b/i,
    ],
    anchorArtistNames: ["The Stone Roses", "Happy Mondays", "New Order", "Oasis", "Inspiral Carpets"],
    adjacentArtists: ["The Charlatans", "James", "The Verve", "Primal Scream", "The La's"],
    majorArtists: ["Inspiral Carpets", "The Charlatans", "Primal Scream", "James", "Northside", "808 State", "Black Grape", "Electronic", "The Farm", "The Seahorses", "The La's"],
    deepCuts: ["Northside", "Black Grape", "The Farm", "The Seahorses", "Ride", "Shack"],
    forgottenArtists: ["Paris Angels", "The High", "Sub Sub", "The Mock Turtles"],
    cultArtists: ["808 State", "Electronic", "Northside"],
    eraExtensions: ["Primal Scream", "The Charlatans", "James", "Black Grape"],
    acceptableAdjacency: ["The Charlatans", "Primal Scream", "James", "Inspiral Carpets", "808 State", "Black Grape"],
    acceptableModernArtists: ["The Charlatans", "Primal Scream"],
    avoidArtists: ["Destructo Disk", "James Righton", "Bon Iver", "Phoebe Bridgers", "Arctic Monkeys", "Tame Impala", "James Hype", "Jesse James Solomon"],
    anchorTracks: [/\bfools\s+gold\b/i, /\bstep\s+on\b/i, /\bi\s+am\s+the\s+resurrection\b/i],
    legendaryTracks: [/\bfools\s+gold\b/i, /\bstep\s+on\b/i, /\bi\s+am\s+the\s+resurrection\b/i, /\bwonderwall\b/i],
    preferredEras: { min: 1985, max: 1998 },
    energyRange: { min: 0.42, max: 0.85 },
    instrumentation: ["baggy", "indie dance", "britpop"],
    vocalStyle: ["manchester", "northern"],
    forbiddenArtists: [...LANDFILL, /\bdestructo\s+disk\b/i, /\bjames\s+righton\b/i],
    forbiddenPatterns: [/\b(?:country|americana|acoustic\s+folk)\b/i],
    openerRules: { minWorldIdentityScore: 0.8, preferAnchorArtist: true, anchorBeatsAdjacent: true },
  },
  grunge_world: {
    worldId: "grunge_world",
    anchorArtists: [
      /\bnirvana\b/i,
      /\bpearl\s+jam\b/i,
      /\bsoundgarden\b/i,
      /\balice\s+in\s+chains\b/i,
    ],
    anchorArtistNames: ["Nirvana", "Pearl Jam", "Soundgarden", "Alice in Chains"],
    adjacentArtists: ["Stone Temple Pilots", "Mudhoney", "Screaming Trees", "Temple of the Dog"],
    majorArtists: ["Mudhoney", "Screaming Trees", "Temple of the Dog", "Hole", "Bush"],
    deepCuts: ["Tad", "Green River", "Mother Love Bone", "L7", "Silverchair"],
    forgottenArtists: ["Dinosaur Jr.", "Swervedriver", "Babes in Toyland"],
    cultArtists: ["Melvins", "Skin Yard", "Gruntruck"],
    eraExtensions: ["Stone Temple Pilots", "Bush", "Silverchair"],
    acceptableAdjacency: ["Stone Temple Pilots", "Mudhoney", "Screaming Trees", "Temple of the Dog"],
    avoidArtists: ["Green Day", "Blink-182", "Fall Out Boy", "Bon Iver"],
    anchorTracks: [/\bsmells\s+like\s+teen\s+spirit\b/i, /\balive\b/i],
    preferredEras: { min: 1988, max: 1998 },
    energyRange: { min: 0.55, max: 0.92 },
    instrumentation: ["grunge", "alternative rock", "seattle"],
    vocalStyle: ["raw", "distorted"],
    forbiddenArtists: [...LANDFILL, /\bgreen\s+day\b/i, /\bblink[-\s]?182\b/i, /\bfall\s+out\s+boy\b/i],
    forbiddenPatterns: [/\b(?:pop\s*punk|emo|easycore)\b/i],
    openerRules: { minWorldIdentityScore: 0.8, preferAnchorArtist: true },
  },
  gym_rock_world: {
    worldId: "gym_rock_world",
    anchorArtists: [
      /\bmetallica\b/i,
      /\bac\/?dc\b/i,
      /\bguns\s+n['']?\s*roses\b/i,
      /\bfoo\s+fighters\b/i,
      /\bblack\s+sabbath\b/i,
      /\biron\s+maiden\b/i,
    ],
    anchorArtistNames: ["Metallica", "AC/DC", "Guns N' Roses", "Foo Fighters", "Rage Against the Machine"],
    adjacentArtists: ["Slipknot", "Disturbed", "Godsmack", "Papa Roach", "Linkin Park", "Black Sabbath", "Iron Maiden", "Slayer"],
    majorArtists: ["Slayer", "Megadeth", "Pantera", "Tool", "Korn", "System of a Down"],
    deepCuts: ["Anthrax", "Testament", "Machine Head", "Lamb of God", "Gojira"],
    forgottenArtists: ["Prong", "Biohazard", "Helmet", "Corrosion of Conformity"],
    cultArtists: ["Ministry", "White Zombie", "Fear Factory"],
    eraExtensions: ["Pantera", "Tool", "Rage Against the Machine", "System of a Down"],
    acceptableAdjacency: ["Slipknot", "Disturbed", "Godsmack", "Papa Roach", "Linkin Park", "Pantera"],
    acceptableModernArtists: ["Disturbed", "Godsmack", "Papa Roach"],
    avoidArtists: [
      "Fall Out Boy",
      "Paramore",
      "Bon Iver",
      "Phoebe Bridgers",
      "Green Day",
      "Panic! At The Disco",
      "Panic at the Disco",
      "Sonic Youth",
      "The Clash",
      "The Offspring",
    ],
    anchorTracks: [/\benter\s+sandman\b/i, /\bback\s+in\s+black\b/i, /\bwelcome\s+to\s+the\s+jungle\b/i],
    legendaryTracks: [/\benter\s+sandman\b/i, /\bback\s+in\s+black\b/i, /\bwelcome\s+to\s+the\s+jungle\b/i],
    preferredEras: { min: 1975, max: 2015 },
    energyRange: { min: 0.72, max: 0.98 },
    instrumentation: ["hard rock", "metal", "punk rock"],
    vocalStyle: ["aggressive", "stadium"],
    forbiddenArtists: [
      ...LANDFILL,
      /\bfall\s+out\s+boy\b/i,
      /\bparamore\b/i,
      /\bgreen\s+day\b/i,
      /\bpanic!\s+at\s+the\s+disco\b/i,
      /\bpanic\s+at\s+the\s+disco\b/i,
      /\bsonic\s+youth\b/i,
      /\bthe\s+clash\b/i,
    ],
    forbiddenPatterns: [...ACOUSTIC_BREAKUP, /\b(?:acoustic|folk|singer[-\s]?songwriter)\b/i],
    openerRules: {
      minWorldIdentityScore: 0.8,
      preferAnchorArtist: true,
      anchorBeatsAdjacent: true,
      sequencing: "high_energy_cooldown",
    },
  },
  gym_world: {
    worldId: "gym_world",
    anchorArtists: [/\bmetallica\b/i, /\bac\/?dc\b/i, /\bguns\s+n['']?\s*roses\b/i, /\bslayer\b/i],
    anchorArtistNames: ["Metallica", "AC/DC", "Guns N' Roses", "Slayer", "Rage Against the Machine"],
    adjacentArtists: ["Disturbed", "Godsmack", "Papa Roach", "Linkin Park", "Foo Fighters"],
    acceptableModernArtists: ["Disturbed", "Godsmack"],
    avoidArtists: [
      "Fall Out Boy",
      "Paramore",
      "Bon Iver",
      "Phoebe Bridgers",
      "Green Day",
      "Panic! At The Disco",
      "Panic at the Disco",
      "Sonic Youth",
      "The Clash",
    ],
    anchorTracks: [/\benter\s+sandman\b/i, /\bback\s+in\s+black\b/i, /\braining\s+blood\b/i],
    legendaryTracks: [/\benter\s+sandman\b/i, /\bback\s+in\s+black\b/i, /\braining\s+blood\b/i],
    preferredEras: { min: 1975, max: 2015 },
    energyRange: { min: 0.75, max: 0.99 },
    instrumentation: ["hard rock", "metal", "thrash metal"],
    vocalStyle: ["aggressive", "stadium"],
    forbiddenArtists: [
      ...LANDFILL,
      /\bfall\s+out\s+boy\b/i,
      /\bparamore\b/i,
      /\bgreen\s+day\b/i,
      /\bpanic!\s+at\s+the\s+disco\b/i,
      /\bpanic\s+at\s+the\s+disco\b/i,
      /\bsonic\s+youth\b/i,
      /\bthe\s+clash\b/i,
    ],
    forbiddenPatterns: [...ACOUSTIC_BREAKUP, /\b(?:acoustic|folk|singer[-\s]?songwriter|ballad)\b/i],
    openerRules: {
      minWorldIdentityScore: 0.8,
      preferAnchorArtist: true,
      anchorBeatsAdjacent: true,
      sequencing: "high_energy_cooldown",
    },
  },
  heavy_gym_world: {
    worldId: "heavy_gym_world",
    anchorArtists: [
      /\bmetallica\b/i,
      /\bslayer\b/i,
      /\bmegadeth\b/i,
      /\bac\/?dc\b/i,
      /\bfoo\s+fighters\b/i,
    ],
    anchorArtistNames: ["Metallica", "Slayer", "Megadeth", "AC/DC", "Foo Fighters"],
    adjacentArtists: ["Slipknot", "Disturbed", "Godsmack", "Papa Roach", "Linkin Park", "Black Sabbath", "Iron Maiden", "Slayer"],
    avoidArtists: ["Green Day", "Panic! At The Disco", "Panic at the Disco", "Fall Out Boy", "Paramore"],
    anchorTracks: [/\benter\s+sandman\b/i, /\braining\s+blood\b/i, /\bback\s+in\s+black\b/i],
    legendaryTracks: [/\benter\s+sandman\b/i, /\braining\s+blood\b/i, /\bback\s+in\s+black\b/i],
    preferredEras: { min: 1980, max: 2015 },
    energyRange: { min: 0.78, max: 0.99 },
    instrumentation: ["thrash metal", "heavy metal", "hard rock"],
    vocalStyle: ["aggressive", "screaming"],
    forbiddenArtists: [
      ...LANDFILL,
      /\bfall\s+out\s+boy\b/i,
      /\bgreen\s+day\b/i,
      /\bpanic!\s+at\s+the\s+disco\b/i,
      /\bpanic\s+at\s+the\s+disco\b/i,
      /\bparamore\b/i,
    ],
    forbiddenPatterns: [...ACOUSTIC_BREAKUP],
    openerRules: {
      minWorldIdentityScore: 0.8,
      preferAnchorArtist: true,
      sequencing: "high_energy_cooldown",
    },
  },
  angry_rock_world: {
    worldId: "angry_rock_world",
    anchorArtists: [/\bmetallica\b/i, /\bslayer\b/i, /\bmegadeth\b/i, /\bac\/?dc\b/i],
    anchorTracks: [/\benter\s+sandman\b/i],
    preferredEras: { min: 1980, max: 2015 },
    energyRange: { min: 0.75, max: 0.99 },
    instrumentation: ["metal", "hardcore", "punk"],
    vocalStyle: ["aggressive"],
    forbiddenArtists: [...LANDFILL, /\bfall\s+out\s+boy\b/i],
    forbiddenPatterns: [...ACOUSTIC_BREAKUP],
    openerRules: {
      minWorldIdentityScore: 0.8,
      preferAnchorArtist: true,
      sequencing: "high_energy_cooldown",
    },
  },
  disco_1970s_world: {
    worldId: "disco_1970s_world",
    anchorArtists: [
      /\bmichael\s+jackson\b/i,
      /\bbe\s+gees\b/i,
      /\bchic\b/i,
      /\bdonna\s+summer\b/i,
      /\bearth[\s,]*wind\s*(?:&|and)\s*fire\b/i,
      /\bsister\s+sledge\b/i,
      /\bkc\s+(?:and\s+the\s+)?sunshine\s+band\b/i,
      /\bgloria\s+gaynor\b/i,
    ],
    anchorArtistNames: [
      "Michael Jackson",
      "Bee Gees",
      "Chic",
      "Donna Summer",
      "Earth, Wind & Fire",
      "Sister Sledge",
      "KC and the Sunshine Band",
      "Gloria Gaynor",
    ],
    adjacentArtists: ["Village People", "Kool & the Gang", "Diana Ross", "The Trammps", "Sylvester"],
    majorArtists: ["Barry White", "Cameo", "Parliament", "Funkadelic", "Heatwave", "Lipps Inc"],
    deepCuts: ["Cerrone", "Linda Clifford", "Odyssey", "Tavares", "Crown Heights Affair"],
    forgottenArtists: ["A Taste of Honey", "Musique", "Instant Funk"],
    cultArtists: ["Cerrone", "Crown Heights Affair", "Musique"],
    eraExtensions: ["Kool & the Gang", "Barry White", "Cameo", "Heatwave"],
    acceptableAdjacency: ["Barry White", "Cameo", "Parliament", "Funkadelic", "Kool & the Gang", "Heatwave", "Sylvester"],
    acceptableModernArtists: [],
    avoidArtists: [
      "Panic! At The Disco",
      "Panic at the Disco",
      "Dua Lipa",
      "The Weeknd",
      "Bon Iver",
      "Phoebe Bridgers",
      "Fred again..",
      "Fred again",
      "Calvin Harris",
      "Storm Queen",
    ],
    anchorTracks: [/\bstayin'?alive\b/i, /\ble\s+freak\b/i, /\bi\s+will\s+survive\b/i, /\bdon'?t\s+stop\s+'?til\s+you\s+get\s+enough\b/i],
    legendaryTracks: [/\bstayin'?alive\b/i, /\ble\s+freak\b/i, /\bi\s+will\s+survive\b/i, /\bwe\s+are\s+family\b/i],
    preferredEras: { min: 1974, max: 1982 },
    energyRange: { min: 0.42, max: 0.88 },
    instrumentation: ["disco", "funk", "four-on-the-floor"],
    vocalStyle: ["dance", "soul"],
    forbiddenArtists: [
      ...LANDFILL,
      /\bpanic!\s+at\s+the\s+disco\b/i,
      /\bpanic\s+at\s+the\s+disco\b/i,
      /\bdua\s+lipa\b/i,
      /\bthe\s+weeknd\b/i,
    ],
    forbiddenPatterns: [/\b(?:metal|grunge|acoustic\s+folk|indie\s+disco|nu[\s-]?disco)\b/i],
    openerRules: { minWorldIdentityScore: 0.8, preferAnchorArtist: true, anchorBeatsAdjacent: true },
  },
  country_world: {
    worldId: "country_world",
    anchorArtists: [
      /\bjohnny\s+cash\b/i,
      /\bdolly\s+parton\b/i,
      /\bwillie\s+nelson\b/i,
      /\bluke\s+combs\b/i,
      /\bchris\s+stapleton\b/i,
      /\bzach\s+bryan\b/i,
      /\balan\s+jackson\b/i,
    ],
    anchorArtistNames: [
      "Johnny Cash",
      "Dolly Parton",
      "Willie Nelson",
      "Luke Combs",
      "Chris Stapleton",
      "Zach Bryan",
      "Alan Jackson",
    ],
    adjacentArtists: ["George Strait", "Merle Haggard", "Tim McGraw", "Carrie Underwood", "Morgan Wallen"],
    majorArtists: ["George Strait", "Merle Haggard", "Tim McGraw", "Carrie Underwood", "Morgan Wallen", "Brad Paisley"],
    deepCuts: ["Sturgill Simpson", "Jason Isbell", "Tyler Childers", "Colter Wall", "Margo Price"],
    forgottenArtists: ["Jamey Johnson", "Cody Jinks", "Whitey Morgan"],
    cultArtists: ["Sturgill Simpson", "Jason Isbell", "Tyler Childers"],
    eraExtensions: ["Brad Paisley", "Keith Urban", "Eric Church"],
    acceptableAdjacency: ["George Strait", "Merle Haggard", "Tim McGraw", "Brad Paisley", "Eric Church"],
    avoidArtists: [
      "Arctic Monkeys",
      "The Jungle Giants",
      "Frank Ocean",
      "Bon Iver",
      "Michael Kiwanuka",
      "Phoebe Bridgers",
      "Florence",
      "Florence + The Machine",
      "Florence and the Machine",
      "Phoebe Bridgers",
      "Iron & Wine",
      "Fleet Foxes",
    ],
    avoidGenres: ["indie folk", "indie rock", "bedroom pop", "art pop", "alternative r&b"],
    avoidReasons: [
      "florence_indie_folk_break_country_world",
      "arctic_monkeys_break_country_purity",
    ],
    anchorTracks: [/\bring\s+of\s+fire\b/i, /\bjolene\b/i, /\bon\s+the\s+road\s+again\b/i],
    legendaryTracks: [/\bring\s+of\s+fire\b/i, /\bjolene\b/i, /\bon\s+the\s+road\s+again\b/i, /\bcountry\s+roads\b/i],
    preferredEras: { min: 1965, max: 2025 },
    energyRange: { min: 0.35, max: 0.88 },
    instrumentation: ["country", "americana", "red dirt", "outlaw country"],
    vocalStyle: ["country", "heartland", "storytelling"],
    forbiddenArtists: [
      ...LANDFILL,
      /\barctic\s+monkeys\b/i,
      /\bjungle\s+giants\b/i,
      /\bfrank\s+ocean\b/i,
      /\bmichael\s+kiwanuka\b/i,
    ],
    forbiddenPatterns: [
      /\b(?:indie\s+folk|indie\s+rock|bedroom\s+pop|r&b|hip[\s-]?hop|rap\b|trap\b)\b/i,
      /\b(?:acoustic\s+r&b|singer[-\s]?songwriter\s+pop)\b/i,
    ],
    openerRules: {
      minWorldIdentityScore: 0.8,
      preferAnchorArtist: true,
      anchorBeatsAdjacent: true,
    },
  },
  disco_world: {
    worldId: "disco_world",
    anchorArtists: [
      /\bmichael\s+jackson\b/i,
      /\bbe\s+gees\b/i,
      /\bchic\b/i,
      /\bdonna\s+summer\b/i,
      /\bearth[\s,]*wind\s*(?:&|and)\s*fire\b/i,
      /\bsister\s+sledge\b/i,
      /\bkc\s+(?:and\s+the\s+)?sunshine\s+band\b/i,
    ],
    anchorArtistNames: [
      "Michael Jackson",
      "Bee Gees",
      "Chic",
      "Donna Summer",
      "Earth, Wind & Fire",
      "Sister Sledge",
      "KC and the Sunshine Band",
    ],
    adjacentArtists: ["Village People", "Gloria Gaynor", "Kool & the Gang", "Diana Ross"],
    majorArtists: ["Barry White", "Cameo", "Parliament", "Funkadelic", "Heatwave", "Gloria Gaynor"],
    deepCuts: ["Cerrone", "Linda Clifford", "Odyssey", "Tavares"],
    forgottenArtists: ["A Taste of Honey", "Musique", "Instant Funk"],
    cultArtists: ["Cerrone", "Crown Heights Affair"],
    eraExtensions: ["Barry White", "Cameo", "Heatwave"],
    acceptableAdjacency: ["Barry White", "Cameo", "Parliament", "Funkadelic", "Kool & the Gang", "Heatwave"],
    avoidArtists: ["Panic! At The Disco", "Panic at the Disco", "Dua Lipa", "The Weeknd"],
    anchorTracks: [/\bstayin'?alive\b/i, /\ble\s+freak\b/i, /\bdon'?t\s+stop\s+'?til\s+you\s+get\s+enough\b/i],
    legendaryTracks: [/\bstayin'?alive\b/i, /\ble\s+freak\b/i, /\bwe\s+are\s+family\b/i],
    preferredEras: { min: 1974, max: 1982 },
    energyRange: { min: 0.42, max: 0.88 },
    instrumentation: ["disco", "funk", "four-on-the-floor"],
    vocalStyle: ["dance", "soul"],
    forbiddenArtists: [
      ...LANDFILL,
      /\bpanic!\s+at\s+the\s+disco\b/i,
      /\bpanic\s+at\s+the\s+disco\b/i,
      /\bdua\s+lipa\b/i,
      /\bthe\s+weeknd\b/i,
    ],
    forbiddenPatterns: [/\b(?:metal|grunge|acoustic\s+folk|indie\s+disco|nu[\s-]?disco)\b/i],
    openerRules: { minWorldIdentityScore: 0.8, preferAnchorArtist: true, anchorBeatsAdjacent: true },
  },
};

/** Resolve the cultural profile for a committed world id. */
export function getCulturalProfile(worldId: string): CulturalWorldProfile | null {
  const resolvedId = CULTURAL_PROFILE_ALIASES[worldId] ?? worldId;
  return CULTURAL_PROFILES[resolvedId] ?? CULTURAL_PROFILES[worldId] ?? null;
}

/** Merge profiles when multiple world ids are active — union anchors/forbiddens, primary opener rules. */
export function mergeCulturalProfiles(worldIds: string[]): CulturalWorldProfile | null {
  const profiles = worldIds
    .map((id) => getCulturalProfile(id))
    .filter((p): p is CulturalWorldProfile => p != null);
  if (profiles.length === 0) return null;
  const primary = profiles[0]!;
  const anchorArtists: RegExp[] = [];
  const anchorTracks: RegExp[] = [];
  const forbiddenArtists: RegExp[] = [];
  const forbiddenPatterns: RegExp[] = [];
  const anchorArtistNames: string[] = [];
  const adjacentArtists: string[] = [];
  const majorArtists: string[] = [];
  const deepCuts: string[] = [];
  const forgottenArtists: string[] = [];
  const cultArtists: string[] = [];
  const eraExtensions: string[] = [];
  const acceptableAdjacency: string[] = [];
  const avoidArtists: string[] = [];
  const avoidGenres: string[] = [];
  const avoidEnergyPatterns: CulturalWorldProfile["avoidEnergyPatterns"] = [];
  const avoidReasons: string[] = [];
  for (const p of profiles) {
    anchorArtists.push(...p.anchorArtists);
    anchorTracks.push(...p.anchorTracks);
    forbiddenArtists.push(...p.forbiddenArtists);
    forbiddenPatterns.push(...p.forbiddenPatterns);
    if (p.anchorArtistNames) anchorArtistNames.push(...p.anchorArtistNames);
    if (p.adjacentArtists) adjacentArtists.push(...p.adjacentArtists);
    if (p.majorArtists) majorArtists.push(...p.majorArtists);
    if (p.deepCuts) deepCuts.push(...p.deepCuts);
    if (p.forgottenArtists) forgottenArtists.push(...p.forgottenArtists);
    if (p.cultArtists) cultArtists.push(...p.cultArtists);
    if (p.eraExtensions) eraExtensions.push(...p.eraExtensions);
    if (p.acceptableAdjacency) acceptableAdjacency.push(...p.acceptableAdjacency);
    if (p.avoidArtists) avoidArtists.push(...p.avoidArtists);
    if (p.avoidGenres) avoidGenres.push(...p.avoidGenres);
    if (p.avoidEnergyPatterns) avoidEnergyPatterns.push(...p.avoidEnergyPatterns);
    if (p.avoidReasons) avoidReasons.push(...p.avoidReasons);
  }
  return {
    ...primary,
    anchorArtists,
    anchorArtistNames: [...new Set(anchorArtistNames)],
    adjacentArtists: [...new Set(adjacentArtists)],
    majorArtists: [...new Set(majorArtists)],
    deepCuts: [...new Set(deepCuts)],
    forgottenArtists: [...new Set(forgottenArtists)],
    cultArtists: [...new Set(cultArtists)],
    eraExtensions: [...new Set(eraExtensions)],
    acceptableAdjacency: [...new Set(acceptableAdjacency)],
    avoidArtists: [...new Set(avoidArtists)],
    avoidGenres: [...new Set(avoidGenres)],
    avoidEnergyPatterns,
    avoidReasons: [...new Set(avoidReasons)],
    anchorTracks,
    forbiddenArtists,
    forbiddenPatterns,
  };
}

export function culturalProfileForCommittedWorld(worldIds: string[], primaryId: string): CulturalWorldProfile | null {
  const merged = mergeCulturalProfiles(worldIds.length > 0 ? worldIds : [primaryId]);
  if (merged) return merged;
  return getCulturalProfile(primaryId);
}
