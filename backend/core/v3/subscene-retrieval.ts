/**
 * Sub-scene retrieval refinements inside an already-correct editorial world.
 *
 * These are NOT new scene concepts. They deepen retrieval for known behaviours
 * like soft-electronic aftermath (rave comedown / afterparty / late-night drive)
 * when the chosen world texture would otherwise discard the human softest
 * electronic neighbourhood.
 */
import type { LockedIntent } from "./intent";
import {
  rankCandidatesByIntentVector,
  scoreEditorialIntentMatch,
  type EditorialIntentVector,
  type IntentCollapseTrack,
  type RankedCandidateSelection,
} from "../editorial/intent-collapse-layer";
import { getGenreFamily } from "./global-diversity-controller";
import { resolveHumanScene } from "../../lib/human-scene-knowledge";

export type SubSceneRetrievalKind =
  | "soft_electronic_aftermath"
  | "late_night_reflection"
  | "none";

export type SubSceneRetrievalPlan = {
  kind: SubSceneRetrievalKind;
  reason: string;
  /** Soft electronic afterparty texture — allow pulse without opening peak rave. */
  rhythmDensityCap: number | null;
  sonicAggressionCeiling: number | null;
  /** Library-adaptive upper energy for softest electronic neighbourhood. */
  energyHi: number | null;
  reservedNeighbourhoodSeats: number;
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function feature(value: number | null | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function trackFamily(track: IntentCollapseTrack): string {
  return getGenreFamily(track.genreFamily ?? track.genrePrimary ?? "unknown");
}

/** Soft-electronic / afterparty comedown or adjacent late-night electronic aftermath. */
export function detectSubSceneRetrievalKind(
  vibe: string,
  lockedIntent: LockedIntent,
): SubSceneRetrievalKind {
  const human = resolveHumanScene(vibe);
  if (human.musicalBehaviour === "soft_electronic") return "soft_electronic_aftermath";
  if (human.phase === "aftermath" && lockedIntent.genreFamilies.includes("electronic")) {
    return "soft_electronic_aftermath";
  }

  const lower = vibe.toLowerCase();
  if (
    /\b(?:comedown|afterparty|after.?party|post.?rave|post.?club|4am|5am)\b/.test(lower) &&
    (/\b(?:rave|club|techno|house|electronic)\b/.test(lower) ||
      lockedIntent.genreFamilies.includes("electronic"))
  ) {
    return "soft_electronic_aftermath";
  }
  if (
    /\b(?:late.?night|city lights|bus home)\b/.test(lower) &&
    lockedIntent.genreFamilies.includes("electronic") &&
    lockedIntent.energy === "low"
  ) {
    return "late_night_reflection";
  }
  return "none";
}

export function buildSubSceneRetrievalPlan(opts: {
  vibe: string;
  lockedIntent: LockedIntent;
  libraryTracks: IntentCollapseTrack[];
  targetCount: number;
}): SubSceneRetrievalPlan {
  const kind = detectSubSceneRetrievalKind(opts.vibe, opts.lockedIntent);
  if (kind === "none") {
    return {
      kind,
      reason: "no_subscene",
      rhythmDensityCap: null,
      sonicAggressionCeiling: null,
      energyHi: null,
      reservedNeighbourhoodSeats: 0,
    };
  }

  const electronic = opts.libraryTracks.filter((t) => trackFamily(t) === "electronic" && typeof t.energy === "number");
  const softElectronic = electronic
    .filter((t) => (t.energy as number) <= 0.52)
    .sort((a, b) => (a.energy as number) - (b.energy as number));
  const softestElectronic = [...electronic].sort((a, b) => (a.energy as number) - (b.energy as number));

  // When true soft electronic is scarce, open only the soft-remnant band
  // (≤ ~0.62). Do NOT raise into peak house/DnB via bottom-quartile electronic —
  // that floods festival energy into comedown neighbourhoods and later response
  // pruning underfills the playlist.
  const SOFT_REMNANT_CAP = 0.62;
  let energyHi: number | null = null;
  if (softElectronic.length < Math.max(8, Math.ceil(opts.targetCount * 0.35)) && softestElectronic.length > 0) {
    const remnantIdx = Math.min(
      softestElectronic.length - 1,
      Math.max(4, Math.ceil(opts.targetCount * 0.4)),
    );
    const remnant = softestElectronic[remnantIdx]!.energy as number;
    energyHi = clamp01(Math.min(SOFT_REMNANT_CAP, Math.max(0.52, remnant + 0.02)));
  }

  const seats = Math.min(
    96,
    Math.max(36, Math.ceil(opts.targetCount * 2.2)),
  );

  if (kind === "soft_electronic_aftermath") {
    return {
      kind,
      reason:
        softElectronic.length === 0
          ? "library_soft_electronic_empty_use_soft_remnant_neighbourhood"
          : softElectronic.length < 8
            ? "library_soft_electronic_scarce_use_soft_remnant_neighbourhood"
            : "soft_electronic_aftermath_texture",
      // Comedown still has pulse — study micro-caps otherwise hard-zero house/DnB remnants.
      rhythmDensityCap: 0.62,
      sonicAggressionCeiling: 0.52,
      energyHi,
      reservedNeighbourhoodSeats: seats,
    };
  }

  return {
    kind,
    reason: "late_night_electronic_reflection",
    rhythmDensityCap: 0.56,
    sonicAggressionCeiling: 0.46,
    energyHi,
    reservedNeighbourhoodSeats: Math.ceil(seats * 0.75),
  };
}

/** Prefer night-interior electronic texture over study focus when comedown is active. */
export function preferredSubSceneWorldTag(kind: SubSceneRetrievalKind): string | null {
  if (kind === "soft_electronic_aftermath") return "late_night_indie_interior";
  if (kind === "late_night_reflection") return "late_night_city_rain";
  return null;
}

export function applySubSceneRetrievalTexture(
  intent: EditorialIntentVector,
  plan: SubSceneRetrievalPlan,
): EditorialIntentVector {
  if (plan.kind === "none") return intent;
  let next: EditorialIntentVector = { ...intent };

  if (plan.rhythmDensityCap != null) {
    next.rhythmDensityCap = Math.max(next.rhythmDensityCap, plan.rhythmDensityCap);
  }
  if (plan.sonicAggressionCeiling != null) {
    next.sonicAggressionCeiling = Math.max(next.sonicAggressionCeiling, plan.sonicAggressionCeiling);
  }
  if (plan.energyHi != null) {
    const lo = next.energyRange[0];
    const hi = Math.max(next.energyRange[1], plan.energyHi);
    next.energyRange = [lo, hi];
  }

  // Ensure electronic textures remain admissible for comedown neighbourhoods.
  const micros = new Set(next.allowedMicroClusters);
  for (const micro of [
    "electronic:balanced",
    "electronic:electronic",
    "electronic:rhythmic",
    "indie:electronic",
    "indie:balanced",
  ]) {
    micros.add(micro);
  }
  next.allowedMicroClusters = [...micros];
  return next;
}

function isElectronicNeighbourhoodCandidate(track: IntentCollapseTrack, energyHi: number): boolean {
  const energy = feature(track.energy, 1);
  if (energy < 0.1 || energy > energyHi) return false;
  if (trackFamily(track) === "electronic") return true;
  // Synth-adjacent / chillwave neighbourhood when Spotify genres are empty and
  // family collapses to indie. Exclude folk/ballad textures a human would not
  // pick for afterparty comedown.
  const acoustic = feature(track.acousticness, 0.5);
  const dance = feature(track.danceability, 0.5);
  const inst = feature(track.instrumentalness, 0);
  if (acoustic >= 0.45) return false;
  if (dance < 0.4 || dance > 0.8) return false;
  if (energy > 0.5 && dance > 0.72) return false;
  return inst >= 0.12 || energy <= 0.4 || (acoustic < 0.3 && dance >= 0.46);
}

export function selectSubSceneNeighbourhood<T extends IntentCollapseTrack>(
  tracks: T[],
  intent: EditorialIntentVector,
  plan: SubSceneRetrievalPlan,
): T[] {
  if (plan.kind === "none" || plan.reservedNeighbourhoodSeats <= 0) return [];
  const energyHi = plan.energyHi ?? Math.max(intent.energyRange[1], 0.58);
  const pool = tracks.filter((t) => isElectronicNeighbourhoodCandidate(t, energyHi));
  const ranked = rankCandidatesByIntentVector(pool, intent);
  // Prefer true electronic family, then lower energy, then score.
  // Soft remnant electronic must beat mid-energy indie that merely fits the world.
  const ordered = ranked
    .slice()
    .sort((a, b) => {
      const ae = trackFamily(a.track) === "electronic" ? 1 : 0;
      const be = trackFamily(b.track) === "electronic" ? 1 : 0;
      if (ae !== be) return be - ae;
      const energyDelta = feature(a.track.energy, 1) - feature(b.track.energy, 1);
      if (Math.abs(energyDelta) > 0.04) return energyDelta;
      return b.score - a.score;
    });
  return ordered.slice(0, plan.reservedNeighbourhoodSeats).map((row) => row.track);
}

/**
 * Guarantee better comedown candidates reach the sampler universe without
 * merely dumping more random tracks.
 */
export function mergeSubSceneIntoSamplerSelection<T extends IntentCollapseTrack>(
  selection: RankedCandidateSelection<T>,
  neighbourhood: T[],
  intent: EditorialIntentVector,
  plan: SubSceneRetrievalPlan,
): RankedCandidateSelection<T> {
  if (plan.kind === "none" || neighbourhood.length === 0) return selection;

  const merged = new Map<string, { track: T; score: number }>();
  for (const track of selection.selected) {
    merged.set(track.trackId, {
      track,
      score: selection.scores.get(track.trackId) ?? scoreEditorialIntentMatch(track, intent),
    });
  }

  let injected = 0;
  const injectBudget = Math.min(plan.reservedNeighbourhoodSeats, neighbourhood.length);
  const energyHi = plan.energyHi ?? intent.energyRange[1];
  for (const track of neighbourhood) {
    if (injected >= injectBudget) break;
    let score = scoreEditorialIntentMatch(track, intent);
    // Reserved remnant seats: keep soft-band tracks texture admitted even when
    // a calm world hard-zero would otherwise delete them before the sampler.
    if (score <= 0) {
      const energy = feature(track.energy, 1);
      if (energy <= energyHi + 0.02) score = 0.42;
      else continue;
    }
    // Prefer soft remnants over generic world survivors in ranking.
    const softBoost = clamp01(1 - feature(track.energy, 1)) * 0.12;
    const boosted = clamp01(Math.max(score, 0.48) + softBoost);
    if (!merged.has(track.trackId)) {
      merged.set(track.trackId, { track, score: boosted });
      injected += 1;
    } else {
      const existing = merged.get(track.trackId)!;
      existing.score = Math.max(existing.score, boosted);
    }
  }

  if (injected === 0) return selection;

  const rows = [...merged.values()].sort((a, b) => b.score - a.score);
  return {
    selected: rows.map((row) => row.track),
    scores: new Map(rows.map((row) => [row.track.trackId, row.score])),
    avgScore: rows.length > 0 ? rows.reduce((sum, row) => sum + row.score, 0) / rows.length : 0,
    minScoreUsed: selection.minScoreUsed,
    rankedTotal: Math.max(selection.rankedTotal, rows.length),
  };
}

/**
 * When soft remnant supply exists, prefer it as the sampler universe core so
 * later lanes do not drown comedown in peak electronic that merely matched
 * the locked electronic family.
 */
export function preferSubSceneSoftUniverse<T extends IntentCollapseTrack>(
  selection: RankedCandidateSelection<T>,
  plan: SubSceneRetrievalPlan,
  targetCount: number,
): RankedCandidateSelection<T> {
  if (plan.kind !== "soft_electronic_aftermath") return selection;
  const energyHi = plan.energyHi ?? 0.62;
  const soft = selection.selected
    .filter((t) => feature(t.energy, 1) <= energyHi)
    .sort((a, b) => feature(a.energy, 1) - feature(b.energy, 1));
  // Activate with modest soft supply — comedown libraries are often thin.
  if (soft.length < 4) return selection;

  const peakBudget =
    soft.length >= Math.max(16, Math.ceil(targetCount * 0.9))
      ? 0
      : Math.max(2, Math.ceil(targetCount * 0.12));
  const peak = selection.selected
    .filter((t) => feature(t.energy, 1) > energyHi)
    .sort((a, b) => feature(a.energy, 1) - feature(b.energy, 1))
    .slice(0, peakBudget);
  const ordered = [...soft, ...peak];
  const scores = new Map(
    ordered.map((track) => [
      track.trackId,
      Math.max(selection.scores.get(track.trackId) ?? 0.4, feature(track.energy, 1) <= energyHi ? 0.55 : 0.35),
    ]),
  );
  return {
    selected: ordered,
    scores,
    avgScore: ordered.length
      ? ordered.reduce((sum, track) => sum + (scores.get(track.trackId) ?? 0), 0) / ordered.length
      : 0,
    minScoreUsed: selection.minScoreUsed,
    rankedTotal: Math.max(selection.rankedTotal, ordered.length),
  };
}
