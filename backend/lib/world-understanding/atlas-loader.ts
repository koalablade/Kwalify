import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SemanticFingerprint, WorldConceptTaxonomy } from "./types";

/** Raw atlas JSON — V2 fields plus optional legacy V1 fields. */
export interface AtlasEntryRaw {
  id: string;
  domain: string;
  name?: string;
  label?: string;
  description?: string;
  human_meaning?: string;
  emotional_states?: string[];
  hidden_emotions?: string[];
  sensory_details?: string[];
  environment?: string[];
  activity?: string[];
  time_context?: string[];
  weather_context?: string[];
  social_context?: string[];
  energy_curve?: string;
  emotional_arc?: string;
  musical_behaviours?: string[];
  related_experiences?: string[];
  common_phrases?: string[];
  hidden_context?: string;
  environments?: string[];
  before_state?: string;
  during_state?: string;
  after_state?: string;
  misleading_keywords?: string[];
  recognitionCues?: string[];
  physicalExperience?: string;
  emotionalExperience?: string;
  typicalThoughts?: string[];
  sensoryDetails?: string[];
  expectedEnergy?: string;
  musicalBehaviours?: string[];
  narrativeArc?: string;
  relatedExperiences?: string[];
  nearbyConcepts?: string[];
  playlistIntents?: string[];
  inferredQualities?: string[];
}

/** Normalized atlas entry — V2 primary, legacy fields preserved for compat. */
export interface AtlasEntry {
  id: string;
  domain: string;
  name: string;
  label: string;
  description: string;
  human_meaning: string;
  emotional_states: string[];
  hidden_emotions: string[];
  sensory_details: string[];
  environment: string[];
  activity: string[];
  time_context: string[];
  weather_context: string[];
  social_context: string[];
  energy_curve: string;
  emotional_arc: string;
  musical_behaviours: string[];
  related_experiences: string[];
  common_phrases: string[];
  hidden_context: string;
  before_state: string;
  during_state: string;
  after_state: string;
  misleading_keywords: string[];
  recognitionCues: string[];
  physicalExperience: string;
  emotionalExperience: string;
  typicalThoughts: string[];
  sensoryDetails: string[];
  expectedEnergy: string;
  musicalBehaviours: string[];
  narrativeArc: string;
  relatedExperiences: string[];
  nearbyConcepts: string[];
  playlistIntents?: string[];
  inferredQualities?: string[];
}

export interface AtlasConsultation {
  entryId: string;
  label: string;
  domain: string;
  matchScore: number;
  reason: string;
}

export interface MusicalBehaviourDef {
  id: string;
  label: string;
  description: string;
  energyRange: [number, number];
  textures: string[];
  valenceBias: number;
}

function resolveAtlasRoot(): string {
  return join(__dirname, "../../data/world-atlas");
}

function discoverEntryFiles(root: string): string[] {
  const files: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".json") && entry.name !== "musical-behaviours.json" && entry.name !== "experience-chains.json") {
        files.push(full);
      }
    }
  }
  walk(root);
  return files;
}

export function normalizeAtlasEntry(raw: AtlasEntryRaw): AtlasEntry {
  const name = raw.name ?? raw.label ?? raw.id.replace(/_/g, " ");
  const statePhrases = [raw.before_state, raw.during_state, raw.after_state].filter(
    (p): p is string => Boolean(p),
  );
  const commonPhrases = [
    ...(raw.common_phrases ?? []),
    ...(raw.recognitionCues ?? []),
    ...statePhrases,
  ].filter((p, i, arr) => arr.indexOf(p) === i);

  const sensory = raw.sensory_details ?? raw.sensoryDetails ?? [];
  const musical = raw.musical_behaviours ?? raw.musicalBehaviours ?? [];
  const related = raw.related_experiences ?? raw.relatedExperiences ?? [];
  const emotionalArc = raw.emotional_arc ?? raw.narrativeArc ?? "";
  const energyCurve = raw.energy_curve ?? raw.expectedEnergy ?? "medium";

  return {
    id: raw.id,
    domain: raw.domain,
    name,
    label: name,
    description: raw.description ?? raw.physicalExperience ?? raw.human_meaning ?? name,
    human_meaning:
      raw.human_meaning ??
      raw.emotionalExperience ??
      raw.physicalExperience ??
      name,
    emotional_states: raw.emotional_states ?? (raw.emotionalExperience ? [raw.emotionalExperience] : []),
    hidden_emotions: raw.hidden_emotions ?? [],
    sensory_details: sensory,
    environment: raw.environment ?? raw.environments ?? [],
    activity: raw.activity ?? [],
    time_context: raw.time_context ?? [],
    weather_context: raw.weather_context ?? [],
    social_context: raw.social_context ?? [],
    energy_curve: energyCurve,
    emotional_arc: emotionalArc,
    musical_behaviours: musical,
    related_experiences: related,
    common_phrases: commonPhrases,
    hidden_context: raw.hidden_context ?? "",
    before_state: raw.before_state ?? "",
    during_state: raw.during_state ?? "",
    after_state: raw.after_state ?? "",
    misleading_keywords: raw.misleading_keywords ?? [],
    recognitionCues: commonPhrases,
    physicalExperience: raw.physicalExperience ?? raw.description ?? "",
    emotionalExperience: raw.emotionalExperience ?? raw.human_meaning ?? "",
    typicalThoughts: raw.typicalThoughts ?? [],
    sensoryDetails: sensory,
    expectedEnergy: energyCurve,
    musicalBehaviours: musical,
    narrativeArc: emotionalArc,
    relatedExperiences: related,
    nearbyConcepts: raw.nearbyConcepts ?? [],
    playlistIntents: raw.playlistIntents,
    inferredQualities: raw.inferredQualities,
  };
}

