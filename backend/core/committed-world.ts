/**
 * Single authoritative committed musical world after prompt interpretation.
 * Explicit genre/scene beats vague mood. Downstream stages must obey this.
 */

import type { SceneLockStatus } from "./scene-lock-mode";
import { resolveWorldBoundary, type WorldBoundary } from "./world-boundary";
import { inferWorldIdentityIdsFromPrompt } from "./editorial/world-identity-gate";
import { isAtmosphericWorld } from "./editorial/atmospheric-context-scoring";
import {
  culturalProfileForCommittedWorld,
  type CulturalWorldProfile,
} from "./editorial/cultural-identity-profile";

export { getCulturalProfile, type CulturalWorldProfile } from "./editorial/cultural-identity-profile";

export type CommittedWorldSource =
  | "explicit_genre"
  | "scene_lock"
  | "inferred"
  | "vague";

export type CommittedWorldArtistContract = {
  requiredArtists: RegExp[];
  forbiddenArtists: RegExp[];
  forbiddenPatterns: RegExp[];
};

export type WorldActivityContext =
  | "gym"
  | "workout"
  | "drive"
  | "study"
  | "party"
  | "running"
  | "cooking";

export type CommittedWorld = {
  id: string;
  hardLock: boolean;
  confidence: number;
  source: CommittedWorldSource;
  reason: string;
  worldIds: string[];
  boundary: WorldBoundary;
  /** Primary musical world id when activity co-exists (V22: same as `id` when musical-led). */
  musicalWorldId?: string | null;
  /** Secondary activity-derived world, never substitutes for musical `id`. */
  activityWorldId?: string | null;
  /** Activity/context slot for moment scoring — not a musical world substitute. */
  activityContext?: WorldActivityContext | null;
  /** Artists that strongly represent this world — opener sequencing prefers these. */
  requiredArtists: RegExp[];
  /** Artists never admissible when this world is hard-locked. */
  forbiddenArtists: RegExp[];
  /** Title/artist regex patterns blocked in this world. */
  forbiddenPatterns: RegExp[];
};

