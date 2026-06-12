import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type PromptKind = "gym" | "party" | "focus" | "driving" | "chill";

type TasteTrack = {
  trackId?: string | null;
  track?: string | null;
  artist?: string | null;
  cluster?: string | null;
  uniquenessScore?: number | null;
};

type GravityArtist = {
  artist?: string | null;
  repetitionRiskScore?: number | null;
  libraryPercent?: number | null;
};

type TasteProfileJson = {
  generatedAt?: string;
  artistGravity?: {
    topOverrepresentedArtists?: GravityArtist[];
  };
  uniqueness?: {
    top100MostUniqueTracks?: TasteTrack[];
    top100MostOverusedTracks?: Array<TasteTrack & { overuseScore?: number | null }>;
  };
  seedPools?: Record<string, { tracks?: TasteTrack[] }>;
};

export type TasteProfilePrior = {
  enabled: boolean;
  generatedAt: string | null;
  source: "builtin" | "file" | "none";
  artistGravity: Map<string, { risk: number; libraryPercent: number }>;
  trackProfileById: Map<string, TasteTrack>;
  trackProfileByKey: Map<string, TasteTrack>;
  seedTrackIdsByKind: Map<PromptKind, Set<string>>;
  seedTrackKeysByKind: Map<PromptKind, Set<string>>;
};

let cachedPrior: TasteProfilePrior | undefined;

