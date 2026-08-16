/**
 * V40 — Contract-authoritative retrieval when world gate defers hard lock.
 *
 * For deferred prompts ONLY: candidate selection follows PlaylistContract,
 * not CommittedWorld.id / world-shaped retrieval profile.
 */

import type { EmotionProfile } from "../../lib/emotion";
import { parsePromptNegationEnforcement, trackViolatesPromptNegation } from "../../lib/prompt-negation-enforcement";
import type { ActivityClassificationInput } from "../../lib/activity-profiles";
import {
  scoreTrackAgainstContract,
  type ContractRetrievalTrack,
} from "./constraint-aware-retrieval";
import { buildContractCompositionMeta, CONTRACT_AXIS_ACTIVATION_THRESHOLD, scoreContractDimension } from "./contract-axis-scoring";
import { compoundPartnerFloor, passesCompoundRetrievalEligibility } from "./contract-compound-eligibility";
import { computeCompoundIntentScore } from "./contract-composition-select";
import type { ContractCompositionMeta } from "./contract-composition-types";
import type { ContractTension, PlaylistContract } from "./types";

export type ContractAuthoritativeTrack = ContractRetrievalTrack & {
  acousticness?: number | null;
  instrumentalness?: number | null;
  danceability?: number | null;
  albumName?: string | null;
};

export type ContractAuthoritativeDiagnostics = {
  pipeline: "v40_contract_authoritative";
  worldAuthorityUsed: false;
  contractAuthorityUsed: true;
  inputCount: number;
  eligibleAfterHardFilters: number;
  outputCount: number;
  cap: number;
  genreExpectationsSource: "contract";
  genreExpectations: string[];
  hardFilters: string[];
  rankingSignals: string[];
  unavailableSignals: string[];
  tensionPreservation: Array<{
    description: string;
    resolution: string;
    axisPoolSizes: Record<string, number>;
    bothAxisPoolSize: number;
  }>;
  contractPoolStats: {
    admissible: number;
    avgContractScore: number;
    mustNotRejected: number;
  };
  informationLostBeforeRetrieval: string[];
};

const GENRE_FAMILY_MAP: Record<string, string[]> = {
  deep_house: ["house", "electronic"],
  house: ["house", "electronic"],
  dnb: ["electronic", "drum_and_bass"],
  drum_and_bass: ["electronic", "drum_and_bass"],
  grime: ["grime", "hip_hop", "electronic"],
  reggae: ["reggae", "world"],
  soul: ["soul", "rnb", "funk"],
  rock: ["rock", "metal"],
  pop_punk: ["rock", "indie", "punk"],
  punk: ["rock", "punk", "indie"],
  techno: ["electronic", "techno"],
  lofi: ["indie", "electronic", "lofi"],
  lofi_indie: ["indie", "electronic", "lofi"],
  disco: ["disco", "funk", "soul", "pop"],
  country: ["country", "folk"],
  jazz: ["jazz", "soul"],
  indie: ["indie", "alternative"],
  electronic: ["electronic"],
  hip_hop: ["hip_hop", "rap"],
  pop: ["pop"],
  synth_pop: ["pop", "electronic"],
  synthpop: ["pop", "electronic"],
};

const STRONG_MUST_CONFIDENCE = 0.62;

function contractGenreExpectations(contract: PlaylistContract): string[] {
  const families = new Set<string>();
  for (const g of contract.must.genres) {
    const token = g.value.toLowerCase().replace(/[\s-]+/g, "_");
    for (const f of GENRE_FAMILY_MAP[token] ?? [g.family ?? token.replace(/_/g, "")]) {
      families.add(f);
    }
  }
  if (families.size === 0) {
    for (const t of contract.tension) {
      if (t.axes.includes("party_energy")) {
        families.add("pop");
        families.add("electronic");
      }
      if (t.axes.includes("high_energy")) {
        families.add("electronic");
        families.add("rock");
      }
    }
    for (const m of contract.prefer.moods) {
      const mood = m.value.toLowerCase();
      if (/sad|melanchol|heartbreak/.test(mood)) families.add("pop");
      if (/chill|calm|relaxed/.test(mood)) families.add("electronic");
    }
  }
  return [...families];
}

