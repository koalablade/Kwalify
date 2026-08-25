/**
 * Cap hybrid scoring pool — full-library tri-score on 10k+ tracks is too slow for HTTP.
 *
 * Phase 3 — Retrieval Before Scoring:
 * When a semantic scene is locked (confidence >= threshold), anti-genre tracks are
 * pre-filtered from the candidate pool BEFORE the expensive tri-score runs.
 * This ensures "outlaw country" never retrieves a rap-heavy pool regardless of library size.
 */

import type { EmotionProfile, VibeKind } from "../../lib/emotion";
import { passesSunnyGate } from "../../lib/emotion";
import type { TrackGenreClassification, RootGenre } from "../../lib/genre-taxonomy";
import {
  detectLibraryEraMode,
  libraryEraScoreBoost,
  type LibraryEraMode,
} from "../../lib/vibe-match-guards";
import {
  MINIMAL_GENRE_STACK_THRESHOLD,
  resolveHybridPoolCap,
  LARGE_LIBRARY_THRESHOLD,
  HYBRID_POOL_ABSOLUTE_MAX,
} from "../../lib/production-limits";
import type { SemanticSceneVector } from "../../lib/semantic-scene-engine";
import {
  EXPANDED_ERA_TERMS,
  EXPANDED_GENRE_ALIASES,
  termRegex,
} from "../../lib/expanded-intent-vocabulary";
import { trackHasEraEvidence } from "../../lib/era-evidence";
import {
  classifyHybridCapDrop,
  countByDropReason,
  type HybridCapFitComponents,
  type HybridCapForensicsSummary,
  type HybridCapReserveLane,
  type HybridCapTrackForensic,
} from "../../lib/hybrid-cap-forensics";

const ROOT_GENRE_TERMS: Record<string, string[]> = {
  country: ["country", "americana", "cowboy", "red dirt"],
  hip_hop: ["hip hop", "hip-hop", "rap"],
  rnb: ["r&b", "rnb", "r n b", "rhythm and blues"],
  electronic: ["electronic", "edm", "dance"],
  rock: ["rock"],
  pop: ["pop"],
  indie: ["indie"],
  folk: ["folk"],
  jazz: ["jazz"],
  soul: ["soul", "funk"],
  blues: ["blues"],
  metal: ["metal"],
  reggae: ["reggae", "dancehall"],
  latin: ["latin"],
  classical: ["classical"],
  soundtrack: ["soundtrack", "score", "ost"],
  world: ["world"],
  christmas: ["christmas", "xmas"],
};

const TECHNO_IDENTITY_PROMPT_RE = /\b(?:hard\s+techno|hardgroove|hard\s+groove|schranz|tekk|tekno|industrial\s+techno|warehouse\s+techno|rave\s+techno|hard\s+trance|techno|rave)\b/i;
const TECHNO_COMPATIBLE_SUBGENRES = new Set(["techno", "hard_techno", "rave", "trance"]);

function seededJitter(trackId: string, seed: number): number {
  let h = seed;
  for (let i = 0; i < trackId.length; i++) h = (h * 31 + trackId.charCodeAt(i)) | 0;
  return (h & 0xffff) / 0xffff;
}

function quickEmotionFit(
  track: { energy: number | null; valence: number | null },
  profile: EmotionProfile
): number {
  const e = track.energy ?? 0.5;
  const v = track.valence ?? 0.5;
  return (
    1 -
    (Math.abs(e - profile.energy) + Math.abs(v - profile.valence)) / 2
  );
}

function emotionQuadrantKey(track: { energy: number | null; valence: number | null }): string {
  const e = (track.energy ?? 0.5) >= 0.55 ? "hi" : (track.energy ?? 0.5) <= 0.42 ? "lo" : "md";
  const v = (track.valence ?? 0.5) >= 0.55 ? "pos" : (track.valence ?? 0.5) <= 0.42 ? "neg" : "neu";
  return `${e}_${v}`;
}