const BUILTIN_ARTIST_GRAVITY: GravityArtist[] = [
  { artist: "Arctic Monkeys", repetitionRiskScore: 0.5567, libraryPercent: 1.48 },
  { artist: "Drake", repetitionRiskScore: 0.5539, libraryPercent: 0.87 },
  { artist: "The Black Keys", repetitionRiskScore: 0.5538, libraryPercent: 0.85 },
  { artist: "Cigarettes After Sex", repetitionRiskScore: 0.5534, libraryPercent: 0.75 },
  { artist: "Catfish and the Bottlemen", repetitionRiskScore: 0.5524, libraryPercent: 0.54 },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function normalizeTasteKey(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s*\((?:feat\.?|ft\.?|featuring)[^)]+\)/gi, "")
    .replace(/\s+-\s+(?:feat\.?|ft\.?|featuring).+$/gi, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function trackKey(track: { artistName?: string | null; trackName?: string | null }): string {
  return `${normalizeTasteKey(track.artistName)}::${normalizeTasteKey(track.trackName)}`;
}

function profileTrackKey(track: TasteTrack): string {
  return `${normalizeTasteKey(track.artist)}::${normalizeTasteKey(track.track)}`;
}

function candidatePaths(): string[] {
  return [
    path.resolve(process.cwd(), "taste-profile.json"),
    path.resolve(process.cwd(), "..", "taste-profile.json"),
    path.resolve(__dirname, "..", "..", "taste-profile.json"),
    path.resolve(__dirname, "..", "..", "..", "taste-profile.json"),
  ];
}

function emptyPrior(): TasteProfilePrior {
  return {
    enabled: false,
    generatedAt: null,
    source: "none",
    artistGravity: new Map(),
    trackProfileById: new Map(),
    trackProfileByKey: new Map(),
    seedTrackIdsByKind: new Map(),
    seedTrackKeysByKind: new Map(),
  };
}

function applyArtistGravity(prior: TasteProfilePrior, artists: GravityArtist[]): void {
  for (const artist of artists) {
    const key = normalizeTasteKey(artist.artist);
    if (!key) continue;
    prior.artistGravity.set(key, {
      risk: clamp(Number(artist.repetitionRiskScore ?? 0), 0, 1),
      libraryPercent: Math.max(0, Number(artist.libraryPercent ?? 0)),
    });
  }
}

function builtinPrior(): TasteProfilePrior {
  const prior: TasteProfilePrior = {
    ...emptyPrior(),
    enabled: true,
    generatedAt: "builtin:selection-gravity-audit",
    source: "builtin",
  };
  applyArtistGravity(prior, BUILTIN_ARTIST_GRAVITY);
  return prior;
}

function addTrack(prior: TasteProfilePrior, track: TasteTrack): void {
  const id = String(track.trackId ?? "").trim();
  if (id) prior.trackProfileById.set(id, track);
  const key = profileTrackKey(track);
  if (key !== "::") prior.trackProfileByKey.set(key, track);
}

function seedKindFromPoolName(poolName: string): PromptKind | null {
  if (poolName.startsWith("gym_")) return "gym";
  if (poolName.startsWith("party_")) return "party";
  if (poolName.startsWith("focus_")) return "focus";
  if (poolName.startsWith("driving_")) return "driving";
  if (poolName.startsWith("chill_")) return "chill";
  return null;
}

export function loadTasteProfilePrior(): TasteProfilePrior {
  if (cachedPrior !== undefined) return cachedPrior;
  const filePath = candidatePaths().find((candidate) => existsSync(candidate));
  if (!filePath) {
    cachedPrior = builtinPrior();
    return cachedPrior;
  }

  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as TasteProfileJson;
    const prior: TasteProfilePrior = {
      ...builtinPrior(),
      enabled: true,
      generatedAt: raw.generatedAt ?? null,
      source: "file",
    };

    applyArtistGravity(prior, raw.artistGravity?.topOverrepresentedArtists ?? []);

    for (const track of raw.uniqueness?.top100MostUniqueTracks ?? []) addTrack(prior, track);
    for (const track of raw.uniqueness?.top100MostOverusedTracks ?? []) addTrack(prior, track);

    for (const [poolName, pool] of Object.entries(raw.seedPools ?? {})) {
      const kind = seedKindFromPoolName(poolName);
      if (!kind) continue;
      const idSet = prior.seedTrackIdsByKind.get(kind) ?? new Set<string>();
      const keySet = prior.seedTrackKeysByKind.get(kind) ?? new Set<string>();
      for (const track of pool.tracks ?? []) {
        addTrack(prior, track);
        const id = String(track.trackId ?? "").trim();
        if (id) idSet.add(id);
        const key = profileTrackKey(track);
        if (key !== "::") keySet.add(key);
      }
      prior.seedTrackIdsByKind.set(kind, idSet);
      prior.seedTrackKeysByKind.set(kind, keySet);
    }

    cachedPrior = prior;
    return cachedPrior;
  } catch {
    cachedPrior = builtinPrior();
    return cachedPrior;
  }
}

export function promptKindForTastePrior(vibe: string): PromptKind | null {
  const lower = vibe.toLowerCase();
  if (/\b(?:gym|workout|training|pump|cardio|run|running|lifting|weights)\b/.test(lower)) return "gym";
  if (/\b(?:party|club|dancefloor|pre\s*drinks|night\s*out|rave)\b/.test(lower)) return "party";
  if (/\b(?:focus|study|coding|concentration|revision|office|work)\b/.test(lower)) return "focus";
  if (/\b(?:drive|driving|road|motorway|backroads?|commute)\b/.test(lower)) return "driving";
  if (/\b(?:chill|calm|cozy|cosy|evening|relax|warm)\b/.test(lower)) return "chill";
  return null;
}

export function tasteProfileForTrack(
  prior: TasteProfilePrior | undefined,
  track: { trackId: string; artistName?: string | null; trackName?: string | null },
): TasteTrack | null {
  if (!prior?.enabled || prior.source === "builtin") return null;
  return prior.trackProfileById.get(track.trackId) ?? prior.trackProfileByKey.get(trackKey(track)) ?? null;
}

