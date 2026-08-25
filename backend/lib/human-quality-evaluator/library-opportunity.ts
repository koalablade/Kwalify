/**
 * Library opportunity / utilisation measurement for QA.
 * Does not drive generation. Counts are hypotheses from local classification.
 */

import {
  eraWindowForPrompt,
  matchingWorlds,
  scoreTrackAgainstWorld,
  type TrackLike,
  type WorldSpec,
} from "./world-evidence";

export type OpportunityBand = "VERY_LOW" | "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH" | "UNKNOWN";
export type UtilisationBand = "STRONG" | "REASONABLE" | "LOW" | "VERY_LOW" | "UNKNOWN";
export type FillSeverity =
  | "full"
  | "near_full"
  | "partial"
  | "severely_underfilled"
  | "empty"
  | "refused"
  | "timeout"
  | "technical_failure";
export type UnderfillVsOpportunity = "understandable" | "suspicious" | "unknown";
export type ResponseQuality =
  | "GENUINELY_GOOD"
  | "GOOD_MUSIC_WRONG_PROMPT"
  | "CORRECT_PROMPT_BUT_UNDERFILLED"
  | "CORRECT_PROMPT_BUT_REPETITIVE"
  | "TECHNICALLY_VALID_POOR_EXPERIENCE"
  | "HONEST_REFUSAL"
  | "UNCERTAIN";
export type RelevanceGrade = "strong" | "adjacent" | "none";

export type ClassifiedLibraryTrack = {
  trackId: string;
  trackName: string;
  artistName: string;
  albumName: string;
  releaseYear: number | null;
  genreFamily: string;
  primarySubgenre: string;
  subGenres: string[];
  energy?: number | null;
  valence?: number | null;
  acousticness?: number | null;
  danceability?: number | null;
};

export type QaLibrarySnapshot = {
  userId: string;
  loadedAt: string;
  librarySize: number;
  tracks: ClassifiedLibraryTrack[];
  source?: "postgresql_liked_songs" | "file_snapshot";
  sourcePath?: string;
};

export type RelevanceSpec = {
  prompt: string;
  specific: boolean;
  worlds: WorldSpec[];
  era: { min: number; max: number; label: string } | null;
  strongFamilies: string[];
  strongSubgenres: string[];
  adjacentFamilies: string[];
  adjacentSubgenres: string[];
};

export type PromptLibraryAssessment = {
  prompt: string;
  librarySize: number;
  strongRelevantCount: number;
  adjacentRelevantCount: number;
  relevantCount: number;
  opportunity: OpportunityBand;
  utilisation: UtilisationBand;
  confidence: "high" | "medium" | "low";
  selectedCount: number;
  selectedStrong: number;
  selectedAdjacent: number;
  fillSeverity: FillSeverity;
  underfillVsOpportunity: UnderfillVsOpportunity;
  missedOpportunity: boolean;
  sparseLibrary: boolean;
  evidence: string;
};

export function fillSeverity(delivered: number, requested: number, delivery: string): FillSeverity {
  if (delivery === "refused") return "refused";
  if (delivery === "timeout_fallback") return "timeout";
  if (delivery === "technical_failure") return "technical_failure";
  if (delivered <= 0) return "empty";
  if (delivered >= requested) return "full";
  if (delivered / requested >= 0.8) return "near_full";
  if (delivered >= 10) return "partial";
  return "severely_underfilled";
}

export function opportunityBand(strong: number, adjacent: number): OpportunityBand {
  const n = strong + Math.floor(adjacent * 0.35);
  if (n >= 500) return "VERY_HIGH";
  if (n >= 100) return "HIGH";
  if (n >= 25) return "MEDIUM";
  if (n >= 8) return "LOW";
  return "VERY_LOW";
}

export function utilisationBand(input: {
  delivered: number;
  requested: number;
  relevant: number;
  opportunity: OpportunityBand;
}): UtilisationBand {
  if (input.opportunity === "UNKNOWN") return "UNKNOWN";
  if (input.delivered <= 0) return "VERY_LOW";
  const need = Math.min(input.requested, Math.max(input.relevant, 1));
  const vsRequest = input.delivered / input.requested;
  const vsPool = input.delivered / need;
  if (vsRequest >= 0.8 && vsPool >= 0.5) return "STRONG";
  if (vsRequest >= 0.72) return "REASONABLE";
  if (
    (input.opportunity === "HIGH" || input.opportunity === "VERY_HIGH")
    && input.delivered < input.requested
  ) {
    return input.delivered < 10 ? "VERY_LOW" : "LOW";
  }
  if (vsRequest >= 0.4) return "REASONABLE";
  return "LOW";
}

