/**
 * Constraint-aware retrieval — scores tracks against PlaylistContract.
 * Feature-flagged prototype; does NOT replace V37 retrieval when flag off.
 */

import { parsePromptNegationEnforcement, trackMatchesExcludedArtist } from "../../lib/prompt-negation-enforcement";
import type { PlaylistContract } from "./types";

export type ContractRetrievalTrack = {
  trackId: string;
  trackName?: string | null;
  artistName?: string | null;
  genreFamily?: string | null;
  genres?: string[] | null;
  energy?: number | null;
  valence?: number | null;
  releaseYear?: number | null;
};

export type ContractRetrievalScore = {
  trackId: string;
  score: number;
  admissible: boolean;
  violations: string[];
  satisfies: string[];
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function trackText(track: ContractRetrievalTrack): string {
  return normalize(
    [track.trackName, track.artistName, track.genreFamily, ...(track.genres ?? [])]
      .filter(Boolean)
      .join(" "),
  );
}

function matchesGenreFamily(track: ContractRetrievalTrack, family: string): boolean {
  const text = trackText(track);
  const norm = family.replace(/_/g, " ");
  return text.includes(norm) || (track.genreFamily ?? "").toLowerCase().includes(family);
}

function matchesNegation(track: ContractRetrievalTrack, negValue: string, kind: string): boolean {
  const text = trackText(track);
  if (kind === "seasonal" && negValue === "christmas") {
    return /\bchristmas|xmas|noel|santa|jingle|festive|holiday song\b/.test(text);
  }
  if (kind === "genre" && (negValue === "rap" || negValue === "hip_hop")) {
    return /\brap|hip hop|trap|drill|grime\b/.test(text);
  }
  if (kind === "attribute" && negValue === "cheesy") {
    return /\bcheesy|cheesey|novelty|eurovision|abba\b/.test(text);
  }
  if (kind === "attribute" && negValue === "boring") {
    return track.energy != null && track.energy < 0.25 && (track.valence ?? 0.5) < 0.35;
  }
  return text.includes(negValue.replace(/_/g, " "));
}

export function scoreTrackAgainstContract(
  track: ContractRetrievalTrack,
  contract: PlaylistContract,
): ContractRetrievalScore {
  const violations: string[] = [];
  const satisfies: string[] = [];
  let score = 0.5;

  for (const neg of contract.mustNot.filter((n) => n.hard)) {
    if (neg.kind === "artist") {
      if (trackMatchesExcludedArtist(track.artistName, [neg.value])) {
        violations.push(`MUST_NOT artist: ${neg.value}`);
        return { trackId: track.trackId, score: 0, admissible: false, violations, satisfies };
      }
    } else if (matchesNegation(track, neg.value, neg.kind)) {
      violations.push(`MUST_NOT ${neg.kind}: ${neg.value}`);
      return { trackId: track.trackId, score: 0, admissible: false, violations, satisfies };
    }
  }

  for (const genre of contract.must.genres) {
    if (matchesGenreFamily(track, genre.family ?? genre.value)) {
      satisfies.push(`MUST genre: ${genre.value}`);
      score += 0.15 * genre.confidence;
    }
  }

  for (const era of contract.must.eras) {
    const decade = parseInt(era.value.replace(/\D/g, ""), 10);
    if (track.releaseYear && decade && Math.abs(track.releaseYear - decade) < 15) {
      satisfies.push(`MUST era: ${era.value}`);
      score += 0.1 * era.confidence;
    }
  }

  const energyPref = contract.prefer.energy[0];
  if (energyPref && track.energy != null) {
    const min = energyPref.min ?? 0;
    const max = energyPref.max ?? 1;
    if (track.energy >= min && track.energy <= max) {
      satisfies.push(`PREFER energy: ${energyPref.value}`);
      score += 0.12;
    } else {
      violations.push(`energy ${track.energy.toFixed(2)} outside ${energyPref.value} band`);
      score -= 0.08;
    }
  }

  for (const neg of contract.mustNot.filter((n) => !n.hard)) {
    if (matchesNegation(track, neg.value, neg.kind)) {
      violations.push(`soft MUST_NOT: ${neg.value}`);
      score -= 0.15 * neg.confidence;
    }
  }

  score = Math.max(0, Math.min(1, score));
  return {
    trackId: track.trackId,
    score,
    admissible: violations.filter((v) => v.startsWith("MUST_NOT")).length === 0,
    violations,
    satisfies,
  };
}

export function rankTracksByContract<T extends ContractRetrievalTrack>(
  tracks: T[],
  contract: PlaylistContract,
  topN?: number,
): Array<T & { contractScore: ContractRetrievalScore }> {
  const negProfile = parsePromptNegationEnforcement(contract.prompt);
  const scored = tracks.map((track) => {
    const contractScore = scoreTrackAgainstContract(track, contract);
    if (negProfile.excludedArtists.length && trackMatchesExcludedArtist(track.artistName, negProfile.excludedArtists)) {
      contractScore.admissible = false;
      contractScore.score = 0;
      contractScore.violations.push("excluded artist");
    }
    return { ...track, contractScore };
  });
  scored.sort((a, b) => b.contractScore.score - a.contractScore.score);
  return topN ? scored.slice(0, topN) : scored;
}

export function contractRetrievalPoolStats(
  tracks: ContractRetrievalTrack[],
  contract: PlaylistContract,
): {
  total: number;
  admissible: number;
  avgScore: number;
  mustViolations: number;
} {
  const scores = tracks.map((t) => scoreTrackAgainstContract(t, contract));
  const admissible = scores.filter((s) => s.admissible);
  return {
    total: tracks.length,
    admissible: admissible.length,
    avgScore: admissible.length
      ? admissible.reduce((sum, s) => sum + s.score, 0) / admissible.length
      : 0,
    mustViolations: scores.filter((s) => s.violations.some((v) => v.startsWith("MUST_NOT"))).length,
  };
}