export function artistGravityMultiplier(
  prior: TasteProfilePrior | undefined,
  artistName: string | null | undefined,
  samePlaylistArtistCount = 0,
): number {
  if (!prior?.enabled) return 1;
  const gravity = prior.artistGravity.get(normalizeTasteKey(artistName));
  if (!gravity) return 1;
  const basePenalty = clamp(gravity.risk * 0.13 + (gravity.libraryPercent / 100) * 0.25, 0.03, 0.14);
  const repeatPenalty = Math.min(0.14, samePlaylistArtistCount * 0.045);
  return clamp(1 - basePenalty - repeatPenalty, 0.72, 1);
}

export function seedPoolMultiplier(
  prior: TasteProfilePrior | undefined,
  promptKind: PromptKind | null,
  track: { trackId: string; artistName?: string | null; trackName?: string | null },
): number {
  if (!prior?.enabled || prior.source === "builtin" || !promptKind) return 1;
  const ids = prior.seedTrackIdsByKind.get(promptKind);
  const keys = prior.seedTrackKeysByKind.get(promptKind);
  const inSeedPool = ids?.has(track.trackId) || keys?.has(trackKey(track));
  return inSeedPool ? 1.055 : 1;
}

export function uniquenessMultiplier(
  prior: TasteProfilePrior | undefined,
  track: { trackId: string; artistName?: string | null; trackName?: string | null },
): number {
  const profile = tasteProfileForTrack(prior, track);
  if (!profile || typeof profile.uniquenessScore !== "number") return 1;
  return clamp(0.975 + profile.uniquenessScore * 0.07, 0.975, 1.045);
}

export function clusterSaturationMultiplier(
  prior: TasteProfilePrior | undefined,
  track: { trackId: string; artistName?: string | null; trackName?: string | null },
  selectedClusterCount: number,
): number {
  const profile = tasteProfileForTrack(prior, track);
  if (!prior?.enabled || !profile?.cluster) return 1;
  return clamp(1 / (1 + selectedClusterCount * 0.075), 0.74, 1);
}

export function tasteProfileScoreMultiplier(
  prior: TasteProfilePrior | undefined,
  promptKind: PromptKind | null,
  track: { trackId: string; artistName?: string | null; trackName?: string | null },
  samePlaylistArtistCount = 0,
  selectedClusterCount = 0,
): number {
  return clamp(
    artistGravityMultiplier(prior, track.artistName, samePlaylistArtistCount) *
      seedPoolMultiplier(prior, promptKind, track) *
      uniquenessMultiplier(prior, track) *
      clusterSaturationMultiplier(prior, track, selectedClusterCount),
    0.68,
    1.09,
  );
}

export function tasteProfileTieBreak(
  prior: TasteProfilePrior | undefined,
  a: { trackId: string; artistName?: string | null; trackName?: string | null },
  b: { trackId: string; artistName?: string | null; trackName?: string | null },
): number {
  if (!prior?.enabled) return 0;
  const ag = prior.artistGravity.get(normalizeTasteKey(a.artistName))?.risk ?? 0;
  const bg = prior.artistGravity.get(normalizeTasteKey(b.artistName))?.risk ?? 0;
  if (Math.abs(ag - bg) > 0.001) return ag - bg;
  const au = tasteProfileForTrack(prior, a)?.uniquenessScore ?? 0;
  const bu = tasteProfileForTrack(prior, b)?.uniquenessScore ?? 0;
  return bu - au;
}

export function tasteProfileDiagnostics(prior: TasteProfilePrior | undefined): Record<string, unknown> {
  return {
    enabled: !!prior?.enabled,
    source: prior?.source ?? "none",
    generatedAt: prior?.generatedAt ?? null,
    overrepresentedArtists: prior?.artistGravity.size ?? 0,
    builtinArtistGravity: BUILTIN_ARTIST_GRAVITY.map((artist) => artist.artist),
    profiledTracks: prior?.trackProfileById.size ?? 0,
    seedPools: prior ? Object.fromEntries([...prior.seedTrackIdsByKind.entries()].map(([kind, ids]) => [kind, ids.size])) : {},
  };
}
