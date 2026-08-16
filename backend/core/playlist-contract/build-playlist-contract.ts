/**
 * Build PlaylistContract from existing V37 parsers — no new prompt hacks.
 * Aggregates decomposeIntent, buildIntentState, buildLockedIntent, negation profile.
 */

import { decomposeIntent, type DecomposedIntent } from "../intent-decomposer";
import { buildIntentState, type IntentState } from "../intent-state-engine";
import { buildLockedIntent, type LockedIntent } from "../v3/intent";
import { resolveCommittedWorld, type CommittedWorld } from "../committed-world";
import { parsePromptNegationEnforcement } from "../../lib/prompt-negation-enforcement";
import { detectEra } from "../../lib/era-detection";
import type {
  ContractConstraint,
  ContractEnergyPrefer,
  ContractGenreMust,
  ContractMoodPrefer,
  ContractNegation,
  ContractTension,
  PlaylistContract,
} from "./types";

export type BuildPlaylistContractInput = {
  prompt: string;
  lockedIntent?: LockedIntent;
  decomposedIntent?: DecomposedIntent;
  intentState?: IntentState;
  committedWorld?: CommittedWorld | null;
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function constraint<T>(value: T, source: string, confidence: number): ContractConstraint<T> {
  return { value, source, confidence: round2(clamp01(confidence)) };
}

function inferContractContext(
  prompt: string,
  decomposed: DecomposedIntent,
  locked: LockedIntent,
): { activity: string | null; scene: string | null; setting: string | null; timeOfDay: string | null } {
  const lower = prompt.toLowerCase();
  const activity = locked.activity ?? decomposed.inferredActivity ?? null;
  const scene = decomposed.scene ?? null;
  let setting: string | null = null;
  let timeOfDay: string | null = null;

  if (/\b(?:rainy|rain|wet weather|drizzle)\b/.test(lower)) setting = "rainy";
  else if (/\b(?:beach|coastal|ocean|sea)\b/.test(lower)) setting = "coastal";
  else if (/\b(?:city|urban|downtown|street)\b/.test(lower)) setting = "urban";
  else if (/\b(?:motorway|highway|open road|countryside)\b/.test(lower)) setting = "open_road";

  if (/\b(?:late night|midnight|2\s*am|3\s*am|after dark|witching hour)\b/.test(lower)) {
    timeOfDay = "late_night";
  } else if (/\b(?:evening|sunset|dusk|golden hour|summer evening)\b/.test(lower)) {
    timeOfDay = "evening";
  } else if (/\b(?:morning|sunrise|dawn|sunday morning|cozy sunday)\b/.test(lower)) {
    timeOfDay = "morning";
  } else if (/\b(?:afternoon|midday)\b/.test(lower)) {
    timeOfDay = "afternoon";
  } else if (/\b(?:night drive|night\b)/.test(lower) && !/\b(?:good night|night out)\b/.test(lower)) {
    timeOfDay = "night";
  }

  return { activity, scene, setting, timeOfDay };
}

function detectTensions(
  prompt: string,
  decomposed: DecomposedIntent,
  locked: LockedIntent,
): ContractTension[] {
  const tensions: ContractTension[] = [];
  const lower = prompt.toLowerCase();

  const sadParty =
    (/\bsad\b|\bmelanchol|\bheartbreak/.test(lower) && /\bparty\b|\bbanger/.test(lower)) ||
    lower.includes("sad party");
  if (sadParty) {
    tensions.push({
      axes: ["melancholy", "party_energy"],
      description: "sad emotion + party/banger energy",
      resolution: "preserve_both",
    });
  }

  const energeticNotCheesy =
    /\benergetic\b/.test(lower) && /\bnot\s+cheesy\b|\bwithout\s+cheesy\b/.test(lower);
  if (energeticNotCheesy) {
    tensions.push({
      axes: ["high_energy", "not_cheesy"],
      description: "energetic but not cheesy",
      resolution: "preserve_both",
    });
  }

  const partyNotCheesy =
    /\bparty\b/.test(lower) && /\bnot\s+cheesy\b|\bwithout\s+cheesy\b|\bno\s+cheesy\b/.test(lower);
  if (partyNotCheesy && !tensions.some((t) => t.axes.includes("not_cheesy"))) {
    tensions.push({
      axes: ["party_energy", "not_cheesy"],
      description: "party but not cheesy",
      resolution: "preserve_both",
    });
  }

  const chilledNotBoring =
    /\bchill/.test(lower) && /\bnot\s+boring\b/.test(lower);
  if (chilledNotBoring) {
    tensions.push({
      axes: ["low_energy", "not_boring"],
      description: "chilled but not boring",
      resolution: "preserve_both",
    });
  }

  const darkButDanceable =
    /\bdark\b/.test(lower) && /\bdanceable\b|\bdance\b/.test(lower);
  if (darkButDanceable) {
    tensions.push({
      axes: ["melancholy", "party_energy"],
      description: "dark but danceable",
      resolution: "preserve_both",
    });
  }

  const melancholicDanceable =
    (/\bmelanchol|\bsad\b/.test(lower) && /\bdanceable\b|\bdance\b/.test(lower)) ||
    lower.includes("melancholic+danceable");
  if (melancholicDanceable && !tensions.some((t) => t.axes[0] === "melancholy" && t.axes[1] === "party_energy")) {
    tensions.push({
      axes: ["melancholy", "party_energy"],
      description: "melancholic but danceable",
      resolution: "preserve_both",
    });
  }

  const partyRestrained =
    (/\bparty\b/.test(lower) && /\b(?:restrain|controlled|understated)\b/.test(lower)) ||
    lower.includes("party+restrained");
  if (partyRestrained && !tensions.some((t) => t.axes.includes("party_energy"))) {
    tensions.push({
      axes: ["party_energy", "not_cheesy"],
      description: "party but restrained",
      resolution: "preserve_both",
    });
  }

  const aggressiveControlled =
    /\baggressive\b/.test(lower) && /\b(?:controlled|restrain)\b/.test(lower);
  if (aggressiveControlled) {
    tensions.push({
      axes: ["high_energy", "not_cheesy"],
      description: "aggressive but controlled",
      resolution: "preserve_both",
    });
  }

  const warmMelancholic =
    /\bwarm\b/.test(lower) && /\bmelanchol|\bsad\b/.test(lower);
  if (warmMelancholic && !tensions.some((t) => t.axes[0] === "melancholy")) {
    tensions.push({
      axes: ["melancholy", "low_energy"],
      description: "warm and melancholic",
      resolution: "preserve_both",
    });
  }

  const emotionalUpbeat =
    /\bemotional\b/.test(lower) && /\bupbeat\b/.test(lower);
  if (emotionalUpbeat && !tensions.some((t) => t.axes.includes("melancholy"))) {
    tensions.push({
      axes: ["melancholy", "high_energy"],
      description: "emotional but upbeat",
      resolution: "preserve_both",
    });
  }

  // Only explicit contrast ("but") — blend descriptors like "upbeat indie melancholic"
  // are handled via prefer moods, not preserve_both (avoids pool starvation).
  const upbeatButMelancholic =
    /\bupbeat\b/.test(lower) && /\bmelanchol|\bsad\b/.test(lower) &&
    /\bbut\b|\bwithout\b|\bnot\b/.test(lower);
  if (upbeatButMelancholic && !tensions.some((t) => t.axes[0] === "melancholy")) {
    tensions.push({
      axes: ["melancholy", "high_energy"],
      description: "upbeat but melancholic contrast",
      resolution: "preserve_both",
    });
  }

  if (locked.activity && decomposed.emotion === "sad" && locked.energy === "high") {
    if (!tensions.some((t) => t.axes[0] === "melancholy")) {
      tensions.push({
        axes: ["melancholy", locked.activity],
        description: `sad emotion + ${locked.activity} activity`,
        resolution: "preserve_both",
      });
    }
  }

  return tensions;
}

function buildMustNot(prompt: string, decomposed: DecomposedIntent, intentState: IntentState): ContractNegation[] {
  const negations: ContractNegation[] = [];
  const negProfile = parsePromptNegationEnforcement(prompt);

  if (negProfile.suppressChristmas) {
    negations.push({
      value: "christmas",
      kind: "seasonal",
      hard: true,
      source: "prompt_negation",
      confidence: 0.98,
    });
  }
  if (negProfile.suppressRap) {
    negations.push({
      value: "rap",
      kind: "genre",
      hard: true,
      source: "prompt_negation",
      confidence: 0.95,
    });
  }
  if (negProfile.suppressGuitar) {
    negations.push({
      value: "guitar",
      kind: "attribute",
      hard: true,
      source: "prompt_negation",
      confidence: 0.9,
    });
  }
  if (negProfile.suppressAcoustic) {
    negations.push({
      value: "acoustic",
      kind: "attribute",
      hard: true,
      source: "prompt_negation",
      confidence: 0.9,
    });
  }
  if (negProfile.suppressSad) {
    negations.push({
      value: "sad",
      kind: "attribute",
      hard: true,
      source: "prompt_negation",
      confidence: 0.9,
    });
  }

  for (const term of negProfile.suppressedTerms) {
    if (!negations.some((n) => n.value === term)) {
      negations.push({
        value: term,
        kind: "attribute",
        hard: true,
        source: "prompt_negation",
        confidence: 0.85,
      });
    }
  }

  for (const artist of negProfile.excludedArtists) {
    negations.push({
      value: artist,
      kind: "artist",
      hard: true,
      source: "prompt_negation",
      confidence: 0.92,
    });
  }

  if (/\bnot\s+cheesy\b|\bwithout\s+cheesy\b|\bno\s+cheesy\b/i.test(prompt)) {
    negations.push({
      value: "cheesy",
      kind: "attribute",
      hard: false,
      source: "prompt_negation",
      confidence: 0.88,
    });
  }
  if (/\bnot\s+boring\b|\bwithout\s+boring\b/i.test(prompt)) {
    negations.push({
      value: "boring",
      kind: "attribute",
      hard: false,
      source: "prompt_negation",
      confidence: 0.85,
    });
  }

  for (const ex of decomposed.exclusions) {
    if (!negations.some((n) => n.value === ex)) {
      negations.push({
        value: ex,
        kind: "genre",
        hard: true,
        source: "decomposed_exclusions",
        confidence: 0.8,
      });
    }
  }

  for (const genre of intentState.constraints?.excludedGenres ?? []) {
    if (!negations.some((n) => n.value === genre)) {
      negations.push({
        value: genre,
        kind: "genre",
        hard: true,
        source: "intent_state",
        confidence: 0.82,
      });
    }
  }

  return negations;
}

function buildGenres(locked: LockedIntent, decomposed: DecomposedIntent): ContractGenreMust[] {
  const genres: ContractGenreMust[] = [];
  const conf = decomposed.confidence;

  if (locked.primarySubgenre) {
    genres.push({
      value: locked.primarySubgenre,
      family: locked.primaryGenre ?? undefined,
      subgenre: locked.primarySubgenre,
      source: "locked_intent",
      confidence: round2(clamp01(conf + 0.1)),
    });
  } else if (locked.primaryGenre) {
    genres.push({
      value: locked.primaryGenre,
      family: locked.primaryGenre,
      subgenre: null,
      source: "locked_intent",
      confidence: round2(clamp01(conf)),
    });
  }

  for (const family of locked.genreFamilies) {
    if (!genres.some((g) => g.family === family || g.value === family)) {
      genres.push({
        value: family,
        family,
        subgenre: null,
        source: "locked_intent_families",
        confidence: round2(clamp01(conf * 0.85)),
      });
    }
  }

  if (decomposed.scene && !genres.length) {
    genres.push({
      value: decomposed.scene,
      source: "decomposed_scene",
      confidence: round2(clamp01(conf * 0.7)),
    });
  }

  return genres.slice(0, 4);
}

function buildEras(prompt: string, locked: LockedIntent): import("./types").ContractEraMust[] {
  const eras: import("./types").ContractEraMust[] = [];
  const eraCtx = detectEra(prompt);

  if (eraCtx.decade) {
    eras.push({
      value: eraCtx.decade,
      source: "era_detection",
      confidence: round2(clamp01(eraCtx.eraConfidence ?? 0.75)),
    });
  } else if (locked.eraRange) {
    eras.push({
      value: `${locked.eraRange.start}s`,
      source: "locked_intent_era",
      confidence: 0.7,
    });
  }

  return eras;
}

function buildMoods(decomposed: DecomposedIntent, locked: LockedIntent): ContractMoodPrefer[] {
  const moods: ContractMoodPrefer[] = [];
  if (decomposed.emotion) {
    moods.push(constraint(decomposed.emotion, "decomposed_emotion", decomposed.confidence));
  }
  for (const m of locked.mood) {
    if (!moods.some((x) => x.value === m)) {
      moods.push(constraint(m, "locked_mood", decomposed.confidence * 0.9));
    }
  }
  return moods.slice(0, 4);
}

function buildEnergy(decomposed: DecomposedIntent, locked: LockedIntent): ContractEnergyPrefer[] {
  const energy = locked.energy ?? decomposed.energy;
  if (!energy) return [];
  const bands: Record<string, { min: number; max: number }> = {
    low: { min: 0, max: 0.45 },
    medium: { min: 0.35, max: 0.65 },
    high: { min: 0.55, max: 1 },
  };
  const band = bands[energy];
  return [{
    value: energy,
    min: band.min,
    max: band.max,
    source: locked.energy ? "locked_intent" : "decomposed_energy",
    confidence: decomposed.confidence,
  }];
}

export function buildPlaylistContract(input: BuildPlaylistContractInput): PlaylistContract {
  const prompt = input.prompt.trim();
  const locked = input.lockedIntent ?? buildLockedIntent(prompt);
  const decomposed = input.decomposedIntent ?? decomposeIntent(prompt);
  const intentState = input.intentState ?? buildIntentState(prompt, { lockedIntent: locked, decomposedIntent: decomposed });
  const world = input.committedWorld !== undefined
    ? input.committedWorld
    : resolveCommittedWorld({ prompt, lockedIntent: locked });

  const genres = buildGenres(locked, decomposed);
  const eras = buildEras(prompt, locked);
  const mustNot = buildMustNot(prompt, decomposed, intentState);
  const tensions = detectTensions(prompt, decomposed, locked);

  const activities: ContractConstraint<string>[] = [];
  const inferredCtx = inferContractContext(prompt, decomposed, locked);
  const activity = inferredCtx.activity;
  if (activity) {
    activities.push(constraint(activity, "locked_or_decomposed", intentState.confidence));
  }

  const scenes: ContractConstraint<string>[] = [];
  if (decomposed.scene) scenes.push(constraint(decomposed.scene, "decomposed_scene", decomposed.confidence));
  for (const s of intentState.scene ?? []) {
    if (!scenes.some((x) => x.value === s)) {
      scenes.push(constraint(s, "intent_state_scene", intentState.confidence * 0.85));
    }
  }
  if (inferredCtx.scene && !scenes.some((x) => x.value === inferredCtx.scene)) {
    scenes.push(constraint(inferredCtx.scene, "inferred_scene", decomposed.confidence * 0.78));
  }

  const unknownDimensions: import("./types").ContractDimension[] = [];
  if (!genres.length) unknownDimensions.push("genre");
  if (!eras.length) unknownDimensions.push("era");
  if (!decomposed.emotion && !locked.mood.length) unknownDimensions.push("mood");
  if (!activity) unknownDimensions.push("activity");
  if (!world?.id) unknownDimensions.push("world");

  const dimConfidence: Partial<Record<import("./types").ContractDimension, number>> = {
    genre: genres.length ? Math.max(...genres.map((g) => g.confidence)) : 0.2,
    era: eras.length ? Math.max(...eras.map((e) => e.confidence)) : 0.15,
    mood: buildMoods(decomposed, locked).length ? decomposed.confidence : 0.25,
    energy: buildEnergy(decomposed, locked).length ? decomposed.confidence : 0.2,
    activity: activity ? intentState.confidence : 0.15,
    scene: scenes.length ? intentState.confidence : 0.2,
    negation: mustNot.length ? 0.9 : 0.5,
    world: world?.confidence ?? 0.15,
  };

  const overall = round2(
    clamp01(
      (intentState.confidence * 0.35 +
        decomposed.confidence * 0.25 +
        (world?.confidence ?? 0.2) * 0.2 +
        (mustNot.length ? 0.1 : 0) +
        (tensions.length ? -0.05 * tensions.length : 0)) /
        1,
    ),
  );

  const signature = [
    genres.map((g) => g.value).join("+"),
    eras.map((e) => e.value).join("+"),
    activity,
    world?.id,
    mustNot.map((n) => n.value).join("+"),
    tensions.length,
  ].join("|");

  return {
    version: "playlist-contract-v1",
    prompt,
    must: {
      genres,
      eras,
      activities,
    },
    prefer: {
      moods: buildMoods(decomposed, locked),
      energy: buildEnergy(decomposed, locked),
      scenes: scenes.slice(0, 4),
    },
    mustNot,
    context: {
      activity,
      scene: decomposed.scene ?? inferredCtx.scene ?? (intentState.scene?.[0] ?? null),
      setting: inferredCtx.setting,
      timeOfDay: inferredCtx.timeOfDay,
    },
    tension: tensions,
    unknown: {
      tokens: (decomposed.unknownTokens.length ? decomposed.unknownTokens : intentState.unknownTokens ?? []).slice(0, 12),
      dimensions: unknownDimensions,
    },
    worldHypothesis: {
      id: world?.id ?? null,
      hardLock: world?.hardLock ?? false,
      confidence: world?.confidence ?? 0.15,
      source: world?.source ?? "none",
      musicalWorldId: world?.musicalWorldId ?? null,
      activityContext: world?.activityContext ?? null,
    },
    confidence: {
      overall,
      dimensions: dimConfidence,
    },
    buildSignature: signature,
  };
}
