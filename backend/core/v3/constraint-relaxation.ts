import type { LockedIntent } from "./intent";

export type ConstraintDimension = "energy" | "bpmRange" | "vibe" | "genre" | "era" | "familiarity" | "mood";

export type ConstraintProfile = {
  activity: string | null;
  priority: ConstraintDimension[];
  era: "strict" | "relaxed" | "dropped";
  genre: "strict" | "relaxed" | "dropped";
  audio: "strict" | "relaxed";
  mood: "strict" | "relaxed";
};

export type ConstraintRelaxationStep = {
  id: "strict" | "relax_era" | "relax_genre" | "relax_audio" | "relax_mood";
  label: string;
  profile: ConstraintProfile;
};

export type SessionArtistMemory = {
  artistCount: Map<string, number>;
  playlistArtistSet: Map<string, Set<string>>;
  maxArtistAppearances: number;
  diversityPressure?: number;
};

function priorityForActivity(activity: string | null): ConstraintDimension[] {
  switch (activity) {
    case "gym":
      return ["energy", "bpmRange", "vibe", "genre", "era", "familiarity"];
    case "focus":
      return ["energy", "vibe", "mood", "genre", "era", "familiarity"];
    case "party":
      return ["energy", "bpmRange", "vibe", "genre", "era", "familiarity"];
    case "driving":
      return ["vibe", "energy", "bpmRange", "genre", "era", "familiarity"];
    default:
      return ["vibe", "energy", "genre", "era", "mood", "familiarity"];
  }
}

function profile(intent: LockedIntent, overrides: Partial<ConstraintProfile> = {}): ConstraintProfile {
  return {
    activity: intent.activity,
    priority: priorityForActivity(intent.activity),
    era: "strict",
    genre: "strict",
    audio: "strict",
    mood: "strict",
    ...overrides,
  };
}

export function buildConstraintRelaxationPlan(intent: LockedIntent): ConstraintRelaxationStep[] {
  const stackedGenreEraActivity =
    intent.genreFamilies.length > 0 &&
    !!intent.eraRange &&
    !!intent.activity;
  if (stackedGenreEraActivity) {
    return [
      { id: "strict", label: "strict_constraints", profile: profile(intent) },
      { id: "relax_audio", label: "audio_bounds_relaxed", profile: profile(intent, { audio: "relaxed" }) },
      { id: "relax_mood", label: "mood_relaxed", profile: profile(intent, { audio: "relaxed", mood: "relaxed" }) },
      { id: "relax_era", label: "era_relaxed", profile: profile(intent, { era: "relaxed", audio: "relaxed", mood: "relaxed" }) },
      { id: "relax_genre", label: "genre_relaxed", profile: profile(intent, { era: "relaxed", genre: "relaxed", audio: "relaxed", mood: "relaxed" }) },
    ];
  }
  return [
    { id: "strict", label: "strict_constraints", profile: profile(intent) },
    { id: "relax_era", label: "era_relaxed", profile: profile(intent, { era: "relaxed" }) },
    { id: "relax_genre", label: "genre_relaxed", profile: profile(intent, { era: "relaxed", genre: "relaxed" }) },
    { id: "relax_audio", label: "audio_bounds_relaxed", profile: profile(intent, { era: "relaxed", genre: "relaxed", audio: "relaxed" }) },
    { id: "relax_mood", label: "mood_relaxed", profile: profile(intent, { era: "relaxed", genre: "relaxed", audio: "relaxed", mood: "relaxed" }) },
  ];
}

export function relaxedIntentForProfile(intent: LockedIntent, profile: ConstraintProfile): LockedIntent {
  return {
    ...intent,
    eraRange: profile.era === "strict" ? intent.eraRange : null,
    genreFamilies: profile.genre === "strict" ? intent.genreFamilies : [],
    mood: profile.mood === "strict" ? intent.mood : [],
  };
}

function normalizeArtist(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

export function artistMemoryCount(memory: SessionArtistMemory | undefined, artistName: string | null | undefined): number {
  const artist = normalizeArtist(artistName);
  return artist ? memory?.artistCount.get(artist) ?? 0 : 0;
}

export function artistMemoryPenalty(memory: SessionArtistMemory | undefined, artistName: string | null | undefined): number {
  const count = artistMemoryCount(memory, artistName);
  const pressure = Math.max(0, Math.min(1, memory?.diversityPressure ?? 1));
  return count > 0 && pressure > 0 ? Math.pow(0.2, count * pressure) : 1;
}

export function artistExceedsSessionCap(memory: SessionArtistMemory | undefined, artistName: string | null | undefined): boolean {
  const artist = normalizeArtist(artistName);
  if (!artist || !memory) return false;
  const pressure = Math.max(0, Math.min(1, memory.diversityPressure ?? 1));
  if (pressure < 0.5) return false;
  const effectiveCap = Math.max(memory.maxArtistAppearances, Math.ceil(memory.maxArtistAppearances / Math.max(0.5, pressure)));
  return (memory.artistCount.get(artist) ?? 0) >= effectiveCap;
}

export function withSessionDiversityPressure(
  memory: SessionArtistMemory | undefined,
  diversityPressure: number,
): SessionArtistMemory | undefined {
  if (!memory) return undefined;
  return {
    ...memory,
    diversityPressure: Math.max(0, Math.min(1, diversityPressure)),
  };
}

export function sessionArtistMemoryDiagnostics(memory: SessionArtistMemory | undefined): Record<string, unknown> {
  if (!memory) {
    return {
      enabled: false,
      maxArtistAppearances: null,
      rememberedArtists: 0,
      topArtists: [],
    };
  }
  return {
    enabled: true,
    maxArtistAppearances: memory.maxArtistAppearances,
    diversityPressure: memory.diversityPressure ?? 1,
    rememberedArtists: memory.artistCount.size,
    playlistCount: memory.playlistArtistSet.size,
    topArtists: [...memory.artistCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([artist, count]) => ({ artist, count })),
  };
}

