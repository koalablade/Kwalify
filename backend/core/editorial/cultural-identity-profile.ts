/**
 * Cultural world profiles — anchor artists + forbidden lists, not Spotify genres alone.
 * Wired from CommittedWorld via getCulturalProfile(worldId).
 */

export type CulturalWorldProfile = {
  worldId: string;
  anchorArtists: RegExp[];
  anchorTracks: RegExp[];
  preferredEras: { min?: number; max?: number };
  energyRange: { min?: number; max?: number };
  instrumentation: string[];
  vocalStyle: string[];
  forbiddenArtists: RegExp[];
  forbiddenPatterns: RegExp[];
  openerRules: {
    minWorldIdentityScore: number;
    preferAnchorArtist: boolean;
    sequencing?: "cinematic_to_reflective" | "high_energy_cooldown";
  };
};

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
    anchorTracks: [/\bdon'?t\s+stop\s+me\s+now\b/i, /\bback\s+in\s+black\b/i, /\bhotel\s+california\b/i],
    preferredEras: { min: 1968, max: 1995 },
    energyRange: { min: 0.45, max: 0.92 },
    instrumentation: ["electric guitar", "drums", "bass", "arena rock"],
    vocalStyle: ["rock vocal", "anthemic"],
    forbiddenArtists: [...LANDFILL],
    forbiddenPatterns: [],
    openerRules: { minWorldIdentityScore: 0.8, preferAnchorArtist: true },
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
    anchorTracks: [/\bdon'?t\s+stop\s+believin\b/i, /\bgo\s+your\s+own\s+way\b/i],
    preferredEras: { min: 1970, max: 1992 },
    energyRange: { min: 0.42, max: 0.88 },
    instrumentation: ["classic rock", "soft rock", "yacht rock"],
    vocalStyle: ["singalong", "heartland"],
    forbiddenArtists: [...LANDFILL],
    forbiddenPatterns: [],
    openerRules: { minWorldIdentityScore: 0.8, preferAnchorArtist: true },
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
    anchorTracks: [/\bmidnight\s+city\b/i, /\btick\s+of\s+the\s+clock\b/i, /\benjoy\s+the\s+silence\b/i],
    preferredEras: { min: 1980, max: 2015 },
    energyRange: { min: 0.32, max: 0.78 },
    instrumentation: ["synth", "electronic", "cinematic", "shoegaze"],
    vocalStyle: ["atmospheric", "nocturnal"],
    forbiddenArtists: [...LANDFILL, /\bwallows\b/i, /\bjungle\s+giants\b/i, /\bdrake\b/i, /\btravis\s+scott\b/i],
    forbiddenPatterns: [...HIP_HOP_PARTY, ...ACOUSTIC_BREAKUP, /\blo-?fi\b/i, /\bchillhop\b/i, /\b(?:ukg|uk\s+garage|grime|dnb|drum\s+and\s+bass)\b/i],
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
      /\bdepeche\s+mode\b/i,
      /\bnew\s+order\b/i,
      /\bpet\s+shop\s+boys\b/i,
      /\ba\s+flock\s+of\s+seagulls\b/i,
      /\bthe\s+cure\b/i,
    ],
    anchorTracks: [/\benjoy\s+the\s+silence\b/i, /\bblue\s+monday\b/i],
    preferredEras: { min: 1978, max: 1992 },
    energyRange: { min: 0.35, max: 0.82 },
    instrumentation: ["synthpop", "new wave", "post-punk"],
    vocalStyle: ["synth vocal", "coldwave"],
    forbiddenArtists: [...LANDFILL, /\bthe\s+1975\b/i, /\bfleetwood\s+mac\b/i],
    forbiddenPatterns: [...ACOUSTIC_BREAKUP],
    openerRules: {
      minWorldIdentityScore: 0.8,
      preferAnchorArtist: true,
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
    anchorTracks: [/\bfools\s+gold\b/i, /\bstep\s+on\b/i, /\bi\s+am\s+the\s+resurrection\b/i],
    preferredEras: { min: 1985, max: 1998 },
    energyRange: { min: 0.42, max: 0.85 },
    instrumentation: ["baggy", "indie dance", "britpop"],
    vocalStyle: ["manchester", "northern"],
    forbiddenArtists: [...LANDFILL, /\bdestructo\s+disk\b/i],
    forbiddenPatterns: [/\b(?:country|americana|acoustic\s+folk)\b/i],
    openerRules: { minWorldIdentityScore: 0.8, preferAnchorArtist: true },
  },
  grunge_world: {
    worldId: "grunge_world",
    anchorArtists: [
      /\bnirvana\b/i,
      /\bpearl\s+jam\b/i,
      /\bsoundgarden\b/i,
      /\balice\s+in\s+chains\b/i,
    ],
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
      /\bfoo\s+fighters\b/i,
    ],
    anchorTracks: [/\benter\s+sandman\b/i, /\bback\s+in\s+black\b/i, /\bwelcome\s+to\s+the\s+jungle\b/i],
    preferredEras: { min: 1975, max: 2015 },
    energyRange: { min: 0.72, max: 0.98 },
    instrumentation: ["hard rock", "metal", "punk rock"],
    vocalStyle: ["aggressive", "stadium"],
    forbiddenArtists: [...LANDFILL, /\bfall\s+out\s+boy\b/i, /\bparamore\b/i],
    forbiddenPatterns: [...ACOUSTIC_BREAKUP, /\b(?:acoustic|folk|singer[-\s]?songwriter)\b/i],
    openerRules: {
      minWorldIdentityScore: 0.8,
      preferAnchorArtist: true,
      sequencing: "high_energy_cooldown",
    },
  },
  heavy_gym_world: {
    worldId: "heavy_gym_world",
    anchorArtists: [/\bmetallica\b/i, /\bslayer\b/i, /\bmegadeth\b/i, /\bac\/?dc\b/i],
    anchorTracks: [/\benter\s+sandman\b/i, /\braining\s+blood\b/i],
    preferredEras: { min: 1980, max: 2015 },
    energyRange: { min: 0.78, max: 0.99 },
    instrumentation: ["thrash metal", "heavy metal", "hard rock"],
    vocalStyle: ["aggressive", "screaming"],
    forbiddenArtists: [...LANDFILL, /\bfall\s+out\s+boy\b/i],
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
      /\bbe\s+bee\b/i,
      /\bbe\s+gees\b/i,
      /\bchic\b/i,
      /\bdonna\s+summer\b/i,
      /\bgloria\s+gaynor\b/i,
    ],
    anchorTracks: [/\bstayin'?alive\b/i, /\ble\s+freak\b/i, /\bi\s+will\s+survive\b/i],
    preferredEras: { min: 1974, max: 1982 },
    energyRange: { min: 0.42, max: 0.88 },
    instrumentation: ["disco", "funk", "four-on-the-floor"],
    vocalStyle: ["dance", "soul"],
    forbiddenArtists: [...LANDFILL, /\bpanic!\s+at\s+the\s+disco\b/i, /\bpanic\s+at\s+the\s+disco\b/i],
    forbiddenPatterns: [/\b(?:metal|grunge|acoustic\s+folk)\b/i],
    openerRules: { minWorldIdentityScore: 0.8, preferAnchorArtist: true },
  },
};

/** Resolve the cultural profile for a committed world id. */
export function getCulturalProfile(worldId: string): CulturalWorldProfile | null {
  return CULTURAL_PROFILES[worldId] ?? null;
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
  for (const p of profiles) {
    anchorArtists.push(...p.anchorArtists);
    anchorTracks.push(...p.anchorTracks);
    forbiddenArtists.push(...p.forbiddenArtists);
    forbiddenPatterns.push(...p.forbiddenPatterns);
  }
  return {
    ...primary,
    anchorArtists,
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