function loadAtlasEntries(): AtlasEntry[] {
  const root = resolveAtlasRoot();
  const files = discoverEntryFiles(root);
  const entries: AtlasEntry[] = [];
  for (const file of files) {
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as AtlasEntryRaw;
      if (!raw.id || !raw.domain) continue;
      entries.push(normalizeAtlasEntry(raw));
    } catch {
      // skip malformed
    }
  }
  return entries;
}

function loadMusicalBehaviours(): MusicalBehaviourDef[] {
  const root = resolveAtlasRoot();
  try {
    const raw = JSON.parse(readFileSync(join(root, "musical-behaviours.json"), "utf8")) as {
      behaviours: MusicalBehaviourDef[];
    };
    return raw.behaviours ?? [];
  } catch {
    return [];
  }
}

export const ATLAS_ENTRIES: AtlasEntry[] = loadAtlasEntries();
export const MUSICAL_BEHAVIOUR_DEFS: MusicalBehaviourDef[] = loadMusicalBehaviours();

const ENTRY_BY_ID = new Map(ATLAS_ENTRIES.map((e) => [e.id, e]));

function tokenOverlap(text: string, cue: string): number {
  const cueTokens = cue.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const lower = text.toLowerCase();
  let hits = 0;
  for (const t of cueTokens) {
    if (lower.includes(t)) hits += 1;
  }
  return hits / Math.max(cueTokens.length, 1);
}

function countMisleadingDominance(prompt: string, entry: AtlasEntry): number {
  const lower = prompt.toLowerCase();
  let misleadingHits = 0;
  let phraseHits = 0;

  for (const kw of entry.misleading_keywords) {
    if (lower.includes(kw.toLowerCase())) misleadingHits += 1;
  }
  for (const phrase of entry.common_phrases) {
    if (lower.includes(phrase.toLowerCase())) phraseHits += 1;
  }

  if (misleadingHits === 0) return 0;
  if (phraseHits > 0) return 0;
  return misleadingHits * 0.35;
}

function scoreHumanMeaning(prompt: string, entry: AtlasEntry): { score: number; reason?: string } {
  const overlap = tokenOverlap(prompt, entry.human_meaning);
  if (overlap >= 0.35) {
    return { score: overlap * 0.3, reason: "human meaning" };
  }
  const lower = prompt.toLowerCase();
  const meaningTokens = entry.human_meaning.toLowerCase().split(/\s+/).filter((t) => t.length > 4);
  let hits = 0;
  for (const t of meaningTokens) {
    if (lower.includes(t)) hits += 1;
  }
  if (hits >= 2) {
    return { score: hits * 0.06, reason: "meaning overlap" };
  }
  return { score: 0 };
}

function scoreHiddenEmotions(prompt: string, fingerprint: SemanticFingerprint, entry: AtlasEntry): number {
  const lower = prompt.toLowerCase();
  let score = 0;
  for (const hidden of entry.hidden_emotions) {
    if (lower.includes(hidden.toLowerCase())) score += 0.12;
    if (fingerprint.emotionalSignals.some((e) => e.toLowerCase().includes(hidden.toLowerCase()))) {
      score += 0.08;
    }
  }
  return score;
}

function scoreRelatedChain(
  prompt: string,
  entry: AtlasEntry,
  allEntries: AtlasEntry[],
): { score: number; reason?: string } {
  const lower = prompt.toLowerCase();
  let score = 0;
  const reasons: string[] = [];

  for (const relatedId of entry.related_experiences) {
    const related = allEntries.find((e) => e.id === relatedId);
    if (!related) continue;
    for (const phrase of related.common_phrases.slice(0, 6)) {
      if (lower.includes(phrase.toLowerCase())) {
        score += 0.1;
        reasons.push(`chain ${related.name}`);
        break;
      }
    }
  }

  return { score, reason: reasons[0] };
}