function retrievalClusterKey<T extends { trackId: string; energy: number | null; valence: number | null }>(
  track: T,
  classifications: Map<string, TrackGenreClassification>,
): string {
  const family = classifications.get(track.trackId)?.genreFamily ?? "unknown";
  return `${family}|${emotionQuadrantKey(track)}`;
}

function stratifiedPoolPick<T extends { trackId: string }>(
  ranked: Array<{ t: T; fit: number }>,
  max: number,
  clusterKey: (track: T) => string,
  maxClusterShare = 0.45,
): T[] {
  const byCluster = new Map<string, Array<{ t: T; fit: number }>>();
  for (const item of ranked) {
    const key = clusterKey(item.t);
    const list = byCluster.get(key) ?? [];
    list.push(item);
    byCluster.set(key, list);
  }
  for (const list of byCluster.values()) {
    list.sort((a, b) => b.fit - a.fit);
  }
  const clusters = [...byCluster.entries()].sort(
    (a, b) => (b[1][0]?.fit ?? 0) - (a[1][0]?.fit ?? 0),
  );
  const maxPerCluster = Math.max(1, Math.ceil(max * maxClusterShare));
  const picked: T[] = [];
  const seen = new Set<string>();
  const clusterCounts = new Map<string, number>();
  const active = clusters.slice(0, Math.min(4, clusters.length));
  let guard = 0;
  while (picked.length < max && guard < max * Math.max(1, clusters.length) * 2) {
    guard += 1;
    let progressed = false;
    for (const [key, items] of active) {
      if (picked.length >= max) break;
      if ((clusterCounts.get(key) ?? 0) >= maxPerCluster) continue;
      while (items.length > 0 && seen.has(items[0]!.t.trackId)) items.shift();
      const next = items.shift();
      if (!next) continue;
      seen.add(next.t.trackId);
      picked.push(next.t);
      clusterCounts.set(key, (clusterCounts.get(key) ?? 0) + 1);
      progressed = true;
    }
    if (!progressed) break;
  }
  for (const item of ranked) {
    if (picked.length >= max) break;
    if (seen.has(item.t.trackId)) continue;
    const key = clusterKey(item.t);
    if ((clusterCounts.get(key) ?? 0) >= maxPerCluster) continue;
    seen.add(item.t.trackId);
    picked.push(item.t);
    clusterCounts.set(key, (clusterCounts.get(key) ?? 0) + 1);
  }
  return picked;
}

function explicitGenreFamilies(vibe: string | undefined): Set<string> {
  const normalized = vibe ?? "";
  const families = new Set<string>();
  for (const group of EXPANDED_GENRE_ALIASES) {
    const terms = [
      group.family.replace(/_/g, " "),
      group.family,
      ...(ROOT_GENRE_TERMS[group.family] ?? []),
      ...group.terms,
    ];
    if (termRegex(terms).test(normalized)) {
      families.add(group.family);
    }
  }
  return families;
}

function hasTechnoIdentityPrompt(vibe: string | undefined): boolean {
  return TECHNO_IDENTITY_PROMPT_RE.test(vibe ?? "");
}

function matchesTechnoIdentity(
  classification: TrackGenreClassification | undefined
): boolean {
  if (!classification || classification.genreFamily !== "electronic") return false;
  return TECHNO_COMPATIBLE_SUBGENRES.has(classification.primarySubgenre) ||
    (classification.secondarySubgenre ? TECHNO_COMPATIBLE_SUBGENRES.has(classification.secondarySubgenre) : false) ||
    classification.subGenres.some((subgenre) => TECHNO_COMPATIBLE_SUBGENRES.has(subgenre));
}

function matchesExplicitFamily(
  classification: TrackGenreClassification | undefined,
  families: Set<string>
): boolean {
  if (families.size === 0 || !classification) return false;
  const candidates = [
    classification.genreFamily,
    classification.genrePrimary,
    classification.primarySubgenre,
    classification.secondarySubgenre,
    ...(classification.subGenres ?? []),
  ].filter((value): value is string => !!value);
  return candidates.some((genre) => families.has(genre));
}