function scoreTensionAxis(track: ContractAuthoritativeTrack, axis: string): number {
  return scoreContractDimension(track, axis, null);
}

function scorePreserveBoth(track: ContractAuthoritativeTrack, tension: ContractTension): number {
  if (tension.resolution !== "preserve_both") return 0;
  const [a, b] = tension.axes;
  const sa = scoreTensionAxis(track, a);
  const sb = scoreTensionAxis(track, b);
  return Math.sqrt(sa * sb) * 0.65 + (sa + sb) * 0.175;
}

function matchesGenreFamily(
  classification: ActivityClassificationInput,
  track: ContractAuthoritativeTrack,
  family: string,
): boolean {
  const norm = family.replace(/_/g, " ");
  const clsFamily = (classification?.genreFamily ?? track.genreFamily ?? "").toLowerCase();
  const clsPrimary = (classification?.genrePrimary ?? "").toLowerCase();
  if (clsFamily.includes(family) || clsPrimary.includes(norm.replace(/ /g, ""))) return true;
  const subGenres = classification?.subGenres ?? track.genres ?? [];
  if (subGenres.some((g) => g.toLowerCase().includes(norm))) return true;
  // Title/artist text is weak evidence — do not treat as genre identity alone.
  return false;
}

function toContractTrack<T extends ContractAuthoritativeTrack>(
  track: T,
  classification: ActivityClassificationInput,
): ContractAuthoritativeTrack {
  return {
    trackId: track.trackId,
    trackName: track.trackName,
    artistName: track.artistName,
    genreFamily: classification?.genreFamily ?? track.genreFamily ?? null,
    genres: classification?.subGenres ?? track.genres ?? null,
    energy: track.energy,
    valence: track.valence,
    releaseYear: track.releaseYear,
    acousticness: track.acousticness,
    instrumentalness: track.instrumentalness,
    danceability: track.danceability,
    albumName: track.albumName,
  };
}

function rankAxisTracks<T extends ContractAuthoritativeTrack>(
  eligible: T[],
  axis: string,
  classMap: Map<string, ActivityClassificationInput>,
): Array<{ track: T; score: number }> {
  const ranked = eligible
    .map((track) => ({
      track,
      score: scoreTensionAxis(toContractTrack(track, classMap.get(track.trackId) ?? null), axis),
    }))
    .sort((a, b) => b.score - a.score);
  const activated = ranked.filter((row) => row.score >= CONTRACT_AXIS_ACTIVATION_THRESHOLD);
  const remainder = ranked.filter((row) => row.score < CONTRACT_AXIS_ACTIVATION_THRESHOLD);
  return [...activated, ...remainder];
}

/** V44 — rank by compound intent with partner-axis floor so single-axis spam cannot fill quotas. */
function rankCompoundAxisTracks<T extends ContractAuthoritativeTrack>(
  eligible: T[],
  axis: string,
  partnerAxis: string,
  contract: PlaylistContract,
  classMap: Map<string, ActivityClassificationInput>,
  partnerFloor = compoundPartnerFloor(partnerAxis),
): Array<{ track: T; score: number; compound: number }> {
  return eligible
    .map((track) => {
      const classification = classMap.get(track.trackId) ?? null;
      const ct = toContractTrack(track, classification);
      const meta = buildContractCompositionMeta(ct, contract, classification);
      const sa = meta.axisScores[axis] ?? 0;
      const sb = meta.axisScores[partnerAxis] ?? 0;
      if (sa < CONTRACT_AXIS_ACTIVATION_THRESHOLD || sb < partnerFloor) return null;
      const compound = computeCompoundIntentScore(meta, contract);
      return { track, score: compound, compound };
    })
    .filter((row): row is { track: T; score: number; compound: number } => row != null)
    .sort((a, b) => b.compound - a.compound);
}

function rankCompoundTensionTracks<T extends ContractAuthoritativeTrack>(
  eligible: T[],
  contract: PlaylistContract,
  classMap: Map<string, ActivityClassificationInput>,
): Array<{ track: T; compound: number; meta: ContractCompositionMeta }> {
  return eligible
    .map((track) => {
      const classification = classMap.get(track.trackId) ?? null;
      const ct = toContractTrack(track, classification);
      const meta = buildContractCompositionMeta(ct, contract, classification);
      return { track, compound: computeCompoundIntentScore(meta, contract), meta };
    })
    .sort((a, b) => b.compound - a.compound);
}