/** Graded prompt → library relevance. Not a generation world lock. */
export function buildRelevanceSpec(prompt: string): RelevanceSpec {
  const p = prompt.toLowerCase();
  const worlds = matchingWorlds(prompt);
  const era = eraWindowForPrompt(prompt);
  const spec: RelevanceSpec = {
    prompt,
    specific: false,
    worlds,
    era,
    strongFamilies: [],
    strongSubgenres: [],
    adjacentFamilies: [],
    adjacentSubgenres: [],
  };

  const add = (
    families: string[],
    subs: string[],
    adjFam: string[] = [],
    adjSub: string[] = [],
  ) => {
    spec.specific = true;
    spec.strongFamilies.push(...families);
    spec.strongSubgenres.push(...subs);
    spec.adjacentFamilies.push(...adjFam);
    spec.adjacentSubgenres.push(...adjSub);
  };

  if (/\bindie rock\b/.test(p)) {
    add(
      ["indie"],
      ["indie_rock", "indie_general"],
      ["rock", "pop", "folk"],
      ["indie_pop", "alt_rock", "britpop", "post_punk", "shoegaze", "lofi_indie"],
    );
  } else if (/\bshoegaze\b/.test(p)) {
    add(["rock"], ["shoegaze"], ["indie"], ["dream_pop", "indie_rock"]);
  } else if (/\bgrime\b/.test(p) && !/\bgarage\b/.test(p)) {
    add(["hip_hop"], ["grime"], ["hip_hop"], ["uk_drill", "uk_hip_hop"]);
  } else if (/\buk\s*garage\b|\bukg\b/.test(p)) {
    add(["electronic"], ["uk_garage"], ["electronic"], ["house", "dnb"]);
  } else if (/\bbritpop\b/.test(p)) {
    add(["rock", "indie"], ["britpop", "indie_rock"], ["rock"], ["alt_rock"]);
  } else if (/\b80s\b/.test(p) && /\bsynth/.test(p)) {
    add(["pop", "electronic"], ["synth_pop"], ["pop"], ["new_wave", "indie_pop"]);
  } else if (/\btrip-?hop\b/.test(p)) {
    add(["electronic"], ["trip_hop"], ["electronic", "hip_hop"], []);
  } else if (/\b90s\b/.test(p) && /\balternative|alt.?rock/.test(p)) {
    add(["rock"], ["alt_rock"], ["indie", "rock"], ["grunge", "indie_rock", "britpop"]);
  } else if (/\bindie\b/.test(p)) {
    add(["indie"], ["indie_general", "indie_rock", "indie_pop"], ["rock", "pop"], ["alt_rock", "lofi_indie"]);
  } else if (/\blo-?fi|lofi\b/.test(p)) {
    add(["indie"], ["lofi_indie"], ["electronic"], []);
  }

  if (worlds.length > 0 || era) spec.specific = true;
  return spec;
}

function asTrackLike(t: ClassifiedLibraryTrack | TrackLike & { name?: string; artist?: string }): TrackLike {
  const row = t as ClassifiedLibraryTrack & TrackLike;
  return {
    name: row.trackName ?? row.name ?? "",
    artist: row.artistName ?? row.artist ?? "",
    album: row.albumName ?? row.album ?? null,
    releaseYear: row.releaseYear ?? null,
    energy: row.energy ?? null,
    valence: row.valence ?? null,
    acousticness: row.acousticness ?? null,
  };
}

export function gradeTrackRelevance(
  track: ClassifiedLibraryTrack | (TrackLike & { genreFamily?: string; primarySubgenre?: string; subGenres?: string[] }),
  spec: RelevanceSpec,
): RelevanceGrade {
  const like = asTrackLike(track);
  const family = String((track as ClassifiedLibraryTrack).genreFamily ?? "").toLowerCase();
  const primary = String((track as ClassifiedLibraryTrack).primarySubgenre ?? "").toLowerCase();
  const subs = new Set(
    ((track as ClassifiedLibraryTrack).subGenres ?? []).map((s) => s.toLowerCase()).concat(primary ? [primary] : []),
  );

  let worldStrong = false;
  let worldMismatch = false;
  for (const world of spec.worlds) {
    const hit = scoreTrackAgainstWorld(like, world);
    if (hit.negative && !hit.positive) worldMismatch = true;
    if (hit.positive) worldStrong = true;
    if (world.era && hit.inEra === true && (spec.strongFamilies.includes(family) || spec.strongSubgenres.some((s) => subs.has(s)))) {
      worldStrong = true;
    }
  }

  if (worldMismatch && !worldStrong) return "none";
  if (worldStrong) return "strong";

  if (spec.era && typeof like.releaseYear === "number") {
    const inEra = like.releaseYear >= spec.era.min && like.releaseYear <= spec.era.max;
    if (inEra && (spec.strongFamilies.includes(family) || spec.strongSubgenres.some((s) => subs.has(s)))) {
      return "strong";
    }
  }

  if (spec.strongSubgenres.some((s) => subs.has(s))) return "strong";
  if (spec.strongFamilies.includes(family)) return "strong";
  if (spec.adjacentSubgenres.some((s) => subs.has(s))) return "adjacent";
  if (spec.adjacentFamilies.includes(family) && spec.strongFamilies.length > 0) return "adjacent";
  return "none";
}

