import type { LockedIntent } from "./intent";

export type ConstraintDimension = "energy" | "bpmRange" | "vibe" | "genre" | "era" | "familiarity" | "mood";

export type ConstraintProfile = {
  activity: string | null;
  priority: ConstraintDimension[];
  era: "strict" | "relaxed" | "dropped";
  /** strict = locked families; adjacent = sibling dance/funk/pop families; relaxed/dropped = open */
  genre: "strict" | "adjacent" | "relaxed" | "dropped";
  audio: "strict" | "relaxed";
  mood: "strict" | "relaxed";
};

export type ConstraintRelaxationStep = {
  id:
    | "strict"
    | "relax_activity_danceable"
    | "relax_era"
    | "relax_genre_adjacent"
    | "relax_genre"
    | "relax_audio"
    | "relax_mood";
  label: string;
  profile: ConstraintProfile;
};

const GENRE_ADJACENT_FAMILIES: Record<string, string[]> = {
  disco: ["soul", "funk", "pop", "electronic", "rnb"],
  soul: ["funk", "rnb", "disco", "pop"],
  funk: ["soul", "disco", "pop", "rnb"],
  pop: ["disco", "soul", "electronic", "indie"],
  electronic: ["disco", "pop", "house", "techno"],
  latin: ["pop", "reggae", "electronic", "soul"],
  house: ["electronic", "disco", "pop"],
  techno: ["electronic", "house"],
  rock: ["indie", "pop", "metal"],
  indie: ["rock", "pop", "folk"],
  hip_hop: ["rnb", "pop", "electronic"],
  rnb: ["soul", "hip_hop", "pop", "funk"],
};

export function expandAdjacentGenreFamilies(families: string[]): string[] {
  const out = new Set<string>();
  for (const family of families) {
    const normalized = family.toLowerCase().replace(/\s+/g, "_");
    out.add(normalized);
    for (const adjacent of GENRE_ADJACENT_FAMILIES[normalized] ?? []) {
      out.add(adjacent);
    }
  }
  return [...out];
}

function widenEraRange(range: { start: number; end: number }): { start: number; end: number } {
  return {
    start: Math.max(1950, range.start - 5),
    end: Math.min(new Date().getFullYear(), range.end + 5),
  };
}

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

export function buildConstraintRelaxationPlan(
  intent: LockedIntent,
  mode: "strict" | "balanced" | "chaotic" = "balanced",
): ConstraintRelaxationStep[] {
  const stackedGenreEraActivity =
    intent.genreFamilies.length > 0 &&
    !!intent.eraRange &&
    !!intent.activity;
  const partyLikeActivity =
    intent.activity === "party" ||
    intent.activity === "dancing" ||
    intent.activity === "social";
  const plan: ConstraintRelaxationStep[] = stackedGenreEraActivity
    ? [
      { id: "strict", label: "strict_constraints", profile: profile(intent) },
      ...(partyLikeActivity
        ? [{
            id: "relax_activity_danceable" as const,
            label: "activity_danceable_compat",
            profile: profile(intent, { audio: "relaxed" }),
          }]
        : []),
      { id: "relax_audio", label: "audio_bounds_relaxed", profile: profile(intent, { audio: "relaxed" }) },
      { id: "relax_mood", label: "mood_relaxed", profile: profile(intent, { audio: "relaxed", mood: "relaxed" }) },
      { id: "relax_era", label: "era_relaxed", profile: profile(intent, { era: "relaxed", audio: "relaxed", mood: "relaxed" }) },
      {
        id: "relax_genre_adjacent",
        label: "genre_adjacent_siblings",
        profile: profile(intent, { era: "relaxed", genre: "adjacent", audio: "relaxed", mood: "relaxed" }),
      },
      { id: "relax_genre", label: "genre_relaxed", profile: profile(intent, { era: "relaxed", genre: "relaxed", audio: "relaxed", mood: "relaxed" }) },
    ]
    : [
      { id: "strict", label: "strict_constraints", profile: profile(intent) },
      { id: "relax_era", label: "era_relaxed", profile: profile(intent, { era: "relaxed" }) },
      { id: "relax_genre", label: "genre_relaxed", profile: profile(intent, { era: "relaxed", genre: "relaxed" }) },
      { id: "relax_audio", label: "audio_bounds_relaxed", profile: profile(intent, { era: "relaxed", genre: "relaxed", audio: "relaxed" }) },
      { id: "relax_mood", label: "mood_relaxed", profile: profile(intent, { era: "relaxed", genre: "relaxed", audio: "relaxed", mood: "relaxed" }) },
    ];
  if (mode === "strict") {
    // Keep single-step strict for simple prompts. Compound genre+era+activity
    // prompts need the stacked ladder or they starve despite bundled adjacent families.
    if (stackedGenreEraActivity) {
      // Stop before fully open genre_relaxed so editorial identity remains bounded.
      const adjacentIdx = plan.findIndex((step) => step.id === "relax_genre_adjacent");
      if (adjacentIdx >= 0) return plan.slice(0, adjacentIdx + 1);
      return plan.slice(0, Math.min(plan.length, 5));
    }
    return plan.slice(0, 1);
  }
  return plan;
}

export function relaxedIntentForProfile(intent: LockedIntent, profile: ConstraintProfile): LockedIntent {
  let eraRange = intent.eraRange;
  if (eraRange && profile.era === "relaxed") {
    eraRange = widenEraRange(eraRange);
  } else if (profile.era === "dropped") {
    eraRange = null;
  }

  let genreFamilies = intent.genreFamilies;
  if (profile.genre === "adjacent") {
    genreFamilies = expandAdjacentGenreFamilies(intent.genreFamilies);
  } else if (profile.genre === "relaxed" || profile.genre === "dropped") {
    genreFamilies = [];
  }

  return {
    ...intent,
    eraRange,
    genreFamilies,
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
  const pressure = Math.max(0, Math.min(1.75, memory?.diversityPressure ?? 1));
  return count > 0 && pressure > 0 ? Math.pow(0.10, count * pressure) : 1;
}

export function artistExceedsSessionCap(memory: SessionArtistMemory | undefined, artistName: string | null | undefined): boolean {
  const artist = normalizeArtist(artistName);
  if (!artist || !memory) return false;
  const pressure = Math.max(0, Math.min(1.75, memory.diversityPressure ?? 1));
  if (pressure < 0.45) return false;
  const effectiveCap = pressure >= 0.85
    ? memory.maxArtistAppearances
    : Math.max(memory.maxArtistAppearances, Math.ceil(memory.maxArtistAppearances / Math.max(0.45, pressure)));
  return (memory.artistCount.get(artist) ?? 0) >= effectiveCap;
}

export function withSessionDiversityPressure(
  memory: SessionArtistMemory | undefined,
  diversityPressure: number,
): SessionArtistMemory | undefined {
  if (!memory) return undefined;
  return {
    ...memory,
    diversityPressure: Math.max(0, Math.min(1.75, diversityPressure)),
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