function explicitFamilyPenalty(
  classification: TrackGenreClassification | undefined,
  families: Set<string>
): number {
  if (families.size === 0 || !classification) return 0;
  return matchesExplicitFamily(classification, families) ? 0 : 0.45;
}

function explicitEraRange(vibe: string | undefined): { start: number; end: number } | null {
  const normalized = vibe ?? "";
  for (const era of EXPANDED_ERA_TERMS) {
    if (termRegex(era.terms).test(normalized)) {
      return { start: era.start, end: era.end };
    }
  }
  const yearMatch = normalized.match(/\b(19[4-9]\d|20[0-2]\d)\b/);
  if (yearMatch?.[1]) {
    const year = Number(yearMatch[1]);
    return { start: year - 2, end: year + 2 };
  }
  return null;
}

function matchesExplicitEra(
  track: { releaseYear?: number | null; trackName?: string | null; artistName?: string | null; albumName?: string | null },
  era: { start: number; end: number } | null
): boolean {
  return !!era && trackHasEraEvidence(track, era);
}

export function capTracksForHybridScoring<T extends {
  trackId: string;
  trackName?: string | null;
  artistName?: string | null;
  albumName?: string | null;
  energy: number | null;
  valence: number | null;
  acousticness?: number | null;
  addedAt?: Date | null;
  releaseYear?: number | null;
}>(
  tracks: T[],
  opts: {
    emotionProfile: EmotionProfile;
    vibeKind: VibeKind;
    classifications: Map<string, TrackGenreClassification>;
    maxTracks?: number;
    librarySize?: number;
    referencePlaylist?: boolean;
    promptWordCount?: number;
    seedMs?: number;
    recentTrackPenalty?: Map<string, number>;
    libraryEraMode?: LibraryEraMode;
    vibe?: string;
    /**
     * Phase 3 — Retrieval Before Scoring:
     * When provided, tracks whose primary genre is a hard anti-genre for this
     * scene are removed from the pool BEFORE scoring begins.
     * The ecosystem filter only activates when we have enough ecosystem-matching
     * tracks (at least 30% of the target cap) to fill the pool.
     */
    ecosystemPreFilter?: {
      vector: SemanticSceneVector;
      sceneConfidence: number;
    };
    /** Contract defer: retrieval pool already contract-shaped — do not emotion-trim. */
    preserveContractRetrievalPool?: boolean;
    /**
     * Audit-only: compute per-track hybrid-cap forensics for these IDs.
     * Never read back into selection. Output pool is identical with or without this set.
     */
    forensicsWatchIds?: ReadonlySet<string>;
  }
): {
  pool: T[];
  originalCount: number;
  poolCapped: boolean;
  candidateCount: number;
  preFilterRejectedCount: number;
  /** 0 = no scene, 1 = full gate (L1), 2 = adjacency bridges (L2), 3 = emergency anti-genre-only (L3) */
  adjacencyLevelUsed: 0 | 1 | 2 | 3;
  intentPreservedCount: number;
  /** Observational only — undefined unless forensicsWatchIds was provided. */
  forensics?: HybridCapForensicsSummary;
} {
  const originalCount = tracks.length;
  const libSize = opts.librarySize ?? originalCount;
  const watchIds = opts.forensicsWatchIds;

  const buildForensics = (input: {
    path: HybridCapForensicsSummary["path"];
    max: number;
    pool: T[];
    candidateCount: number;
    poolCapped: boolean;
    compoundPrompt: boolean;
    explicitFamilies: Set<string>;
    explicitEra: { start: number; end: number } | null;
    ranked?: Array<{ t: T; fit: number; components: HybridCapFitComponents }>;
    reserveLanes?: Map<string, HybridCapReserveLane>;
  }): HybridCapForensicsSummary | undefined => {
    if (!watchIds || watchIds.size === 0) return undefined;
    const inputIds = new Set(tracks.map((t) => t.trackId));
    const survivedIds = new Set(input.pool.map((t) => t.trackId));
    const rankById = new Map<string, number>();
    const fitById = new Map<string, { fit: number; components: HybridCapFitComponents }>();
    if (input.ranked) {
      input.ranked.forEach((item, index) => {
        rankById.set(item.t.trackId, index + 1);
        fitById.set(item.t.trackId, { fit: item.fit, components: item.components });
      });
    }
    const forensicTracks: HybridCapTrackForensic[] = [];
    for (const trackId of watchIds) {
      const inInput = inputIds.has(trackId);
      const survived = survivedIds.has(trackId);
      const scored = fitById.get(trackId) ?? null;
      const reserveLane: HybridCapReserveLane = !inInput
        ? "not_in_input"
        : input.reserveLanes?.get(trackId)
          ?? (input.path === "uncapped" || input.path === "preserve_contract"
            ? "uncapped_passthrough"
            : "unknown");
      forensicTracks.push({
        trackId,
        inInput,
        fit: scored?.fit ?? null,
        preCapRank: rankById.get(trackId) ?? null,
        survived,
        reserveLane,
        dropReason: classifyHybridCapDrop({ inInput, survived }),
        components: scored?.components ?? null,
      });
    }
    return {
      version: 1,
      observational: true,
      path: input.path,
      originalCount,
      candidateCount: input.candidateCount,
      max: input.max,
      outputCount: input.pool.length,
      poolCapped: input.poolCapped,
      compoundPrompt: input.compoundPrompt,
      explicitFamilies: [...input.explicitFamilies],
      explicitEra: input.explicitEra,
      watchIdsRequested: watchIds.size,
      watchInInput: forensicTracks.filter((t) => t.inInput).length,
      watchSurvived: forensicTracks.filter((t) => t.survived).length,
      dropReasonCounts: countByDropReason(forensicTracks),
      tracks: forensicTracks,
    };
  };

  if (opts.preserveContractRetrievalPool && originalCount <= 450) {
    const explicitFamiliesEarly = explicitGenreFamilies(opts.vibe);
    const explicitEraEarly = explicitEraRange(opts.vibe);
    return {
      pool: tracks,
      originalCount,
      poolCapped: false,
      candidateCount: originalCount,
      preFilterRejectedCount: 0,
      adjacencyLevelUsed: 0,
      intentPreservedCount: originalCount,
      forensics: buildForensics({
        path: "preserve_contract",
        max: originalCount,
        pool: tracks,
        candidateCount: originalCount,
        poolCapped: false,
        compoundPrompt: explicitFamiliesEarly.size > 0 && !!explicitEraEarly,
        explicitFamilies: explicitFamiliesEarly,
        explicitEra: explicitEraEarly,
      }),
    };
  }

  let max =
    opts.maxTracks ??
    resolveHybridPoolCap(libSize, {
      referencePlaylist: opts.referencePlaylist,
      vibeKind: opts.vibeKind,
      promptWordCount: opts.promptWordCount,
    });

  // ── Pre-filter: metadata quality only ────────────────────────────────────
  //
  // Scene/ecosystem genre filtering is intentionally REMOVED.
  // Genre diversity must be preserved across the full scoring pool.
  // Scene shapes the output via SCORING WEIGHTS, not by removing tracks.
  //
  // Only filter: corrupted metadata (null trackId), explicit blacklists.
  // Everything else enters the scoring pool and competes on merit.
  let workingTracks = tracks;
  const preFilterRejectedCount = 0;
  const adjacencyLevelUsed: 0 | 1 | 2 | 3 = 0;
  const explicitFamilies = explicitGenreFamilies(opts.vibe);
  const explicitEra = explicitEraRange(opts.vibe);
  const compoundPrompt = explicitFamilies.size > 0 && !!explicitEra;
  const technoIdentityActive = hasTechnoIdentityPrompt(opts.vibe);

  if (compoundPrompt && libSize > LARGE_LIBRARY_THRESHOLD) {
    max = Math.min(HYBRID_POOL_ABSOLUTE_MAX, max + 200);
  }

  if (workingTracks.length <= max) {
    return {
      pool: workingTracks,
      originalCount,
      poolCapped: false,
      candidateCount: workingTracks.length,
      preFilterRejectedCount,
      adjacencyLevelUsed,
      intentPreservedCount: 0,
      forensics: buildForensics({
        path: "uncapped",
        max,
        pool: workingTracks,
        candidateCount: workingTracks.length,
        poolCapped: false,
        compoundPrompt,
        explicitFamilies,
        explicitEra,
      }),
    };
  }

  // Swap to filtered list for the rest of the function
  const tracksForRanking = workingTracks;

  if (tracksForRanking.length === 0) {
    // Pool is empty after filtering — return empty rather than leaking unfiltered tracks.
    // The scoring engine will handle the empty-pool gracefully.
    return {
      pool: [],
      originalCount,
      poolCapped: false,
      candidateCount: 0,
      preFilterRejectedCount,
      adjacencyLevelUsed,
      intentPreservedCount: 0,
      forensics: buildForensics({
        path: "empty",
        max,
        pool: [],
        candidateCount: 0,
        poolCapped: false,
        compoundPrompt,
        explicitFamilies,
        explicitEra,
      }),
    };
  }

  if (originalCount <= max && workingTracks === tracks) {
    return {
      pool: tracks,
      originalCount,
      poolCapped: false,
      candidateCount: originalCount,
      preFilterRejectedCount,
      adjacencyLevelUsed,
      intentPreservedCount: 0,
      forensics: buildForensics({
        path: "uncapped",
        max,
        pool: tracks,
        candidateCount: originalCount,
        poolCapped: false,
        compoundPrompt,
        explicitFamilies,
        explicitEra,
      }),
    };
  }

  // Fast path for 500+ libraries — skip era-balanced reshuffle (maps/sorts entire library).
  if (tracksForRanking.length >= MINIMAL_GENRE_STACK_THRESHOLD) {
    let candidates = tracksForRanking;
    if (opts.vibeKind === "sunny") {
      const sunny = tracksForRanking.filter((t) =>
        passesSunnyGate({
          valence: t.valence,
          energy: t.energy,
          acousticness: t.acousticness ?? null,
        })
      );
      if (sunny.length >= Math.min(max, Math.floor(tracksForRanking.length * 0.25))) {
        candidates = sunny;
      }
    }
    const seed = opts.seedMs ?? 0;
    const softPrompt = explicitFamilies.size === 0 && (opts.promptWordCount ?? 99) <= 8;
    const emotionWeight = softPrompt ? 0.26 : 1;
    const ranked = candidates
      .map((t) => {
        const recentPen = opts.recentTrackPenalty?.get(t.trackId) ?? 0;
        const classification = opts.classifications.get(t.trackId);
        const matchesFamily = matchesExplicitFamily(classification, explicitFamilies);
        const matchesEra = matchesExplicitEra(t, explicitEra);
        // Compound era+genre: prefer true-era likes over modern family-only filler.
        const explicitBoost = matchesFamily ? 0.35 : 0;
        const technoIdentityBoost = technoIdentityActive && matchesTechnoIdentity(classification) ? 0.28 : 0;
        const rawAntiGenre = explicitFamilyPenalty(classification, explicitFamilies);
        const antiGenrePenalty =
          compoundPrompt && matchesEra ? rawAntiGenre * 0.4 : rawAntiGenre;
        const eraBoost = matchesEra ? (compoundPrompt ? 0.42 : 0.25) : 0;
        const jointEraGenreBoost =
          compoundPrompt && matchesFamily && matchesEra ? 0.18 : 0;
        const emotionFit = quickEmotionFit(t, opts.emotionProfile) * emotionWeight;
        const jitter = seededJitter(t.trackId, seed) * (softPrompt ? 0.06 : 0.018);
        const reuseDampener = 1 - Math.min(0.72, recentPen * 1.12);
        const fit =
          (emotionFit + jitter) * reuseDampener +
          explicitBoost + technoIdentityBoost + eraBoost + jointEraGenreBoost - antiGenrePenalty;
        const components: HybridCapFitComponents = {
          emotionFit,
          jitter,
          reuseDampener,
          explicitBoost: explicitBoost + jointEraGenreBoost,
          technoIdentityBoost,
          eraBoost,
          antiGenrePenalty,
          matchesExplicitFamily: matchesFamily,
          matchesExplicitEra: matchesEra,
          genreFamily: classification?.genreFamily ?? null,
          releaseYear: t.releaseYear ?? null,
          artistName: t.artistName ?? null,
          trackName: t.trackName ?? null,
        };
        return { t, fit, components };
      })
      .sort((a, b) => b.fit - a.fit);
    const technoIdentityRanked = technoIdentityActive
      ? ranked.filter((item) => matchesTechnoIdentity(opts.classifications.get(item.t.trackId)))
      : [];
    const technoIdentityReserveTarget = technoIdentityRanked.length > 0
      ? Math.min(technoIdentityRanked.length, Math.max(24, Math.floor(max * 0.40)))
      : 0;
    const explicitRanked = ranked.filter((item) =>
      matchesExplicitFamily(opts.classifications.get(item.t.trackId), explicitFamilies)
    );
    const reserveTarget = explicitRanked.length > 0
      ? Math.min(
        explicitRanked.length,
        Math.max(
          explicitFamilies.size > 0 && explicitEra ? 56 : 24,
          Math.floor(max * (explicitFamilies.size > 0 && explicitEra ? 0.40 : 0.35)),
        ),
      )
      : 0;
    const eraRanked = explicitEra
      ? ranked.filter((item) => matchesExplicitEra(item.t, explicitEra))
      : [];
    const eraReserveTarget = eraRanked.length > 0
      ? Math.min(
        eraRanked.length,
        Math.max(
          explicitFamilies.size > 0 && explicitEra ? 48 : 12,
          Math.floor(max * (explicitFamilies.size > 0 && explicitEra ? 0.35 : 0.20)),
        ),
      )
      : 0;
    const jointEraGenreRanked =
      compoundPrompt
        ? ranked.filter(
            (item) =>
              matchesExplicitFamily(opts.classifications.get(item.t.trackId), explicitFamilies) &&
              matchesExplicitEra(item.t, explicitEra),
          )
        : [];
    const jointReserveTarget = jointEraGenreRanked.length > 0
      ? Math.min(
          jointEraGenreRanked.length,
          Math.max(40, Math.floor(max * 0.32)),
        )
      : 0;
    const picked: T[] = [];
    const seen = new Set<string>();
    const reserveLanes = new Map<string, HybridCapReserveLane>();
    for (const item of technoIdentityRanked.slice(0, technoIdentityReserveTarget)) {
      seen.add(item.t.trackId);
      picked.push(item.t);
      reserveLanes.set(item.t.trackId, "techno_identity");
    }
    // Era∩genre first under compound prompts, then era, then family — era honesty over modern filler.
    for (const item of jointEraGenreRanked.slice(0, jointReserveTarget)) {
      if (seen.has(item.t.trackId)) continue;
      seen.add(item.t.trackId);
      picked.push(item.t);
      reserveLanes.set(item.t.trackId, compoundPrompt ? "explicit_era" : "explicit_family");
    }
    for (const item of eraRanked.slice(0, eraReserveTarget)) {
      if (picked.length >= max) break;
      if (seen.has(item.t.trackId)) continue;
      seen.add(item.t.trackId);
      picked.push(item.t);
      reserveLanes.set(item.t.trackId, "explicit_era");
    }
    for (const item of explicitRanked.slice(0, reserveTarget)) {
      if (picked.length >= max) break;
      if (seen.has(item.t.trackId)) continue;
      seen.add(item.t.trackId);
      picked.push(item.t);
      reserveLanes.set(item.t.trackId, "explicit_family");
    }
    const remaining = stratifiedPoolPick(
      ranked.filter((item) => !seen.has(item.t.trackId)),
      Math.max(0, max - picked.length),
      (track) => retrievalClusterKey(track, opts.classifications),
      explicitFamilies.size > 0 ? 0.45 : 0.40,
    );
    for (const track of remaining) {
      if (picked.length >= max) break;
      if (seen.has(track.trackId)) continue;
      seen.add(track.trackId);
      picked.push(track);
      reserveLanes.set(track.trackId, "stratified");
    }
    return {
      pool: picked,
      originalCount,
      poolCapped: true,
      candidateCount: candidates.length,
      preFilterRejectedCount,
      adjacencyLevelUsed,
      intentPreservedCount: technoIdentityReserveTarget + reserveTarget + eraReserveTarget,
      forensics: buildForensics({
        path: "fast_large_library",
        max,
        pool: picked,
        candidateCount: candidates.length,
        poolCapped: true,
        compoundPrompt,
        explicitFamilies,
        explicitEra,
        ranked,
        reserveLanes,
      }),
    };
  }

  let candidates = tracksForRanking;
  if (opts.vibeKind === "sunny") {
    const sunny = tracksForRanking.filter((t) =>
      passesSunnyGate({
        valence: t.valence,
        energy: t.energy,
        acousticness: t.acousticness ?? null,
      })
    );
    if (sunny.length >= Math.min(max, Math.floor(tracksForRanking.length * 0.25))) {
      candidates = sunny;
    }
  }

  const seed = opts.seedMs ?? 0;
  const softPrompt = explicitFamilies.size === 0 && (opts.promptWordCount ?? 99) <= 8;
  const emotionWeight = softPrompt ? 0.26 : 1;
  const eraMode =
    opts.libraryEraMode ?? detectLibraryEraMode(opts.vibe ?? "");
  const ranked = candidates.map((t) => {
    const recentPen = opts.recentTrackPenalty?.get(t.trackId) ?? 0;
    const libraryEraBoost = libraryEraScoreBoost(t.addedAt ?? null, eraMode);
    const classification = opts.classifications.get(t.trackId);
    const matchesFamily = matchesExplicitFamily(classification, explicitFamilies);
    const matchesEra = matchesExplicitEra(t, explicitEra);
    const explicitBoost = matchesFamily ? 0.25 : 0;
    const technoIdentityBoost = technoIdentityActive && matchesTechnoIdentity(classification) ? 0.24 : 0;
    const rawAntiGenre = explicitFamilyPenalty(classification, explicitFamilies);
    const antiGenrePenalty =
      compoundPrompt && matchesEra ? rawAntiGenre * 0.4 : rawAntiGenre;
    const explicitEraBoost = matchesEra ? (compoundPrompt ? 0.34 : 0.20) : 0;
    const jointEraGenreBoost =
      compoundPrompt && matchesFamily && matchesEra ? 0.14 : 0;
    const emotionFit = quickEmotionFit(t, opts.emotionProfile) * emotionWeight;
    const jitter = seededJitter(t.trackId, seed) * (softPrompt ? 0.06 : 0.018);
    const reuseDampener = 1 - Math.min(0.72, recentPen * 1.12);
    const fit =
      (emotionFit + jitter) * reuseDampener +
      libraryEraBoost +
      explicitBoost +
      technoIdentityBoost +
      explicitEraBoost +
      jointEraGenreBoost -
      antiGenrePenalty;
    const components: HybridCapFitComponents = {
      emotionFit,
      jitter,
      reuseDampener,
      explicitBoost: explicitBoost + jointEraGenreBoost,
      technoIdentityBoost,
      eraBoost: explicitEraBoost + libraryEraBoost,
      antiGenrePenalty,
      matchesExplicitFamily: matchesFamily,
      matchesExplicitEra: matchesEra,
      genreFamily: classification?.genreFamily ?? null,
      releaseYear: t.releaseYear ?? null,
      artistName: t.artistName ?? null,
      trackName: t.trackName ?? null,
    };
    return { t, fit, components };
  });
  ranked.sort((a, b) => b.fit - a.fit);

  let head = ranked.slice(0, Math.min(ranked.length, max * 2));
  if (eraMode === "balanced" && candidates.some((t) => t.addedAt)) {
    const now = Date.now();
    const withAge = candidates
      .map((t) => ({
        t,
        age: t.addedAt ? now - t.addedAt.getTime() : now,
      }))
      .sort((a, b) => a.age - b.age);
    const mid = Math.floor(withAge.length / 2);
    const olderHalf = new Set(
      withAge.slice(0, Math.max(mid, Math.floor(withAge.length * 0.45))).map((x) => x.t.trackId)
    );
    const olderInHead = head.filter((x) => olderHalf.has(x.t.trackId));
    const rest = head.filter((x) => !olderHalf.has(x.t.trackId));
    const olderQuota = Math.min(
      Math.floor(max * 0.4),
      olderInHead.length,
      Math.max(8, Math.floor(max * 0.25))
    );
    head = [
      ...olderInHead.slice(0, olderQuota),
      ...rest.slice(0, Math.max(0, max * 2 - olderQuota)),
    ];
  }

  const byFamily = new Map<RootGenre, typeof ranked>();
  for (const item of head) {
    const fam =
      opts.classifications.get(item.t.trackId)?.genreFamily ?? ("unknown" as RootGenre);
    const list = byFamily.get(fam) ?? [];
    list.push(item);
    byFamily.set(fam, list);
  }

  const picked: T[] = [];
  const seen = new Set<string>();
  const families = [...byFamily.keys()].filter((f) => f !== "unknown");
  if (technoIdentityActive) {
    const identityReserve = ranked
      .filter((item) => matchesTechnoIdentity(opts.classifications.get(item.t.trackId)))
      .slice(0, Math.min(max, Math.max(12, Math.floor(max * 0.30))));
    for (const item of identityReserve) {
      if (seen.has(item.t.trackId)) continue;
      seen.add(item.t.trackId);
      picked.push(item.t);
      if (picked.length >= max) break;
    }
  }

  const maxPerFamily = Math.max(1, Math.ceil(max * 0.45));
  const familyCounts = new Map<RootGenre, number>();

  while (picked.length < max && families.some((f) => (byFamily.get(f)?.length ?? 0) > 0)) {
    for (const fam of families) {
      const list = byFamily.get(fam);
      if (!list?.length) continue;
      if ((familyCounts.get(fam) ?? 0) >= maxPerFamily) continue;
      const next = list.shift()!;
      if (seen.has(next.t.trackId)) continue;
      seen.add(next.t.trackId);
      picked.push(next.t);
      familyCounts.set(fam, (familyCounts.get(fam) ?? 0) + 1);
      if (picked.length >= max) break;
    }
  }

  if (picked.length < max) {
    for (const item of ranked) {
      if (picked.length >= max) break;
      if (seen.has(item.t.trackId)) continue;
      seen.add(item.t.trackId);
      picked.push(item.t);
    }
  }

  return {
    pool: picked,
    originalCount,
    poolCapped: true,
    candidateCount: candidates.length,
    preFilterRejectedCount,
    adjacencyLevelUsed,
    intentPreservedCount: picked.filter((track) =>
      matchesExplicitFamily(opts.classifications.get(track.trackId), explicitFamilies)
    ).length,
    forensics: buildForensics({
      path: "small_library_era_balanced",
      max,
      pool: picked,
      candidateCount: candidates.length,
      poolCapped: true,
      compoundPrompt,
      explicitFamilies,
      explicitEra,
      ranked,
      reserveLanes: new Map(picked.map((track) => [track.trackId, "fill" as HybridCapReserveLane])),
    }),
  };
}