export function assessLibraryForPrompt(input: {
  prompt: string;
  snapshot: QaLibrarySnapshot | null | undefined;
  selected: TrackLike[];
  delivered: number;
  requested: number;
  delivery: string;
}): PromptLibraryAssessment {
  const fill = fillSeverity(input.delivered, input.requested, input.delivery);
  if (!input.snapshot || input.snapshot.tracks.length === 0) {
    return {
      prompt: input.prompt,
      librarySize: 0,
      strongRelevantCount: 0,
      adjacentRelevantCount: 0,
      relevantCount: 0,
      opportunity: "UNKNOWN",
      utilisation: "UNKNOWN",
      confidence: "low",
      selectedCount: input.delivered,
      selectedStrong: 0,
      selectedAdjacent: 0,
      fillSeverity: fill,
      underfillVsOpportunity: "unknown",
      missedOpportunity: false,
      sparseLibrary: false,
      evidence: "Library snapshot unavailable — cannot assume sparse library",
    };
  }

  const spec = buildRelevanceSpec(input.prompt);
  if (!spec.specific) {
    const size = input.snapshot.librarySize;
    const opportunity = size >= 500 ? "VERY_HIGH" : size >= 100 ? "HIGH" : "MEDIUM";
    return {
      prompt: input.prompt,
      librarySize: size,
      strongRelevantCount: size,
      adjacentRelevantCount: 0,
      relevantCount: size,
      opportunity,
      utilisation: fill === "full" || fill === "near_full" ? "REASONABLE" : "UNKNOWN",
      confidence: "low",
      selectedCount: input.delivered,
      selectedStrong: 0,
      selectedAdjacent: 0,
      fillSeverity: fill,
      underfillVsOpportunity: "unknown",
      missedOpportunity: false,
      sparseLibrary: false,
      evidence: `Vague/open prompt — whole library (${size}) is potential taste material; do not treat underfill as genre scarcity`,
    };
  }

  let strong = 0;
  let adjacent = 0;
  for (const t of input.snapshot.tracks) {
    const g = gradeTrackRelevance(t, spec);
    if (g === "strong") strong += 1;
    else if (g === "adjacent") adjacent += 1;
  }
  const relevant = strong + adjacent;
  const opportunity = opportunityBand(strong, adjacent);

  let selectedStrong = 0;
  let selectedAdjacent = 0;
  for (const t of input.selected) {
    const g = gradeTrackRelevance(
      {
        trackId: "",
        trackName: t.name,
        artistName: t.artist,
        albumName: t.album ?? "",
        releaseYear: t.releaseYear ?? null,
        genreFamily: "",
        primarySubgenre: "",
        subGenres: [],
        energy: t.energy ?? null,
        valence: t.valence ?? null,
        acousticness: t.acousticness ?? null,
      },
      spec,
    );
    if (g === "strong") selectedStrong += 1;
    else if (g === "adjacent") selectedAdjacent += 1;
  }

  const utilisation = utilisationBand({
    delivered: input.delivered,
    requested: input.requested,
    relevant: Math.max(strong, 1),
    opportunity,
  });

  const underfilled = fill === "partial" || fill === "severely_underfilled";
  const highOpp = opportunity === "HIGH" || opportunity === "VERY_HIGH";
  const sparse = opportunity === "VERY_LOW" || opportunity === "LOW";
  let underfillVsOpportunity: UnderfillVsOpportunity = "unknown";
  if (underfilled && highOpp) underfillVsOpportunity = "suspicious";
  else if (underfilled && sparse) underfillVsOpportunity = "understandable";
  else if (!underfilled) underfillVsOpportunity = "understandable";

  const missed =
    (highOpp && selectedStrong === 0 && input.delivered > 0)
    || (highOpp && underfilled);

  return {
    prompt: input.prompt,
    librarySize: input.snapshot.librarySize,
    strongRelevantCount: strong,
    adjacentRelevantCount: adjacent,
    relevantCount: relevant,
    opportunity,
    utilisation,
    confidence: strong >= 25 ? "high" : strong >= 8 ? "medium" : "low",
    selectedCount: input.delivered,
    selectedStrong,
    selectedAdjacent,
    fillSeverity: fill,
    underfillVsOpportunity,
    missedOpportunity: missed,
    sparseLibrary: sparse && strong < input.requested,
    evidence: `${strong} strong / ${adjacent} adjacent of ${input.snapshot.librarySize} library tracks; delivered ${input.delivered}/${input.requested}; utilisation ${utilisation}`,
  };
}

export function underfillHighOpportunity(a: PromptLibraryAssessment): boolean {
  return a.underfillVsOpportunity === "suspicious" && a.opportunity !== "UNKNOWN";
}

/** Track IDs graded strong for a prompt. Measurement only — does not drive generation. */
export function strongRelevantTrackIds(snapshot: QaLibrarySnapshot, prompt: string): string[] {
  const spec = buildRelevanceSpec(prompt);
  if (!spec.specific) return snapshot.tracks.map((t) => t.trackId).filter(Boolean);
  return snapshot.tracks
    .filter((t) => gradeTrackRelevance(t, spec) === "strong")
    .map((t) => t.trackId)
    .filter(Boolean);
}
