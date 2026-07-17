import { HUMAN_SCENE_CONCEPTS } from "./concepts";
import { SENSE_DISAMBIGUATIONS } from "./disambiguation";
import { RELATION_ALIASES, SCENE_RELATIONS } from "./relations";
import type {
  HumanSceneConcept,
  HumanSceneReading,
  MusicalBehaviour,
  ScenePhase,
} from "./types";

const CONCEPT_BY_ID = new Map(HUMAN_SCENE_CONCEPTS.map((c) => [c.id, c]));

function resolveConceptId(id: string): HumanSceneConcept | null {
  const aliased = RELATION_ALIASES[id] ?? id;
  return CONCEPT_BY_ID.get(aliased) ?? null;
}

function cueScore(text: string, concept: HumanSceneConcept): { score: number; matched: string[] } {
  const lower = text.toLowerCase();
  const matched: string[] = [];
  let score = 0;

  for (const cue of concept.cues) {
    if (!lower.includes(cue.toLowerCase())) continue;
    matched.push(cue);
    // Longer phrases beat bare tokens.
    score += cue.length + (cue.includes(" ") ? 12 : 0);
  }
  if (concept.cuePatterns) {
    for (const re of concept.cuePatterns) {
      if (!re.test(text)) continue;
      matched.push(re.source);
      score += 28;
    }
  }
  return { score, matched };
}

function resolveSenses(text: string): {
  senseIds: string[];
  sceneIds: string[];
  suppressChristmas: boolean;
  demotePartyActivity: boolean;
  forceEnergy: "low" | "medium" | "high" | null;
  musicalBehaviour: MusicalBehaviour | null;
} {
  const senseIds: string[] = [];
  const sceneIds: string[] = [];
  let suppressChristmas = false;
  let demotePartyActivity = false;
  let forceEnergy: "low" | "medium" | "high" | null = null;
  let musicalBehaviour: MusicalBehaviour | null = null;

  for (const entry of SENSE_DISAMBIGUATIONS) {
    // Prefer the first matching sense in author order (specific → general).
    for (const sense of entry.senses) {
      const whenHit = sense.when.some((re) => re.test(text));
      if (!whenHit) continue;
      if (sense.unless?.some((re) => re.test(text))) continue;

      senseIds.push(sense.id);
      if (sense.sceneId) sceneIds.push(sense.sceneId);
      if (sense.effects?.suppressChristmas) suppressChristmas = true;
      if (sense.effects?.demotePartyActivity) demotePartyActivity = true;
      if (sense.effects?.forceEnergy) forceEnergy = sense.effects.forceEnergy;
      if (sense.effects?.preferMusicalBehaviour) {
        musicalBehaviour = sense.effects.preferMusicalBehaviour;
      }
      break;
    }
  }

  return {
    senseIds,
    sceneIds,
    suppressChristmas,
    demotePartyActivity,
    forceEnergy,
    musicalBehaviour,
  };
}

function aftermathBoost(text: string, concept: HumanSceneConcept, base: number): number {
  if (concept.phase !== "aftermath" && concept.phase !== "recovery") return base;
  // Prefer aftermath concepts when decline cues are present alongside a peak word.
  if (/\b(?:after|comedown|hangover|post[-\s]|day\s+after|ends?|ended|over|back\s+from)\b/i.test(text)) {
    return base + 40;
  }
  return base;
}

/**
 * Resolve human moment from text against reusable scene knowledge.
 * Compositional: phrase cues + sense disambiguation + relation bias.
 */
