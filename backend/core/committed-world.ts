/**
 * Single authoritative committed musical world after prompt interpretation.
 * Explicit genre/scene beats vague mood. Downstream stages must obey this.
 */

import type { SceneLockStatus } from "./scene-lock-mode";
import { resolveWorldBoundary, type WorldBoundary } from "./world-boundary";
import { inferWorldIdentityIdsFromPrompt } from "./editorial/world-identity-gate";

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

export type CommittedWorld = {
  id: string;
  hardLock: boolean;
  confidence: number;
  source: CommittedWorldSource;
  reason: string;
  worldIds: string[];
  boundary: WorldBoundary;
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
    forbiddenArtists: [...LANDFILL_ARTIST_PATTERNS],
    forbiddenPatterns: [...HIP_HOP_PARTY_PATTERNS, ...ACOUSTIC_BREAKUP_PATTERNS, /\blo-?fi\b/i, /\bchillhop\b/i, /\bwallows\b/i],
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
      /\ba\s+flock\s+of\s+seagulls\b/i,
    ],
    forbiddenArtists: [
      ...LANDFILL_ARTIST_PATTERNS,
      /\bthe\s+1975\b/i,
      /\bfleetwood\s+mac\b/i,
    ],
    forbiddenPatterns: [...ACOUSTIC_BREAKUP_PATTERNS],
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

const EXPLICIT_GENRE_WORLD: Array<{ pattern: RegExp; id: string }> = [
  { pattern: /\bdad\s*'?s?\s+rock\b|\bdad\s+rock\b/i, id: "dad_rock_world" },
  { pattern: /\byacht\s+rock\b/i, id: "yacht_rock_world" },
  { pattern: /\barena\s+rock\b/i, id: "arena_rock_world" },
  { pattern: /\bclassic\s+rock\b|\b70s?\s+rock\b|\b80s?\s+rock\b/i, id: "classic_rock_world" },
  { pattern: /\b(?:70s?|seventies)\s+disco\b|\bdisco\b.*\b(?:party|rooftop|dance)\b/i, id: "disco_1970s_world" },
  { pattern: /\b(?:madchester|stone\s+roses|happy\s+mondays|baggy)\b/i, id: "madchester_world" },
  { pattern: /\b(?:madchester|britpop)\b/i, id: "britpop_world" },
  { pattern: /\b(?:ukg|uk\s+garage|2-?step|speed\s+garage)\b/i, id: "uk_garage_world" },
  { pattern: /\b(?:80s?|eighties)\s+(?:night\s+)?drive\b/i, id: "80s_night_drive_world" },
  { pattern: /\b(?:rainy|rain)\s+motorway\b/i, id: "rainy_motorway_world" },
  { pattern: /\broad\s+trip\b.*\b(?:sing|singalong|anthem)\b/i, id: "road_trip_singalong_world" },
  { pattern: /\bpetrol\s+station\b.*\b2\s*am\b/i, id: "petrol_station_2am_world" },
  { pattern: /\bpub\s+singalong\b/i, id: "pub_singalong_world" },
  { pattern: /\brooftop\s+party\b/i, id: "rooftop_party_world" },
  { pattern: /\b(?:pregame|pre[-\s]?game|getting\s+ready.*go\s+out)\b/i, id: "party_prep_world" },
  { pattern: /\b(?:heavy|aggressive)\s+(?:gym|workout)\b|\bgym\b.*\baggressive\b|\baggressive\b.*\b(?:gym|workout|pump)\b/i, id: "angry_rock_world" },
  {
    pattern: /\bmetal\b.*\b(?:gym|workout|training)\b|\b(?:gym|workout|training)\b.*\bmetal\b/i,
    id: "angry_rock_world",
  },
  { pattern: /\bangry\s+rock\b/i, id: "angry_rock_world" },
  { pattern: /\b(?:heavy|hard)\s+gym\b|\bgym\s+workout\b/i, id: "heavy_gym_world" },
  { pattern: /\bgym\s+rock\b|\bgym\s+pump\b.*\brock\b|\brock\b.*\bgym\b/i, id: "gym_rock_world" },
  { pattern: /\b(?:gym|workout|training\s+session|lifting|cardio|weights)\b/i, id: "gym_rock_world" },
  { pattern: /\b(?:running|run)\b.*\benergy\b|\benergy\b.*\b(?:running|run)\b/i, id: "running_energy_world" },
  { pattern: /\bgrunge\b/i, id: "grunge_world" },
  { pattern: /\bgoth\b|\bgothic\b/i, id: "goth_world" },
  { pattern: /\bpop[-\s]?punk\b/i, id: "pop_punk_world" },
  { pattern: /\bmetal\b/i, id: "angry_rock_world" },
];

const EXPLICIT_SCENE_WORLD: Array<{ pattern: RegExp; id: string }> = [
  {
    pattern:
      /\b(?:empty\s+)?motorway\b.*\b(?:midnight|rain|windscreen)\b|\b(?:midnight|rain)\b.*\b(?:empty\s+)?motorway\b|\bempty\s+motorway\s+at\s+midnight\b/i,
    id: "rainy_drive_world",
  },
  {
    pattern: /\b(?:rainy|rain)\s+motorway\b/i,
    id: "rainy_motorway_world",
  },
  {
    pattern: /\b(?:motorway|highway)\s+at\s+(?:night|midnight)\b|\bnight\s+drive\b|\b(?:empty|night)\s+(?:motorway|highway)\b/i,
    id: "night_drive_world",
  },
];

function explicitGenreWorld(prompt: string): string | null {
  for (const row of EXPLICIT_GENRE_WORLD) {
    if (row.pattern.test(prompt)) return row.id;
  }
  return null;
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

  const explicitGenre = explicitGenreWorld(prompt);
  const explicitScene = explicitSceneWorld(prompt);
  const inferred = inferWorldIdentityIdsFromPrompt(prompt);

  let id: string | null = explicitGenre ?? explicitScene ?? null;
  if (!id && boundary.lockAnchors?.length) {
    id = boundary.lockAnchors[0] ?? null;
  }
  if (!id && inferred.length > 0) {
    id = inferred[0] ?? null;
  }
  if (!id && lockedGenres.includes("rock")) {
    id = "classic_rock_world";
  }
  if (!id) return null;

  const worldIds = [...new Set([id, ...inferred, ...(boundary.lockAnchors ?? [])])];
  if (id === "dad_rock_world" && !worldIds.includes("classic_rock_world")) {
    worldIds.push("classic_rock_world", "dad_secret_world");
  }
  const source = sourceFromBoundary(boundary, explicitGenre, explicitScene, opts.sceneLock ?? null);
  const hardLock =
    Boolean(explicitGenre || explicitScene) ||
    boundary.hardLock === true ||
    (opts.sceneLock?.active === true && source !== "vague");

  const reason =
    explicitGenre != null
      ? `committed_world:explicit_genre:${id}`
      : explicitScene != null
        ? `committed_world:explicit_scene:${id}`
        : boundary.reason ?? `committed_world:${id}`;

  const artistContract = mergeArtistContracts(worldIds);

  return {
    id,
    hardLock,
    confidence: confidenceFor(source, hardLock, worldIds),
    source,
    reason,
    worldIds,
    boundary,
    requiredArtists: artistContract.requiredArtists,
    forbiddenArtists: artistContract.forbiddenArtists,
    forbiddenPatterns: artistContract.forbiddenPatterns,
  };
}

export function committedWorldHonestPartialCap(requestedLength: number): number {
  return Math.min(12, Math.max(6, Math.ceil(requestedLength * 0.4)));
}
