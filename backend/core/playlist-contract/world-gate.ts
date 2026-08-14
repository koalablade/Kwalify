/**
 * V39 — Contract-gated world commitment prototype.
 *
 * Decides whether CommittedWorld should remain a hard lock or downgrade to
 * a soft hypothesis when richer PlaylistContract intent disagrees.
 */

import type { CommittedWorld } from "../committed-world";
import { hasExplicitMusicalHardLock } from "../committed-world";
import type { ContractDisagreement, ContractGenreMust, PlaylistContract } from "./types";

export type WorldGateMode = "hard_lock" | "soft_hypothesis";

export type WorldGateDecision = {
  deferHardLock: boolean;
  reasons: string[];
  confidence: number;
  mode: WorldGateMode;
  /** World after gate — hardLock cleared when deferring. */
  effectiveWorld: CommittedWorld | null;
  originalWorld: CommittedWorld | null;
  contractWorldAgreement: boolean;
};

/** Genre token → retrieval families used for world alignment checks. */
const GENRE_TOKEN_FAMILIES: Record<string, string[]> = {
  deep_house: ["house", "electronic"],
  house: ["house", "electronic"],
  dnb: ["electronic", "drum_and_bass", "drum and bass"],
  drum_and_bass: ["electronic", "drum_and_bass"],
  grime: ["grime", "hip_hop", "electronic"],
  reggae: ["reggae", "world"],
  soul: ["soul", "rnb", "funk"],
  rock: ["rock", "metal"],
  pop_punk: ["rock", "indie", "punk"],
  punk: ["rock", "punk", "indie"],
  techno: ["electronic", "techno"],
  lofi_indie: ["indie", "electronic", "lofi"],
  lofi: ["indie", "electronic", "lofi"],
  film_score: ["classical", "soundtrack", "ambient", "electronic"],
  disco: ["disco", "funk", "soul", "pop"],
  country: ["country", "folk"],
  jazz: ["jazz", "soul"],
  indie: ["indie", "alternative"],
  electronic: ["electronic"],
  hip_hop: ["hip_hop", "rap"],
  pop: ["pop"],
};

/** World id → primary genre families (subset of retrieval map). */
const WORLD_GENRE_FAMILIES: Record<string, string[]> = {
  sunday_chill_world: ["indie", "folk", "soul", "jazz", "electronic"],
  soft_sad_world: ["indie", "folk", "singer_songwriter"],
  feel_good_world: ["pop", "soul", "funk", "disco", "rnb"],
  party_prep_world: ["pop", "electronic", "disco", "hip_hop", "soul"],
  reggae_world: ["reggae", "world"],
  pop_punk_world: ["rock", "indie", "punk"],
  uk_garage_world: ["electronic", "hip_hop", "grime"],
  gym_energy_world: ["electronic", "hip_hop", "pop", "techno"],
  dad_rock_world: ["rock", "pop"],
  classic_rock_world: ["rock", "blues", "metal"],
  night_drive_world: ["indie", "electronic", "rock"],
  lofi_world: ["indie", "electronic", "hip_hop", "jazz"],
  focus_study_world: ["electronic", "indie", "jazz"],
  deep_house_world: ["house", "electronic"],
  disco_party_world: ["soul", "pop", "electronic", "disco"],
  film_ending_world: ["indie", "electronic", "ambient"],
  evening_drive_world: ["indie", "electronic", "rock"],
  rainy_drive_world: ["indie", "rock", "electronic"],
};

const ACTIVITY_ONLY_WORLD_IDS = new Set([
  "gym_rock_world",
  "heavy_gym_world",
  "angry_rock_world",
  "gym_world",
  "running_energy_world",
  "sleepy_gym_world",
]);

const STRONG_MUST_GENRE_CONFIDENCE = 0.62;
const LOW_WORLD_CONFIDENCE = 0.72;

function isStrongMustGenre(genre: ContractGenreMust, prompt: string): boolean {
  if (genre.source === "decomposed_scene" || normalizeToken(genre.value).endsWith("_scene")) {
    return false;
  }
  if (genre.confidence >= STRONG_MUST_GENRE_CONFIDENCE) return true;
  const token = normalizeToken(genre.value);
  if (token === "dnb" && /\bdrum\s+and\s+bass\b|\bdnb\b|\bjungle\b/i.test(prompt)) return true;
  const literal = token.replace(/_/g, "[\\s-]?");
  return new RegExp(`\\b${literal}\\b`, "i").test(prompt);
}