const LANDFILL_ARTIST_PATTERNS: RegExp[] = [
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

const HIP_HOP_PARTY_PATTERNS: RegExp[] = [
  /\b(?:hip[\s-]?hop|rap|trap|drill|grime|party\s+anthem|club\s+banger)\b/i,
];

const ACOUSTIC_BREAKUP_PATTERNS: RegExp[] = [
  /\b(?:acoustic\s+version|unplugged|heartbreak|breakup|skinny\s+love|pink\s+moon)\b/i,
  /\b(?:nick\s+drake|iron\s+(?:&|and)\s+wine|damien\s+rice)\b/i,
];

const WORLD_ARTIST_CONTRACTS: Record<string, CommittedWorldArtistContract> = {
  classic_rock_world: {
    requiredArtists: [
      /\bqueen\b/i,
      /\bac\/?dc\b/i,
      /\beagles\b/i,
      /\bfleetwood\s+mac\b/i,
      /\btom\s+petty\b/i,
      /\bled\s+zeppelin\b/i,
      /\bguns\s+n['']?\s*roses\b/i,
    ],
    forbiddenArtists: [...LANDFILL_ARTIST_PATTERNS],
    forbiddenPatterns: [],
  },
  dad_rock_world: {
    requiredArtists: [
      /\bqueen\b/i,
      /\bac\/?dc\b/i,
      /\beagles\b/i,
      /\bfleetwood\s+mac\b/i,
      /\btom\s+petty\b/i,
    ],
    forbiddenArtists: [...LANDFILL_ARTIST_PATTERNS],
    forbiddenPatterns: [],
  },
  dad_secret_world: {
    requiredArtists: [
      /\bqueen\b/i,
      /\bac\/?dc\b/i,
      /\beagles\b/i,
      /\bfleetwood\s+mac\b/i,
      /\btom\s+petty\b/i,
    ],
    forbiddenArtists: [...LANDFILL_ARTIST_PATTERNS],
    forbiddenPatterns: [],
  },
  yacht_rock_world: {
    requiredArtists: [
      /\bfleetwood\s+mac\b/i,
      /\btom\s+petty\b/i,
      /\beagles\b/i,
      /\bhall\s+(?:&|and)\s+oates\b/i,
    ],
    forbiddenArtists: [...LANDFILL_ARTIST_PATTERNS],
    forbiddenPatterns: [],
  },
  arena_rock_world: {
    requiredArtists: [
      /\bqueen\b/i,
      /\bac\/?dc\b/i,
      /\bguns\s+n['']?\s*roses\b/i,
      /\bled\s+zeppelin\b/i,
    ],
    forbiddenArtists: [...LANDFILL_ARTIST_PATTERNS],
    forbiddenPatterns: [],
  },
  rainy_motorway_world: {
    requiredArtists: [
      /\bm83\b/i,
      /\bchromatics\b/i,
      /\bwar\s+on\s+drugs\b/i,
      /\bdepeche\s+mode\b/i,
      /\bnew\s+order\b/i,
    ],
    forbiddenArtists: [
      ...LANDFILL_ARTIST_PATTERNS,
      /\bdestructo\s+disk\b/i,
      /\bmungo'?s\s+hi\s+fi\b/i,
    ],
    forbiddenPatterns: [
      ...HIP_HOP_PARTY_PATTERNS,
      ...ACOUSTIC_BREAKUP_PATTERNS,
      /\blo-?fi\b/i,
      /\bchillhop\b/i,
      /\bwallows\b/i,
      /\b(?:phonk|comedy|party\s+anthem|jump\s+up|brostep)\b/i,
      /\b(?:remix|rework|re-?edit|extended\s+mix|club\s+mix|radio\s+edit)\b/i,
    ],
  },
  rainy_drive_world: {
    requiredArtists: [
      /\bm83\b/i,
      /\bchromatics\b/i,
      /\bwar\s+on\s+drugs\b/i,
      /\bdepeche\s+mode\b/i,
    ],
    forbiddenArtists: [...LANDFILL_ARTIST_PATTERNS],
    forbiddenPatterns: [...HIP_HOP_PARTY_PATTERNS, ...ACOUSTIC_BREAKUP_PATTERNS, /\blo-?fi\b/i, /\bchillhop\b/i, /\bwallows\b/i],
  },
  night_drive_world: {
    requiredArtists: [
      /\bm83\b/i,
      /\bchromatics\b/i,
      /\bwar\s+on\s+drugs\b/i,
      /\bdepeche\s+mode\b/i,
    ],
    forbiddenArtists: [...LANDFILL_ARTIST_PATTERNS],
    forbiddenPatterns: [...HIP_HOP_PARTY_PATTERNS],
  },
  "80s_night_drive_world": {
    requiredArtists: [
      /\bdepeche\s+mode\b/i,
      /\bnew\s+order\b/i,
      /\bpet\s+shop\s+boys\b/i,
      /\bthe\s+cure\b/i,
      /\bm83\b/i,
    ],
    forbiddenArtists: [
      ...LANDFILL_ARTIST_PATTERNS,
      /\bthe\s+1975\b/i,
      /\bfleetwood\s+mac\b/i,
      /\bnimino\b/i,
      /\bcalvin\s+harris\b/i,
    ],
    forbiddenPatterns: [
      ...ACOUSTIC_BREAKUP_PATTERNS,
      /\b(?:remix|rework|re-?edit|extended\s+mix|club\s+mix|radio\s+edit|dj\s+edit|bootleg|flip)\b/i,
    ],
  },
  country_world: {
    requiredArtists: [
      /\bjohnny\s+cash\b/i,
      /\bdolly\s+parton\b/i,
      /\bwillie\s+nelson\b/i,
      /\bluke\s+combs\b/i,
      /\bchris\s+stapleton\b/i,
      /\bzach\s+bryan\b/i,
      /\balan\s+jackson\b/i,
    ],
    forbiddenArtists: [
      ...LANDFILL_ARTIST_PATTERNS,
      /\barctic\s+monkeys\b/i,
      /\bjungle\s+giants\b/i,
      /\bfrank\s+ocean\b/i,
    ],
    forbiddenPatterns: [
      /\b(?:indie\s+folk|indie\s+rock|bedroom\s+pop|r&b|hip[\s-]?hop|rap\b)\b/i,
    ],
  },
  grunge_world: {
    requiredArtists: [
      /\bnirvana\b/i,
      /\bpearl\s+jam\b/i,
      /\bsoundgarden\b/i,
      /\balice\s+in\s+chains\b/i,
    ],
    forbiddenArtists: [
      ...LANDFILL_ARTIST_PATTERNS,
      /\bgreen\s+day\b/i,
      /\bblink[-\s]?182\b/i,
    ],
    forbiddenPatterns: [],
  },
  madchester_world: {
    requiredArtists: [
      /\bstone\s+roses\b/i,
      /\bhappy\s+mondays\b/i,
      /\bnew\s+order\b/i,
      /\boasis\b/i,
    ],
    forbiddenArtists: [...LANDFILL_ARTIST_PATTERNS],
    forbiddenPatterns: [],
  },
  britpop_world: {
    requiredArtists: [
      /\boasis\b/i,
      /\bblur\b/i,
      /\bpulp\b/i,
      /\bstone\s+roses\b/i,
    ],
    forbiddenArtists: [...LANDFILL_ARTIST_PATTERNS],
    forbiddenPatterns: [],
  },
  gym_rock_world: {
    requiredArtists: [
      /\bmetallica\b/i,
      /\bac\/?dc\b/i,
      /\bguns\s+n['']?\s*roses\b/i,
      /\bfoo\s+fighters\b/i,
    ],
    forbiddenArtists: [...LANDFILL_ARTIST_PATTERNS],
    forbiddenPatterns: [...ACOUSTIC_BREAKUP_PATTERNS],
  },
  angry_rock_world: {
    requiredArtists: [
      /\bmetallica\b/i,
      /\bslayer\b/i,
      /\bmegadeth\b/i,
      /\bac\/?dc\b/i,
    ],
    forbiddenArtists: [...LANDFILL_ARTIST_PATTERNS],
    forbiddenPatterns: [...ACOUSTIC_BREAKUP_PATTERNS],
  },
  heavy_gym_world: {
    requiredArtists: [
      /\bmetallica\b/i,
      /\bslayer\b/i,
      /\bmegadeth\b/i,
      /\bac\/?dc\b/i,
    ],
    forbiddenArtists: [...LANDFILL_ARTIST_PATTERNS],
    forbiddenPatterns: [...ACOUSTIC_BREAKUP_PATTERNS],
  },
  disco_1970s_world: {
    requiredArtists: [
      /\bbe\s+bee\b/i,
      /\bchic\b/i,
      /\bdonna\s+summer\b/i,
      /\bbeach\s+boys\b/i,
    ],
    forbiddenArtists: [...LANDFILL_ARTIST_PATTERNS],
    forbiddenPatterns: [],
  },
  uk_garage_world: {
    requiredArtists: [
      /\bcraig\s+david\b/i,
      /\bartful\s+dodger\b/i,
      /\bconducta\b/i,
      /\bkurupt\s+fm\b/i,
    ],
    forbiddenArtists: [...LANDFILL_ARTIST_PATTERNS, /\bjungle\s+giants\b/i, /\bwallows\b/i, /\bthe\s+1975\b/i],
    forbiddenPatterns: [/\b(?:country|classic\s+rock|yacht\s+rock|americana)\b/i],
  },
  pop_punk_world: {
    requiredArtists: [
      /\bblink[-\s]?182\b/i,
      /\bgreen\s+day\b/i,
      /\bparamore\b/i,
      /\bfall\s+out\s+boy\b/i,
      /\ball[-\s]?american\s+rejects\b/i,
    ],
    forbiddenArtists: [...LANDFILL_ARTIST_PATTERNS, /\bmetallica\b/i, /\bslayer\b/i, /\bjungle\s+giants\b/i],
    forbiddenPatterns: [/\b(?:classic\s+rock|arena\s+rock|yacht\s+rock)\b/i],
  },
  reggae_world: {
    requiredArtists: [
      /\bbob\s+marley\b/i,
      /\bpeter\s+tosh\b/i,
      /\bdamian\s+marley\b/i,
      /\bsean\s+paul\b/i,
      /\bshaggy\b/i,
      /\bburning\s+spear\b/i,
      /\bgregory\s+isaacs\b/i,
      /\bub40\b/i,
    ],
    forbiddenArtists: [
      ...LANDFILL_ARTIST_PATTERNS,
      /\bmgmt\b/i,
      /\bwallows\b/i,
      /\bthe\s+1975\b/i,
      /\bbeach\s+house\b/i,
      /\bmac\s+demarco\b/i,
      /\btame\s+impala\b/i,
      /\bvampire\s+weekend\b/i,
      /\bjungle\s+giants\b/i,
    ],
    forbiddenPatterns: [/\b(?:indie\s+pop|dream\s+pop|bedroom\s+pop|surf\s+rock|chillwave)\b/i],
  },
  gym_energy_world: {
    requiredArtists: [
      /\bcharlotte\s+de\s+witte\b/i,
      /\bamelie\s+lens\b/i,
      /\bi\s+hate\s+models\b/i,
      /\bkobosil\b/i,
      /\bfred\s+again\b/i,
      /\bcalvin\s+harris\b/i,
    ],
    forbiddenArtists: [
      ...LANDFILL_ARTIST_PATTERNS,
      /\bparamore\b/i,
      /\bfall\s+out\s+boy\b/i,
      /\bgreen\s+day\b/i,
      /\bblink[-\s]?182\b/i,
      /\bac\/?dc\b/i,
      /\bguns\s+n['']?\s*roses\b/i,
      /\bled\s+zeppelin\b/i,
      /\bmetallica\b/i,
    ],
    forbiddenPatterns: [
      /\b(?:pop\s*punk|skate\s*punk|emo\b|easycore|classic\s+rock|arena\s+rock|hard\s+rock|heavy\s+metal)\b/i,
    ],
  },
};

function mergeArtistContracts(worldIds: string[]): CommittedWorldArtistContract {
  const requiredArtists: RegExp[] = [];
  const forbiddenArtists: RegExp[] = [];
  const forbiddenPatterns: RegExp[] = [];
  for (const worldId of worldIds) {
    const contract = WORLD_ARTIST_CONTRACTS[worldId];
    if (!contract) continue;
    requiredArtists.push(...contract.requiredArtists);
    forbiddenArtists.push(...contract.forbiddenArtists);
    forbiddenPatterns.push(...contract.forbiddenPatterns);
  }
  return { requiredArtists, forbiddenArtists, forbiddenPatterns };
}

/** Check if artist/title violates committed-world forbidden artist or pattern rules. */
export function committedWorldArtistForbidden(
  committed: CommittedWorld | null,
  artistName: string | null | undefined,
  trackName?: string | null,
): boolean {
  if (!committed?.hardLock) return false;
  const artist = String(artistName ?? "").trim();
  const title = String(trackName ?? "").trim();
  const blob = `${artist} ${title}`;
  if (artist && committed.forbiddenArtists.some((p) => p.test(artist))) return true;
  if (blob && committed.forbiddenPatterns.some((p) => p.test(blob))) return true;
  return false;
}

/** Score how strongly an artist represents the committed world (0–1). */
export function committedWorldArtistRepresentativeScore(
  committed: CommittedWorld | null,
  artistName: string | null | undefined,
): number {
  if (!committed) return 0;
  const artist = String(artistName ?? "").trim();
  if (!artist) return 0;
  if (committed.requiredArtists.some((p) => p.test(artist))) return 1;
  return 0;
}

/** Musical identity — primary world when present; not overridden by activity tokens. */
const PRIMARY_MUSICAL_WORLD: Array<{ pattern: RegExp; id: string }> = [
  { pattern: /\breggae\b/i, id: "reggae_world" },
  { pattern: /\b(?:ukg|uk\s+garage|2-?step|speed\s+garage)\b/i, id: "uk_garage_world" },
  { pattern: /\bpop[-\s]?punk\b/i, id: "pop_punk_world" },
  {
    pattern: /\b(?:hard\s+techno|industrial\s+techno|warehouse\s+techno|schranz|tekk\b|tekno)\b/i,
    id: "gym_energy_world",
  },
  { pattern: /\bcountry\s+cowboy\b|\bcowboy\s+road\b|\bcountry\b.*\b(?:road|trip|drive)\b/i, id: "country_world" },
  { pattern: /\bdad\s*'?s?\s+rock\b|\bdad\s+rock\b/i, id: "dad_rock_world" },
  { pattern: /\byacht\s+rock\b/i, id: "yacht_rock_world" },
  { pattern: /\barena\s+rock\b/i, id: "arena_rock_world" },
  { pattern: /\bclassic\s+rock\b|\b70s?\s+rock\b|\b80s?\s+rock\b/i, id: "classic_rock_world" },
  { pattern: /\b(?:70s?|seventies)\s+disco\b|\bdisco\b.*\b(?:party|rooftop|dance)\b/i, id: "disco_1970s_world" },
  { pattern: /\b(?:madchester|stone\s+roses|happy\s+mondays|baggy)\b/i, id: "madchester_world" },
  { pattern: /\b(?:madchester|britpop)\b/i, id: "britpop_world" },
  {
    pattern: /\broad\s+trip\b.*\b(?:nostalg|90s|indie|singalong|anthem)\b|\b(?:90s|indie|nostalg)\b.*\broad\s+trip\b/i,
    id: "road_trip_singalong_world",
  },
  { pattern: /\b(?:80s?|eighties)\s+(?:night\s+)?drive\b/i, id: "80s_night_drive_world" },
  { pattern: /\blate\s+night\s+drive\b/i, id: "night_drive_world" },
  {
    pattern: /\blo-?fi\b.*\b(?:study|focus)\b|\b(?:study|focus)\b.*\blo-?fi\b|\blo-?fi\s+study\b/i,
    id: "lofi_world",
  },
  {
    pattern:
      /\b(?:cozy\s+sunday|sunday\s+morning|cozy\s+morning)\b.*\b(?:coffee|tea)\b|\b(?:coffee|tea)\b.*\b(?:cozy\s+sunday|sunday\s+morning|cozy\s+morning)\b|\bcozy\s+sunday\s+morning\b/i,
    id: "sunday_chill_world",
  },
  // Era + indie/alt before bare indie — must not fall through to vague sunday_chill.
  {
    pattern:
      /\b(?:2000s?|noughties|00s)\s+indie\b|\bindie\b.*\b(?:2000s?|noughties|00s)\b|\bindie\s+(?:from\s+the\s+)?(?:2000s?|noughties)\b/i,
    id: "indie_dream_world",
  },
  {
    pattern: /\b(?:90s?|nineties)\s+alternative\s+rock\b|\balternative\s+rock\b|\b90s?\s+alt(?:ernative)?\s+rock\b/i,
    id: "grunge_world",
  },
  { pattern: /\bindie\s+rock\b|\bindie\s+pop\b|\bindie\b/i, id: "indie_dream_world" },
  { pattern: /\b(?:rainy|rain)\s+motorway\b/i, id: "rainy_motorway_world" },
  { pattern: /\broad\s+trip\b.*\b(?:sing|singalong|anthem)\b/i, id: "road_trip_singalong_world" },
  { pattern: /\bpetrol\s+station\b.*\b2\s*am\b/i, id: "petrol_station_2am_world" },
  { pattern: /\bpub\s+singalong\b/i, id: "pub_singalong_world" },
  { pattern: /\brooftop\s+party\b/i, id: "rooftop_party_world" },
  { pattern: /\b(?:pregame|pre[-\s]?game|getting\s+ready.*go\s+out)\b/i, id: "party_prep_world" },
  { pattern: /\bgrunge\b/i, id: "grunge_world" },
  { pattern: /\bgoth\b|\bgothic\b/i, id: "goth_world" },
  { pattern: /\bmetal\b/i, id: "angry_rock_world" },
];

/** Activity-only worlds — used when no primary musical identity is present. */
const ACTIVITY_ONLY_WORLD: Array<{ pattern: RegExp; id: string }> = [
  { pattern: /\bno\s+rap\b.*\b(?:gym|workout)\b|\b(?:gym|workout)\b.*\bno\s+rap\b/i, id: "gym_rock_world" },
  { pattern: /\bheavy\s+gym\s+workout\s+aggressive\b/i, id: "gym_rock_world" },
  {
    pattern: /\b(?:heavy|aggressive)\s+(?:gym|workout)\b|\bgym\b.*\baggressive\b|\baggressive\b.*\b(?:gym|workout|pump)\b/i,
    id: "angry_rock_world",
  },
  {
    pattern: /\bmetal\b.*\b(?:gym|workout|training)\b|\b(?:gym|workout|training)\b.*\bmetal\b/i,
    id: "angry_rock_world",
  },
  { pattern: /\bangry\s+rock\b/i, id: "angry_rock_world" },
  { pattern: /\b(?:heavy|hard)\s+gym\b|\bgym\s+workout\b/i, id: "heavy_gym_world" },
  { pattern: /\bgym\s+rock\b|\bgym\s+pump\b.*\brock\b|\brock\b.*\bgym\b/i, id: "gym_rock_world" },
  { pattern: /\b(?:gym|workout|training\s+session|lifting|cardio|weights)\b/i, id: "gym_rock_world" },
  { pattern: /\b(?:running|run)\b.*\benergy\b|\benergy\b.*\b(?:running|run)\b/i, id: "running_energy_world" },
];

const ACTIVITY_ONLY_WORLD_IDS = new Set(ACTIVITY_ONLY_WORLD.map((row) => row.id));

const MUSICAL_WORLD_IDS = new Set([
  ...PRIMARY_MUSICAL_WORLD.map((row) => row.id),
  "uk_garage_world",
  "reggae_world",
  "pop_punk_world",
  "grunge_world",
  "goth_world",
  "madchester_world",
  "britpop_world",
  "country_world",
  "disco_1970s_world",
  "80s_night_drive_world",
  "night_drive_world",
  "evening_drive_world",
  "rainy_motorway_world",
  "gym_energy_world",
  "lofi_world",
  "focus_study_world",
  "sunday_chill_world",
  "acoustic_sunday_world",
  "coffee_soft_focus_world",
  "quiet_night_world",
  "late_night_calm_world",
  "ambient_world",
  "chill_rainy_world",
  "indie_dream_world",
  "nostalgia_warm_world",
  "soft_sad_world",
  "feel_good_world",
]);

const EXPLICIT_SCENE_WORLD: Array<{ pattern: RegExp; id: string }> = [
  {
    pattern:
      /\b(?:empty\s+)?motorway\b.*\b(?:midnight|rain|windscreen)\b|\b(?:midnight|rain)\b.*\b(?:empty\s+)?motorway\b|\bempty\s+motorway\s+at\s+midnight\b|\brain\b.*\bwindscreen\b/i,
    id: "rainy_motorway_world",
  },
  {
    pattern: /\b(?:rainy|rain)\s+motorway\b/i,
    id: "rainy_motorway_world",
  },
  {
    pattern: /\b(?:late\s+night\s+drive|motorway|highway)\s+at\s+(?:night|midnight)\b|\bnight\s+drive\b|\b(?:empty|night)\s+(?:motorway|highway)\b/i,
    id: "night_drive_world",
  },
];

function resolvePrimaryMusicalWorld(prompt: string): string | null {
  for (const row of PRIMARY_MUSICAL_WORLD) {
    if (row.pattern.test(prompt)) return row.id;
  }
  const inferred = inferWorldIdentityIdsFromPrompt(prompt);
  const musical = inferred.find((id) => MUSICAL_WORLD_IDS.has(id) && !ACTIVITY_ONLY_WORLD_IDS.has(id));
  return musical ?? null;
}

function resolveActivityOnlyWorld(prompt: string): string | null {
  for (const row of ACTIVITY_ONLY_WORLD) {
    if (row.pattern.test(prompt)) return row.id;
  }
  return null;
}

function resolveSecondaryActivityWorld(prompt: string): string | null {
  for (const row of ACTIVITY_ONLY_WORLD) {
    if (row.pattern.test(prompt)) return row.id;
  }
  return null;
}

/** Explicit musical identity present — prefer world-preserving retrieval over activity fallback. */
export function hasExplicitMusicalHardLock(committed: CommittedWorld | null | undefined): boolean {
  if (!committed) return false;
  if (committed.musicalWorldId) return true;
  if (committed.hardLock && isAtmosphericWorld(committed.id)) return true;
  return committed.source === "explicit_genre" && Boolean(committed.hardLock);
}

/** Activity/context slot — used for moment fit, not as musical world substitute. */
export function resolveWorldActivityContext(prompt: string): WorldActivityContext | null {
  const p = prompt.toLowerCase();
  if (/\b(?:gym|workout|lifting|cardio|pump|training\s+session|weights)\b/.test(p)) return "gym";
  if (/\b(?:running|jogging|cardio\s+run)\b/.test(p)) return "running";
  if (/\b(?:study|studying|focus|revision|homework|coding)\b/.test(p)) return "study";
  if (/\b(?:party|pregame|pre[-\s]?drinks|club|rave)\b/.test(p)) return "party";
  if (/\b(?:cook|cooking|kitchen|dinner\s+prep)\b/.test(p)) return "cooking";
  if (/\b(?:drive|driving|motorway|highway|road\s+trip)\b/.test(p)) return "drive";
  return null;
}

/** @deprecated internal — use resolvePrimaryMusicalWorld + resolveActivityOnlyWorld */
function explicitGenreWorld(prompt: string): string | null {
  return resolvePrimaryMusicalWorld(prompt) ?? resolveActivityOnlyWorld(prompt);
}

function explicitSceneWorld(prompt: string): string | null {
  for (const row of EXPLICIT_SCENE_WORLD) {
    if (row.pattern.test(prompt)) return row.id;
  }
  return null;
}

function sourceFromBoundary(
  boundary: WorldBoundary,
  explicitGenre: string | null,
  explicitScene: string | null,
  sceneLock: SceneLockStatus | null,
): CommittedWorldSource {
  if (explicitGenre) return "explicit_genre";
  if (explicitScene) return "inferred";
  if (sceneLock?.active) return "scene_lock";
  if (boundary.reason?.startsWith("world_purity_lock:")) return "inferred";
  if (boundary.active) return "inferred";
  return "vague";
}

function confidenceFor(
  source: CommittedWorldSource,
  hardLock: boolean,
  worldIds: string[],
): number {
  if (worldIds.length === 0) return 0.2;
  if (source === "explicit_genre" && hardLock) return 0.95;
  if (source === "scene_lock" && hardLock) return 0.92;
  if (hardLock) return 0.85;
  if (source === "inferred") return 0.72;
  return 0.45;
}

/** Resolve the single committed world contract for a generation request. */
export function resolveCommittedWorld(opts: {
  prompt?: string;
  vibe?: string;
  sceneLock?: SceneLockStatus | null;
  sceneAliases?: string[];
  scenePrediction?: Record<string, number>;
  primaryGenres?: string[];
  lockedIntent?: { primaryGenres?: string[]; genreFamilies?: string[] } | null;
  editorialWorldTag?: string | null;
}): CommittedWorld | null {
  const prompt = (opts.prompt ?? opts.vibe ?? "").trim();
  if (!prompt) return null;

  const lockedGenres = [
    ...(opts.primaryGenres ?? []),
    ...(opts.lockedIntent?.primaryGenres ?? []),
    ...(opts.lockedIntent?.genreFamilies ?? []),
  ];

  const boundary = resolveWorldBoundary({
    sceneLock: opts.sceneLock ?? null,
    sceneAliases: opts.sceneAliases ?? [],
    scenePrediction: opts.scenePrediction ?? {},
    prompt,
  });

  const musicalWorldId = resolvePrimaryMusicalWorld(prompt);
  const activityOnlyWorldId = musicalWorldId ? null : resolveActivityOnlyWorld(prompt);
  const activityWorldId = musicalWorldId ? resolveSecondaryActivityWorld(prompt) : null;
  const activityContext = resolveWorldActivityContext(prompt);
  const explicitMusical = musicalWorldId != null;
  const explicitActivity = activityOnlyWorldId != null;
  const explicitScene = explicitSceneWorld(prompt);
  const inferred = inferWorldIdentityIdsFromPrompt(prompt);

  let id: string | null = musicalWorldId ?? activityOnlyWorldId ?? explicitScene ?? null;
  if (!id && boundary.lockAnchors?.length) {
    id = boundary.lockAnchors[0] ?? null;
  }
  if (!id && inferred.length > 0) {
    const inferredMusical = inferred.find((w) => MUSICAL_WORLD_IDS.has(w) && !ACTIVITY_ONLY_WORLD_IDS.has(w));
    id = inferredMusical ?? inferred.find((w) => !ACTIVITY_ONLY_WORLD_IDS.has(w)) ?? inferred[0] ?? null;
  }
  if (!id && lockedGenres.includes("rock")) {
    id = "classic_rock_world";
  }
  if (!id) return null;

  const worldIds = [
    ...new Set([
      id,
      ...(musicalWorldId ? [musicalWorldId] : []),
      ...(activityWorldId ? [activityWorldId] : []),
      ...inferred,
      ...(boundary.lockAnchors ?? []),
    ]),
  ];
  if (id === "dad_rock_world" && !worldIds.includes("classic_rock_world")) {
    worldIds.push("classic_rock_world", "dad_secret_world");
  }
  if (id === "lofi_world" && inferred.includes("focus_study_world") && !worldIds.includes("focus_study_world")) {
    worldIds.push("focus_study_world");
  }
  if (
    id === "sunday_chill_world" &&
    inferred.includes("coffee_soft_focus_world") &&
    !worldIds.includes("coffee_soft_focus_world")
  ) {
    worldIds.push("coffee_soft_focus_world");
  }
  // 2000s/era indie: keep nostalgia_warm active so Killers/AM-era artists aren't blanket-stripped.
  if (
    (id === "indie_dream_world" || inferred.includes("indie_dream_world")) &&
    /\b(?:2000s?|noughties|00s|nostalg)/i.test(prompt) &&
    !worldIds.includes("nostalgia_warm_world")
  ) {
    worldIds.push("nostalgia_warm_world");
  }
  // 90s alt rock (not pure grunge): nostalgia + indie_dream for non-Seattle alt supply.
  if (
    (id === "grunge_world" || inferred.includes("grunge_world")) &&
    /\b(?:90s?|nineties)\s+alternative\s+rock\b|\balternative\s+rock\b|\b90s?\s+alt(?:ernative)?\s+rock\b/i.test(
      prompt,
    )
  ) {
    if (!worldIds.includes("nostalgia_warm_world")) worldIds.push("nostalgia_warm_world");
    if (!worldIds.includes("indie_dream_world")) worldIds.push("indie_dream_world");
  }
  const source = sourceFromBoundary(
    boundary,
    explicitMusical ? musicalWorldId : explicitActivity ? activityOnlyWorldId : null,
    explicitScene,
    opts.sceneLock ?? null,
  );
  const atmosphericCommitted = isAtmosphericWorld(id);
  const hardLock =
    Boolean(explicitMusical || explicitScene) ||
    (explicitActivity && !musicalWorldId) ||
    boundary.hardLock === true ||
    (atmosphericCommitted && inferred.includes(id)) ||
    (opts.sceneLock?.active === true && source !== "vague");

  const reason = explicitMusical
    ? `committed_world:musical:${id}`
    : explicitActivity
      ? `committed_world:activity:${id}`
      : explicitScene != null
        ? `committed_world:explicit_scene:${id}`
        : boundary.reason ?? `committed_world:${id}`;

  const artistContract = mergeArtistContracts(worldIds);
  const resolvedMusicalWorldId =
    musicalWorldId ??
    (MUSICAL_WORLD_IDS.has(id) ? id : null) ??
    (atmosphericCommitted && hardLock ? id : null);

  return {
    id,
    hardLock,
    confidence: confidenceFor(source, hardLock, worldIds),
    source,
    reason,
    worldIds,
    boundary,
    musicalWorldId: resolvedMusicalWorldId,
    activityWorldId: activityWorldId ?? activityOnlyWorldId,
    activityContext,
    requiredArtists: artistContract.requiredArtists,
    forbiddenArtists: artistContract.forbiddenArtists,
    forbiddenPatterns: artistContract.forbiddenPatterns,
  };
}

export function committedWorldHonestPartialCap(requestedLength: number): number {
  return Math.min(12, Math.max(6, Math.ceil(requestedLength * 0.4)));
}

/** Activity-only worlds that must not substitute an explicit musical hard lock. */
const ACTIVITY_SUBSTITUTE_WORLD_IDS = new Set([
  "gym_rock_world",
  "heavy_gym_world",
  "angry_rock_world",
  "gym_world",
]);

/** Retrieval world ids — strip gym-rock substitutes when explicit musical identity is locked. */
export function resolveRetrievalWorldIds(opts: {
  committed: CommittedWorld | null;
  prompt: string;
  activeWorldIds?: string[];
}): string[] {
  const inferred = inferWorldIdentityIdsFromPrompt(opts.prompt);
  const raw = [
    ...new Set([
      ...(opts.activeWorldIds ?? []),
      ...(opts.committed?.worldIds ?? []),
      ...inferred,
    ]),
  ];
  if (!hasExplicitMusicalHardLock(opts.committed)) return raw;
  const musicalId = opts.committed!.musicalWorldId ?? opts.committed!.id;
  return [
    ...new Set([
      musicalId,
      ...raw.filter((id) => id === musicalId || !ACTIVITY_SUBSTITUTE_WORLD_IDS.has(id)),
    ]),
  ];
}

/** Resolve cultural identity profile for a committed world contract. */
export function getCulturalProfileForCommitted(committed: CommittedWorld | null): CulturalWorldProfile | null {
  if (!committed) return null;
  const primaryId = committed.musicalWorldId ?? committed.id;
  return culturalProfileForCommittedWorld([primaryId], primaryId);
}
