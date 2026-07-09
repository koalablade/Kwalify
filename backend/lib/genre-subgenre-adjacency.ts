/**
 * Taxonomy-backed adjacent/sibling subgenre graph for genre evidence guard.
 * Accepts adjacent/sibling subgenres only when family evidence is strong (enforced by caller).
 *
 * Structure per locked subgenre:
 *   canonical → adjacent (curated editorial siblings) → siblings (taxonomy co-family)
 *   explicitly excluded subgenres never qualify even if family matches.
 */
import { GENRE_FAMILIES } from "./genre-taxonomy-data";

export function normalizeSubgenreTerm(term: string): string {
  return term.toLowerCase().replace(/^genre:/, "").replace(/&/g, "and").replace(/[\s-]+/g, "_");
}

export type SubgenreIntentContext = {
  primarySubgenre: string | null;
  secondarySubgenre: string | null;
  subgenreTerms: string[];
  genreFamilies: string[];
};

export type SubgenreEvidenceGraph = {
  lockedTerms: string[];
  canonical: string[];
  adjacent: string[];
  siblings: string[];
  excluded: string[];
  /** Union used for track matching (canonical + adjacent + siblings, minus excluded). */
  acceptable: string[];
};

/**
 * Curated adjacency edges — editorial siblings, not global genre relaxation.
 */
export const CURATED_SUBGENRE_ADJACENCY: Record<string, readonly string[]> = {
  disco: ["funk", "motown", "boogie", "p_funk", "disco_funk"],
  funk: ["disco", "motown", "boogie", "p_funk"],
  motown: ["disco", "funk", "soul"],

  uk_garage: ["2_step", "two_step", "two_step_garage", "speed_garage", "garage_beat", "ukg", "breakbeat"],
  speed_garage: ["uk_garage", "2_step", "garage_beat", "breakbeat"],
  "2_step": ["uk_garage", "speed_garage", "garage_beat"],
  garage_beat: ["uk_garage", "speed_garage", "2_step"],

  pop_punk: ["punk", "punk_rock", "emo", "skate_punk", "post_hardcore", "melodic_hardcore", "mall_punk"],
  emo: ["pop_punk", "punk", "post_hardcore", "screamo"],
  punk: ["pop_punk", "punk_rock", "emo", "post_hardcore", "skate_punk"],
  punk_rock: ["pop_punk", "punk", "skate_punk"],
  post_hardcore: ["emo", "pop_punk", "punk", "screamo"],
  skate_punk: ["pop_punk", "punk", "punk_rock"],
  melodic_hardcore: ["pop_punk", "post_hardcore", "emo"],

  rave: ["hard_techno", "techno", "hardgroove", "schranz", "peak_time_techno", "jungle", "trance", "hard_trance", "breakbeat"],
  hard_techno: ["rave", "techno", "schranz", "hardgroove", "tekk", "tekno"],
  schranz: ["hard_techno", "rave", "hardgroove"],
  hardgroove: ["hard_techno", "rave", "schranz"],
  peak_time_techno: ["rave", "hard_techno", "techno"],
  jungle: ["rave", "dnb", "breakbeat", "uk_garage"],
  breakbeat: ["jungle", "rave", "dnb", "uk_garage", "2_step", "speed_garage"],
  house: ["techno", "uk_garage"],
  techno: ["house", "hard_techno", "rave"],
  trance: ["rave", "hard_trance", "techno"],
};

/** Subgenres that must never qualify via adjacency for a locked intent subgenre. */
export const SUBGENRE_EVIDENCE_EXCLUSIONS: Record<string, readonly string[]> = {
  uk_garage: ["country", "folk_country", "modern_country", "classic_rock", "pop", "latin", "jazz", "soul", "folk"],
  pop_punk: ["country", "folk_country", "modern_country", "latin", "jazz", "soul", "electronic", "hip_hop", "classical"],
  rave: ["country", "folk_country", "pop", "latin", "jazz", "soul", "folk", "classical"],
  disco: ["country", "folk_country", "electronic", "metal", "classical"],
  hard_techno: ["country", "folk_country", "pop", "latin", "jazz", "folk"],
};

function explicitLockedSubgenreTerms(intent: SubgenreIntentContext): string[] {
  return [
    intent.primarySubgenre,
    intent.secondarySubgenre,
    ...intent.subgenreTerms,
  ]
    .filter((term): term is string => !!term && term.trim().length > 0)
    .map(normalizeSubgenreTerm)
    .filter((term, index, terms) => terms.indexOf(term) === index);
}