function normalizeToken(value: string): string {
  return value.toLowerCase().trim().replace(/[\s-]+/g, "_");
}

/** Specific MUST genres require world-id stem match — not generic electronic/indie overlap. */
const GENRE_WORLD_STEM: Record<string, RegExp> = {
  deep_house: /house|deep/i,
  house: /house/i,
  dnb: /dnb|drum|garage/i,
  drum_and_bass: /dnb|drum|garage/i,
  grime: /grime|garage/i,
  reggae: /reggae/i,
  soul: /soul|feel_good|rnb/i,
  pop_punk: /punk|pop_punk/i,
  punk: /punk/i,
  techno: /techno|energy/i,
  lofi_indie: /lofi|lo_fi/i,
  lofi: /lofi|lo_fi/i,
  film_score: /film|cinematic|ambient|score/i,
  rock: /rock|punk|dad|classic|arena|yacht/i,
  country: /country/i,
  jazz: /jazz/i,
  disco: /disco/i,
  pop: /pop|feel_good/i,
  electronic: /electronic|energy|neon|drive/i,
  indie: /indie|dream|chill|sunday|soft/i,
};

function worldIdTokens(worldId: string): string[] {
  return worldId.toLowerCase().replace(/_world$/g, "").split("_").filter(Boolean);
}

export function genreAlignsWithWorld(genre: ContractGenreMust, world: CommittedWorld): boolean {
  const token = normalizeToken(genre.value);
  if (token.endsWith("_scene") || genre.source === "decomposed_scene") return true;
  const musicalId = (world.musicalWorldId ?? world.id).toLowerCase();
  const stem = GENRE_WORLD_STEM[token];
  if (stem) return stem.test(musicalId);
  const worldTokens = worldIdTokens(musicalId);
  if (worldTokens.some((t) => token.includes(t) || t.includes(token.replace(/_/g, "")))) return true;
  const genreFamilies = GENRE_TOKEN_FAMILIES[token] ?? [token.replace(/_/g, "")];
  const allowed = WORLD_GENRE_FAMILIES[musicalId] ?? WORLD_GENRE_FAMILIES[world.id] ?? [];
  if (allowed.length === 0) return false;
  return genreFamilies.some((f) => allowed.some((a) => a === f || a.includes(f) || f.includes(a)));
}

export function isVagueDefaultWorld(world: CommittedWorld, prompt: string): boolean {
  if (world.source === "explicit_genre" || world.source === "scene_lock") return false;
  if (hasExplicitMusicalHardLock(world)) return false;
  if (world.reason?.includes("vague_default")) return true;
  if (world.id === "sunday_chill_world" && !/\bsunday\b/i.test(prompt)) return true;
  return false;
}

function activityIncompatibleAsMusicalAuthority(
  contract: PlaylistContract,
  world: CommittedWorld,
): boolean {
  if (hasExplicitMusicalHardLock(world)) return false;
  if (world.source === "explicit_genre") return false;
  const activity = contract.context.activity ?? contract.must.activities[0]?.value ?? null;
  if (!activity || !world.activityContext) return false;
  const act = normalizeToken(activity);
  const ctx = normalizeToken(world.activityContext);
  if (act === ctx) return false;
  if (contract.must.genres.length > 0) return false;
  if (ACTIVITY_ONLY_WORLD_IDS.has(world.id) && world.musicalWorldId) return false;
  return true;
}

function hasCriticalDisagreement(disagreements: ContractDisagreement[]): boolean {
  return disagreements.some((d) => d.severity === "critical");
}

function softenCommittedWorld(world: CommittedWorld): CommittedWorld {
  return {
    ...world,
    hardLock: false,
    confidence: Math.min(world.confidence, 0.55),
    reason: `world_gate_soft:${world.reason}`,
    boundary: {
      ...world.boundary,
      hardLock: false,
      reason: world.boundary.reason?.startsWith("world_gate_soft:")
        ? world.boundary.reason
        : `world_gate_soft:${world.boundary.reason ?? world.reason}`,
    },
  };
}