function scoreEntry(
  prompt: string,
  fingerprint: SemanticFingerprint,
  entry: AtlasEntry,
  allEntries: AtlasEntry[],
): { score: number; reason: string } {
  const lower = prompt.toLowerCase();
  let score = 0;
  const reasons: string[] = [];

  for (const phrase of entry.common_phrases) {
    const phraseLower = phrase.toLowerCase();
    if (lower.includes(phraseLower)) {
      score += 0.5 + phraseLower.length / 180;
      reasons.push(`phrase "${phrase}"`);
    } else {
      const overlap = tokenOverlap(lower, phraseLower);
      if (overlap >= 0.65) {
        score += overlap * 0.28;
        reasons.push(`partial "${phrase}"`);
      }
    }
  }

  const meaning = scoreHumanMeaning(prompt, entry);
  score += meaning.score;
  if (meaning.reason) reasons.push(meaning.reason);

  score += scoreHiddenEmotions(prompt, fingerprint, entry);

  const chain = scoreRelatedChain(prompt, entry, allEntries);
  score += chain.score;
  if (chain.reason) reasons.push(chain.reason);

  for (const concept of entry.nearbyConcepts) {
    if (lower.includes(concept.toLowerCase())) {
      score += 0.07;
      reasons.push(`concept ${concept}`);
    }
  }

  const envBoost = entry.domain === "activities" ? 0.12 : 0.06;
  for (const env of entry.environment) {
    if (lower.includes(env.toLowerCase())) {
      score += envBoost;
      reasons.push(`environment ${env}`);
    }
  }

  const actBoost = entry.domain === "activities" ? 0.14 : 0.06;
  for (const act of entry.activity) {
    if (lower.includes(act.toLowerCase())) {
      score += actBoost;
      reasons.push(`activity ${act}`);
    }
  }

  if (entry.domain === "activities" && entry.hidden_context) {
    const hiddenOverlap = tokenOverlap(lower, entry.hidden_context);
    if (hiddenOverlap >= 0.25) {
      score += hiddenOverlap * 0.2;
      reasons.push("activity hidden context");
    }
  }

  for (const fp of fingerprint.physicalContext) {
    if (
      entry.label.toLowerCase().includes(fp.toLowerCase()) ||
      entry.physicalExperience.toLowerCase().includes(fp.toLowerCase()) ||
      entry.environment.some((e) => e.toLowerCase().includes(fp.toLowerCase()))
    ) {
      score += 0.09;
      reasons.push(`physical ${fp}`);
    }
  }

  for (const emo of fingerprint.emotionalSignals) {
    const emoLower = emo.toLowerCase();
    if (
      entry.emotionalExperience.toLowerCase().includes(emoLower) ||
      entry.emotional_states.some((s) => s.toLowerCase().includes(emoLower)) ||
      entry.hidden_emotions.some((s) => s.toLowerCase().includes(emoLower))
    ) {
      score += 0.07;
      reasons.push(`emotion ${emo}`);
    }
  }

  if (
    fingerprint.narrativeFrame &&
    entry.emotional_arc.toLowerCase().includes(fingerprint.narrativeFrame.replace(/_/g, " "))
  ) {
    score += 0.14;
    reasons.push("narrative frame");
  }

  const penalty = countMisleadingDominance(prompt, entry);
  if (penalty > 0) {
    score -= penalty;
    reasons.push("misleading keyword penalty");
  }

  return {
    score: Math.round(Math.max(0, score) * 100) / 100,
    reason: reasons.slice(0, 4).join("; ") || "context overlap",
  };
}

export function enrichTaxonomyFromAtlas(prompt: string, taxonomy: WorldConceptTaxonomy): void {
  const lower = prompt.toLowerCase();

  function pushUnique(target: string[], values: string[]): void {
    for (const v of values) {
      const label = v.replace(/_/g, " ");
      if (!target.includes(label)) target.push(label);
    }
  }

  for (const entry of ATLAS_ENTRIES) {
    const envDomains = new Set([
      "places",
      "activities",
      "home",
      "transport",
      "locations",
      "weather",
      "work",
    ]);
    if (!envDomains.has(entry.domain)) continue;

    let matched = false;
    for (const phrase of entry.common_phrases) {
      if (phrase.length >= 6 && lower.includes(phrase.toLowerCase())) {
        matched = true;
        break;
      }
    }

    if (!matched) continue;

    pushUnique(taxonomy.activity, entry.activity);
    pushUnique(taxonomy.environment, entry.environment);
    if (entry.domain === "activities" || matched) {
      pushUnique(taxonomy.emotion, entry.emotional_states);
    }
  }
}

export function consultAtlas(
  prompt: string,
  fingerprint: SemanticFingerprint,
  limit = 4,
): AtlasConsultation[] {
  const scored = ATLAS_ENTRIES.map((entry) => {
    const { score, reason } = scoreEntry(prompt, fingerprint, entry, ATLAS_ENTRIES);
    return { entry, score, reason };
  })
    .filter((s) => s.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map((s) => ({
    entryId: s.entry.id,
    label: s.entry.label,
    domain: s.entry.domain,
    matchScore: s.score,
    reason: s.reason,
  }));
}

export function getAtlasEntry(id: string): AtlasEntry | undefined {
  return ENTRY_BY_ID.get(id);
}

export function getAtlasEntryCount(): number {
  return ATLAS_ENTRIES.length;
}

export function getMusicalBehaviourDef(id: string): MusicalBehaviourDef | undefined {
  const normalized = id.replace(/\s+/g, "_").toLowerCase();
  return MUSICAL_BEHAVIOUR_DEFS.find(
    (b) => b.id === normalized || b.label.toLowerCase() === id.toLowerCase(),
  );
}