export function resolveHumanScene(text: string): HumanSceneReading {
  const senses = resolveSenses(text);
  const scored: Array<{ concept: HumanSceneConcept; score: number; matched: string[] }> = [];

  for (const concept of HUMAN_SCENE_CONCEPTS) {
    const { score, matched } = cueScore(text, concept);
    if (score <= 0) continue;
    scored.push({
      concept,
      score: aftermathBoost(text, concept, score),
      matched,
    });
  }

  // Sense-linked scenes get a strong boost even if phrase was short.
  for (const sceneId of senses.sceneIds) {
    const concept = resolveConceptId(sceneId);
    if (!concept) continue;
    const existing = scored.find((s) => s.concept.id === concept.id);
    if (existing) {
      existing.score += 50;
    } else {
      scored.push({ concept, score: 50, matched: [`sense:${sceneId}`] });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  // Relation bias: if a peak scene and its aftermath both matched, prefer aftermath.
  if (scored.length >= 2) {
    const top = scored[0]!;
    const aftermathChild = scored.find((s) =>
      SCENE_RELATIONS.some(
        (r) =>
          r.from === top.concept.id &&
          (r.to === s.concept.id || RELATION_ALIASES[r.to] === s.concept.id) &&
          (s.concept.phase === "aftermath" || s.concept.phase === "recovery"),
      ),
    );
    if (aftermathChild && aftermathChild.score + 15 >= top.score) {
      scored.splice(scored.indexOf(aftermathChild), 1);
      scored.unshift(aftermathChild);
    }
  }

  const primary = scored[0]?.concept ?? null;
  const secondary = scored.slice(1, 4).map((s) => s.concept);
  const matchedCues = scored[0]?.matched ?? [];

  let phase: ScenePhase | null = primary?.phase ?? null;
  let energy = senses.forceEnergy ?? null;
  let demotePartyActivity = senses.demotePartyActivity;
  let musicalBehaviour = senses.musicalBehaviour ?? primary?.musicalBehaviour ?? null;
  let suppressChristmas = senses.suppressChristmas;

  // Only inherit expectedEnergy from decisive phases — not soft atmosphere.
  if (!energy && primary && (primary.phase === "aftermath" || primary.phase === "recovery" || primary.expectedEnergy === "high")) {
    energy = primary.expectedEnergy;
  }

  // Vacation/after-holiday contexts never want Christmas genre lock.
  if (
    primary?.id === "after_holiday" ||
    primary?.id === "holiday_vacation" ||
    senses.senseIds.some((id) => id.startsWith("holiday.") && id !== "holiday.christmas")
  ) {
    suppressChristmas = true;
  }
  if (primary?.id === "after_holiday" || senses.senseIds.includes("holiday.after")) {
    if (!energy) energy = "low";
  }

  if (primary?.id === "rave_comedown" || senses.senseIds.includes("rave.comedown")) {
    energy = "low";
    demotePartyActivity = true;
    musicalBehaviour = "soft_electronic";
    phase = "aftermath";
  }

  const confidence = primary
    ? Math.min(1, (scored[0]!.score / 60) * (matchedCues.length > 0 ? 1 : 0.7))
    : 0;

  return {
    primary,
    secondary,
    senses: senses.senseIds,
    phase,
    energy,
    suppressChristmas,
    demotePartyActivity,
    musicalBehaviour,
    confidence,
    matchedCues,
  };
}

export function getHumanSceneConcept(id: string): HumanSceneConcept | null {
  return resolveConceptId(id);
}

export function listHumanSceneTransitions(fromId: string): string[] {
  return SCENE_RELATIONS
    .filter((r) => r.from === fromId)
    .map((r) => RELATION_ALIASES[r.to] ?? r.to);
}

export function humanSceneCount(): number {
  return HUMAN_SCENE_CONCEPTS.length;
}

/**
 * Soft emotional blend when a human scene is confident.
 * Caps only — never invents high energy for aftermath/recovery.
 * Atmospheric steady scenes must not flatten peak/celebratory moments.
 */
export function applyHumanSceneToProfile<T extends {
  energy: number;
  valence: number;
  tension: number;
  nostalgia: number;
  calm: number;
}>(profile: T, reading: HumanSceneReading, blend = 0.55): T {
  const scene = reading.primary;
  if (!scene || reading.confidence < 0.35) return profile;

  const protectEnergy =
    scene.phase === "peak" ||
    scene.musicalBehaviour === "celebratory" ||
    scene.musicalBehaviour === "high_drive" ||
    scene.musicalBehaviour === "peak_dance" ||
    (scene.phase === "steady" && scene.expectedEnergy !== "low" && reading.confidence < 0.6);

  const w = Math.min(0.72, blend * reading.confidence);
  const lerp = (a: number, b: number) => a + (b - a) * w;
  const intimacyAsCalm = scene.intimacy;
  const next = {
    ...profile,
    energy: protectEnergy ? profile.energy : lerp(profile.energy, scene.energy),
    valence: lerp(profile.valence, scene.valence),
    tension: lerp(profile.tension, scene.tension),
    calm: lerp(profile.calm, intimacyAsCalm * 0.55 + (1 - scene.energy) * 0.35),
    nostalgia: profile.nostalgia,
  };

  // Aftermath never raises energy relative to current profile.
  if (scene.phase === "aftermath" || scene.phase === "recovery" || reading.energy === "low") {
    next.energy = Math.min(next.energy, Math.min(profile.energy, scene.energy + 0.06));
  }
  return next;
}