export function evaluateWorldGate(input: {
  contract: PlaylistContract;
  world: CommittedWorld | null;
  disagreements?: ContractDisagreement[];
}): WorldGateDecision {
  const { contract, world } = input;
  const disagreements = input.disagreements ?? [];
  const reasons: string[] = [];

  if (!world?.hardLock) {
    return {
      deferHardLock: false,
      reasons: ["world_not_hard_locked"],
      confidence: world?.confidence ?? 0,
      mode: "soft_hypothesis",
      effectiveWorld: world,
      originalWorld: world,
      contractWorldAgreement: disagreements.length === 0,
    };
  }

  const explicitMusical = hasExplicitMusicalHardLock(world) || world.source === "explicit_genre";
  const strongMustGenres = contract.must.genres.filter((g) => isStrongMustGenre(g, contract.prompt));
  const mustGenreMismatch =
    strongMustGenres.length > 0 && strongMustGenres.some((g) => !genreAlignsWithWorld(g, world));
  const unresolvedTension = contract.tension.some((t) => t.resolution === "preserve_both");
  const vagueFallback = isVagueDefaultWorld(world, contract.prompt);
  const criticalDisagreement = hasCriticalDisagreement(disagreements);
  const lowWorldHighMust =
    world.confidence < LOW_WORLD_CONFIDENCE &&
    strongMustGenres.length > 0 &&
    world.source !== "explicit_genre";
  const activityConflict = activityIncompatibleAsMusicalAuthority(contract, world);

  if (explicitMusical && !mustGenreMismatch && !unresolvedTension && !vagueFallback && !criticalDisagreement) {
    return {
      deferHardLock: false,
      reasons: ["explicit_musical_agreement"],
      confidence: world.confidence,
      mode: "hard_lock",
      effectiveWorld: world,
      originalWorld: world,
      contractWorldAgreement: !mustGenreMismatch && disagreements.filter((d) => d.severity !== "low").length === 0,
    };
  }

  if (unresolvedTension) reasons.push("unresolved_tension_preserve_both");
  if (mustGenreMismatch) reasons.push("must_genre_world_mismatch");
  if (vagueFallback) reasons.push("vague_default_world_fallback");
  if (criticalDisagreement) reasons.push("critical_contract_world_disagreement");
  if (lowWorldHighMust) reasons.push("low_confidence_world_strong_must");
  if (activityConflict) reasons.push("activity_incompatible_as_musical_authority");

  const deferHardLock = reasons.length > 0;

  if (!deferHardLock) {
    return {
      deferHardLock: false,
      reasons: ["aligned_inferred_world"],
      confidence: world.confidence,
      mode: "hard_lock",
      effectiveWorld: world,
      originalWorld: world,
      contractWorldAgreement: true,
    };
  }

  return {
    deferHardLock: true,
    reasons,
    confidence: Math.max(0.35, 1 - reasons.length * 0.12),
    mode: "soft_hypothesis",
    effectiveWorld: softenCommittedWorld(world),
    originalWorld: world,
    contractWorldAgreement: false,
  };
}

export type WorldGateAuditDiagnostics = {
  originalWorld: string | null;
  originalHardLock: boolean;
  contractWorldAgreement: boolean;
  deferHardLock: boolean;
  deferReasons: string[];
  worldConfidence: number;
  contractMustGenres: string[];
  contractMustNot: string[];
  contractTensions: string[];
  retrievalMode: "world_hard_lock" | "contract_soft_hypothesis";
  finalWorldMode: WorldGateMode;
};

export function buildWorldGateAuditDiagnostics(
  decision: WorldGateDecision,
  contract: PlaylistContract,
): WorldGateAuditDiagnostics {
  return {
    originalWorld: decision.originalWorld?.id ?? null,
    originalHardLock: decision.originalWorld?.hardLock ?? false,
    contractWorldAgreement: decision.contractWorldAgreement,
    deferHardLock: decision.deferHardLock,
    deferReasons: decision.reasons,
    worldConfidence: decision.originalWorld?.confidence ?? 0,
    contractMustGenres: contract.must.genres.map((g) => g.value),
    contractMustNot: contract.mustNot.map((n) => n.value),
    contractTensions: contract.tension.map((t) => t.description),
    retrievalMode: decision.deferHardLock ? "contract_soft_hypothesis" : "world_hard_lock",
    finalWorldMode: decision.mode,
  };
}