/** Subgenre ids co-located under the same taxonomy family as the locked subgenre. */
export function taxonomySiblingSubgenreIds(
  lockedSubgenre: string,
  genreFamilies: string[],
): string[] {
  const normalized = normalizeSubgenreTerm(lockedSubgenre);
  const families = new Set(genreFamilies.map((f) => f.toLowerCase()));
  const siblings = new Set<string>();

  for (const familyDef of GENRE_FAMILIES) {
    if (families.size > 0 && !families.has(familyDef.family)) continue;
    const contains = familyDef.subgenres.some((s) => normalizeSubgenreTerm(s.id) === normalized);
    if (!contains) continue;
    for (const sub of familyDef.subgenres) {
      const id = normalizeSubgenreTerm(sub.id);
      if (id !== normalized) siblings.add(id);
      for (const micro of sub.microStyles) {
        siblings.add(normalizeSubgenreTerm(micro));
      }
    }
  }
  return [...siblings];
}

function curatedReachableFrom(term: string): Set<string> {
  const out = new Set<string>();
  const queue = [normalizeSubgenreTerm(term)];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const adj of CURATED_SUBGENRE_ADJACENCY[current] ?? []) {
      const norm = normalizeSubgenreTerm(adj);
      if (!out.has(norm)) {
        out.add(norm);
        queue.push(norm);
      }
    }
  }
  return out;
}

function isTaxonomySiblingEligible(locked: string, sibling: string): boolean {
  const sibNorm = normalizeSubgenreTerm(sibling);
  const reachable = curatedReachableFrom(locked);
  if (reachable.has(sibNorm)) return true;
  const reverseReachable = Object.entries(CURATED_SUBGENRE_ADJACENCY).some(([key, vals]) =>
    key === sibNorm && vals.some((v) => normalizeSubgenreTerm(v) === locked),
  );
  if (reverseReachable) return true;
  // Same microStyle cluster: sibling shares a curated edge with any reachable node
  for (const node of reachable) {
    if ((CURATED_SUBGENRE_ADJACENCY[node] ?? []).some((v) => normalizeSubgenreTerm(v) === sibNorm)) return true;
  }
  return false;
}

export function excludedSubgenreTermsForIntent(intent: SubgenreIntentContext): string[] {
  const locked = explicitLockedSubgenreTerms(intent);
  const out = new Set<string>();
  for (const term of locked) {
    for (const ex of SUBGENRE_EVIDENCE_EXCLUSIONS[term] ?? []) {
      out.add(normalizeSubgenreTerm(ex));
    }
  }
  return [...out];
}

/** Full evidence graph for an intent — used by genre evidence guard and diagnostics. */
export function buildSubgenreEvidenceGraph(intent: SubgenreIntentContext): SubgenreEvidenceGraph {
  const locked = explicitLockedSubgenreTerms(intent);
  const canonical = [...locked];
  const adjacent = new Set<string>();
  const siblings = new Set<string>();
  const excluded = new Set(excludedSubgenreTermsForIntent(intent));

  for (const term of locked) {
    for (const adj of CURATED_SUBGENRE_ADJACENCY[term] ?? []) {
      adjacent.add(normalizeSubgenreTerm(adj));
    }
    for (const sib of taxonomySiblingSubgenreIds(term, intent.genreFamilies)) {
      if (isTaxonomySiblingEligible(term, sib)) {
        siblings.add(normalizeSubgenreTerm(sib));
      }
    }
  }

  const acceptable = new Set<string>([...canonical, ...adjacent, ...siblings]);
  for (const ex of excluded) acceptable.delete(ex);
  for (const term of locked) acceptable.delete(term);

  return {
    lockedTerms: locked,
    canonical,
    adjacent: [...adjacent],
    siblings: [...siblings],
    excluded: [...excluded],
    acceptable: [...acceptable],
  };
}

/** Union of curated adjacent + taxonomy siblings (legacy export). */
export function adjacentSubgenreTermsForIntent(intent: SubgenreIntentContext): string[] {
  return buildSubgenreEvidenceGraph(intent).acceptable;
}

export function trackTermsMatchSubgenreList(trackTerms: string[], candidates: string[]): boolean {
  const normalized = trackTerms.map(normalizeSubgenreTerm);
  return candidates.some((candidate) =>
    normalized.some((term) => term === candidate || term.includes(candidate) || candidate.includes(term)),
  );
}

export function trackSubgenreIsExplicitlyExcluded(
  trackTerms: string[],
  intent: SubgenreIntentContext,
): boolean {
  const excluded = excludedSubgenreTermsForIntent(intent);
  if (excluded.length === 0) return false;
  const normalized = trackTerms.map(normalizeSubgenreTerm);
  return excluded.some((ex) =>
    normalized.some((term) => term === ex || term.includes(ex) || ex.includes(term)),
  );
}

export function trackMatchesAdjacentSubgenreEvidence(
  trackTerms: string[],
  intent: SubgenreIntentContext,
): boolean {
  if (trackSubgenreIsExplicitlyExcluded(trackTerms, intent)) return false;
  const graph = buildSubgenreEvidenceGraph(intent);
  if (graph.acceptable.length === 0) return false;
  return trackTermsMatchSubgenreList(trackTerms, graph.acceptable);
}