export function retrieveContractAuthoritativePool<T extends ContractAuthoritativeTrack>(input: {
  tracks: T[];
  contract: PlaylistContract;
  classMap: Map<string, ActivityClassificationInput>;
  emotionProfile: EmotionProfile;
  vibe: string;
  broadCap: number;
}): { tracks: T[]; diagnostics: ContractAuthoritativeDiagnostics } {
  const { tracks, contract, classMap, emotionProfile, broadCap } = input;
  const negProfile = parsePromptNegationEnforcement(contract.prompt);
  const genreExpectations = contractGenreExpectations(contract);
  const hardFilters: string[] = ["prompt_negation"];
  const rankingSignals = ["contract_score", "emotion_fit"];
  const unavailable: string[] = [];
  const infoLost: string[] = [];

  if (contract.worldHypothesis.id) {
    infoLost.push(`world_id_not_used_as_authority:${contract.worldHypothesis.id}`);
  }

  const strongMustGenres = contract.must.genres.filter((g) => g.confidence >= STRONG_MUST_CONFIDENCE);
  let eligible: T[] = [];
  let mustNotRejected = 0;

  for (const track of tracks) {
    const classification = classMap.get(track.trackId) ?? null;
    const negViolation = trackViolatesPromptNegation(
      {
        trackName: track.trackName,
        artistName: track.artistName,
        albumName: track.albumName,
        genreFamily: classification?.genreFamily ?? null,
        genrePrimary: classification?.genrePrimary ?? null,
        genres: classification?.subGenres ?? null,
        acousticness: track.acousticness ?? null,
        instrumentalness: track.instrumentalness ?? null,
      },
      negProfile,
    );
    if (negViolation) {
      mustNotRejected += 1;
      continue;
    }
    const ct = toContractTrack(track, classification);
    const scored = scoreTrackAgainstContract(ct, contract);
    if (!scored.admissible) {
      mustNotRejected += 1;
      continue;
    }
    eligible.push(track);
  }

  if (strongMustGenres.length > 0 && genreExpectations.length > 0) {
    const genreFiltered = eligible.filter((track) => {
      const classification = classMap.get(track.trackId) ?? null;
      return genreExpectations.some((f) => matchesGenreFamily(classification, track, f));
    });
    if (genreFiltered.length >= Math.max(40, Math.floor(broadCap * 0.35))) {
      eligible = genreFiltered;
      hardFilters.push("must_genre");
    } else {
      rankingSignals.push("must_genre_soft");
      unavailable.push("must_genre_hard_filter_insufficient_supply");
    }
  }

  const preserveBoth = contract.tension.filter((t) => t.resolution === "preserve_both");
  if (preserveBoth.length > 0) rankingSignals.push("tension_preserve_both");

  type Scored = { track: T; score: number; contractScore: number; tensionScore: number; compound: number };
  const scoredRows: Scored[] = eligible.map((track) => {
    const classification = classMap.get(track.trackId) ?? null;
    const ct = toContractTrack(track, classification);
    const contractScore = scoreTrackAgainstContract(ct, contract).score;
    const meta = buildContractCompositionMeta(ct, contract, classification);
    const compound = computeCompoundIntentScore(meta, contract);
    let tensionScore = 0;
    for (const t of preserveBoth) tensionScore = Math.max(tensionScore, scorePreserveBoth(ct, t));
    const e = track.energy ?? 0.5;
    const v = track.valence ?? 0.5;
    const emotionFit = Math.max(0, 1 - (Math.abs(e - emotionProfile.energy) + Math.abs(v - emotionProfile.valence)) / 2);
    let genreBoost = 0;
    if (genreExpectations.length > 0) {
      genreBoost = genreExpectations.some((f) => matchesGenreFamily(classification, track, f)) ? 0.12 : 0;
    }
    const score =
      contractScore * 0.24 +
      compound * (preserveBoth.length > 0 ? 0.46 : 0.22) +
      tensionScore * (preserveBoth.length > 0 ? 0.12 : 0) +
      emotionFit * 0.1 +
      genreBoost;
    return { track, score, contractScore, tensionScore, compound };
  });

  scoredRows.sort((a, b) => b.score - a.score);

  const merged: T[] = [];
  const seen = new Set<string>();
  const tensionPreservation: ContractAuthoritativeDiagnostics["tensionPreservation"] = [];

  if (preserveBoth.length > 0) {
    rankingSignals.push("compound_tension_pool_v44");
    for (const tension of preserveBoth) {
      const [axisA, axisB] = tension.axes;
      const axisPoolSizes: Record<string, number> = { [axisA]: 0, [axisB]: 0 };
      let bothCount = 0;
      const quota = Math.floor(broadCap * 0.32);
      const compoundRank = rankCompoundTensionTracks(eligible, contract, classMap);
      const axisRankA = rankCompoundAxisTracks(eligible, axisA, axisB, contract, classMap);
      const axisRankB = rankCompoundAxisTracks(eligible, axisB, axisA, contract, classMap);
      const bothRank = compoundRank.filter((row) => {
        const sa = row.meta.axisScores[axisA] ?? 0;
        const sb = row.meta.axisScores[axisB] ?? 0;
        return (
          row.meta.intersectionStrength >= 0.32 &&
          sa >= CONTRACT_AXIS_ACTIVATION_THRESHOLD &&
          sb >= CONTRACT_AXIS_ACTIVATION_THRESHOLD
        );
      });

      for (const row of bothRank.slice(0, quota)) {
        if (seen.has(row.track.trackId)) continue;
        seen.add(row.track.trackId);
        merged.push(row.track);
        bothCount += 1;
      }
      for (const row of axisRankA.slice(0, quota)) {
        if (seen.has(row.track.trackId)) continue;
        seen.add(row.track.trackId);
        merged.push(row.track);
        axisPoolSizes[axisA] = (axisPoolSizes[axisA] ?? 0) + 1;
      }
      for (const row of axisRankB.slice(0, quota)) {
        if (seen.has(row.track.trackId)) continue;
        seen.add(row.track.trackId);
        merged.push(row.track);
        axisPoolSizes[axisB] = (axisPoolSizes[axisB] ?? 0) + 1;
      }
      tensionPreservation.push({
        description: tension.description,
        resolution: tension.resolution,
        axisPoolSizes,
        bothAxisPoolSize: bothCount,
      });
    }
    for (const row of scoredRows) {
      if (merged.length >= broadCap) break;
      if (seen.has(row.track.trackId)) continue;
      const classification = classMap.get(row.track.trackId) ?? null;
      const ct = toContractTrack(row.track, classification);
      const meta = buildContractCompositionMeta(ct, contract, classification);
      if (!passesCompoundRetrievalEligibility(meta, contract)) continue;
      seen.add(row.track.trackId);
      merged.push(row.track);
    }
  } else {
    for (const row of scoredRows) {
      if (merged.length >= broadCap) break;
      merged.push(row.track);
    }
  }

  const output = merged.slice(0, broadCap).map((track) => {
    const classification = classMap.get(track.trackId) ?? null;
    const ct = toContractTrack(track, classification);
    const meta = buildContractCompositionMeta(ct, contract, classification);
    return Object.assign(track, { contractCompositionMeta: meta }) as T & {
      contractCompositionMeta: ContractCompositionMeta;
    };
  });
  const admissibleScores = scoredRows.map((r) => r.contractScore);
  return {
    tracks: output,
    diagnostics: {
      pipeline: "v40_contract_authoritative",
      worldAuthorityUsed: false,
      contractAuthorityUsed: true,
      inputCount: tracks.length,
      eligibleAfterHardFilters: eligible.length,
      outputCount: output.length,
      cap: broadCap,
      genreExpectationsSource: "contract",
      genreExpectations,
      hardFilters,
      rankingSignals,
      unavailableSignals: unavailable,
      tensionPreservation,
      contractPoolStats: {
        admissible: eligible.length,
        avgContractScore: admissibleScores.length
          ? admissibleScores.reduce((s, v) => s + v, 0) / admissibleScores.length
          : 0,
        mustNotRejected,
      },
      informationLostBeforeRetrieval: infoLost,
    },
  };
}
