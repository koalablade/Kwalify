/**
 * Experience Priority Model — human situation > emotional state > narrative moment > physical environment.
 * Answers "why is this mentioned?" per concept, not object lists.
 */

import type { AmbiguousPromptResolution } from "./ambiguous-prompt-resolver";
import type { MomentInterpretation } from "./moment-interpreter";
import type { WorldConceptTaxonomy } from "./types";

export type ExperienceLayer =
  | "human_situation"
  | "emotional_state"
  | "narrative_moment"
  | "physical_environment";

export type ConceptRole =
  | "sensory_atmosphere"
  | "viewpoint"
  | "private_space"
  | "emotional_trigger"
  | "transition"
  | "scenery"
  | "social_context"
  | "activity_marker"
  | "temporal_marker"
  | "life_event";

export interface ConceptRoleEntry {
  label: string;
  role: ConceptRole;
  whyMentioned: string;
  layer: ExperienceLayer;
}

export interface ExperiencePriorityResult {
  conceptRoles: ConceptRoleEntry[];
  dominantExperience: string;
  humanMeanings: string[];
  confidence: number;
}

const LAYER_ORDER: ExperienceLayer[] = [
  "human_situation",
  "emotional_state",
  "narrative_moment",
  "physical_environment",
];

const WEATHER_RE = /\b(rain|windscreen|windshield|wet|storm|snow|fog)\b/i;
const DRIVE_RE = /\b(drive|driving|motorway|road|highway|journey|car|parked)\b/i;
const HOME_RE = /\b(home|inside|door|house|flat)\b/i;
const EXHAUSTION_RE = /\b(knackered|shattered|exhaust|tired|wrecked|done in|long day|rough day|worst day)\b/i;
const SOCIAL_RE = /\b(party|everyone|friends|alone|solitary|quiet)\b/i;

function inferLayer(
  label: string,
  category: string,
  momentInterpretation: MomentInterpretation,
): ExperienceLayer {
  const lower = label.toLowerCase();
  if (
    momentInterpretation.lifeEvents.some((e) => lower.includes(e.category.replace(/_/g, " "))) ||
    /after work|bad day|breakup|loss|transition|homecoming/i.test(lower)
  ) {
    return "human_situation";
  }
  if (category === "emotion" || /sad|joy|grief|relief|calm|nostalgia|stress|exhaust/i.test(lower)) {
    return "emotional_state";
  }
  if (
    category === "lifeContext" ||
    category === "social" ||
    /story|memory|reflection|journey|moment/i.test(lower)
  ) {
    return "narrative_moment";
  }
  return "physical_environment";
}

function inferRole(label: string, category: string): ConceptRole {
  const lower = label.toLowerCase();
  if (/rain|wind|wet|storm|snow|fog|glass|windscreen/i.test(lower)) return "sensory_atmosphere";
  if (/car|driveway|home|room|bed|sofa|blanket/i.test(lower)) return "private_space";
  if (/alone|solitary|private|quiet/i.test(lower)) return "viewpoint";
  if (/driv|walk|sit|parked|delay/i.test(lower)) return "activity_marker";
  if (/sunday|night|evening|morning|2am|midnight/i.test(lower)) return "temporal_marker";
  if (/friend|family|party|everyone/i.test(lower)) return "social_context";
  if (/road|motorway|highway|journey|transition/i.test(lower)) return "transition";
  if (/loss|breakup|graduat|exam|worst day|fresh start/i.test(lower)) return "life_event";
  if (category === "emotion") return "emotional_trigger";
  if (category === "environment") return "scenery";
  return "activity_marker";
}

function whyForRole(role: ConceptRole, label: string, layer: ExperienceLayer): string {
  const lower = label.toLowerCase();
  switch (role) {
    case "sensory_atmosphere":
      return `Weather and texture frame the mood (${label}) — felt, not the whole story.`;
    case "private_space":
      return `${label} is a cocoon — a pause before the next obligation.`;
    case "viewpoint":
      return `${label} shapes how the moment is seen — inward, not performative.`;
    case "transition":
      return `${label} marks movement between states — between who you were and who you're becoming.`;
    case "emotional_trigger":
      return `${label} is the feeling driving the moment, not decoration.`;
    case "life_event":
      return `${label} is the human story underneath everything else.`;
    case "social_context":
      return `${label} explains who is (or isn't) in the room with you.`;
    case "temporal_marker":
      return `${label} sets the rhythm — when this moment belongs in your week or life.`;
    case "activity_marker":
      if (layer === "human_situation") return `${label} is what you're doing to survive or recover.`;
      return `${label} supports the scene without defining it.`;
    case "scenery":
      return `${label} is backdrop — mentioned because it matches the inner weather.`;
    default:
      return `${label} belongs because it reinforces the lived moment.`;
  }
}

function reflectiveDrivingNarrative(): ExperiencePriorityResult {
  const conceptRoles: ConceptRoleEntry[] = [
    {
      label: "private reflective journey",
      role: "transition",
      whyMentioned: "The car becomes a cocoon between obligations — movement without needing to arrive.",
      layer: "human_situation",
    },
    {
      label: "quiet reflection",
      role: "emotional_trigger",
      whyMentioned: "Rain, darkness, and motion invite inward thought rather than destination.",
      layer: "emotional_state",
    },
    {
      label: "solitary motion",
      role: "viewpoint",
      whyMentioned: "Alone on the road gives space to think without answering to anyone.",
      layer: "narrative_moment",
    },
    {
      label: "rain on glass",
      role: "sensory_atmosphere",
      whyMentioned: "Weather frames the mood — felt through the windscreen, not the point of the story.",
      layer: "physical_environment",
    },
  ];
  return {
    conceptRoles,
    dominantExperience:
      "Rain on the glass, miles from nowhere — someone alone in a private transitional space, using weather and movement for reflection.",
    humanMeanings: [
      "Someone alone in a private transitional space, using weather and movement for reflection — not a list of rain and car objects.",
    ],
    confidence: 0.88,
  };
}

function parkedAfterWorkNarrative(): ExperiencePriorityResult {
  return {
    conceptRoles: [
      {
        label: "decompression pause",
        role: "transition",
        whyMentioned: "Sitting in the car before going inside — delaying the next role you have to play.",
        layer: "human_situation",
      },
      {
        label: "avoidance",
        role: "emotional_trigger",
        whyMentioned: "Can't face going in yet — the feeling needs a few minutes of silence first.",
        layer: "emotional_state",
      },
      {
        label: "private space",
        role: "private_space",
        whyMentioned: "The car is the only room that belongs entirely to you right now.",
        layer: "narrative_moment",
      },
    ],
    dominantExperience:
      "Parked up after a long day — five minutes in the car before the front door and everything waiting inside.",
    humanMeanings: [
      "A private decompression pause — not parking logistics, but the need for space before re-entering life.",
    ],
    confidence: 0.84,
  };
}

function buildDominantFromRoles(
  conceptRoles: ConceptRoleEntry[],
  ambiguousResolution: AmbiguousPromptResolution,
  momentInterpretation: MomentInterpretation,
): string {
  if (ambiguousResolution.primaryInterpretation?.label) {
    const primary = ambiguousResolution.primaryInterpretation.label;
    const secondary = ambiguousResolution.secondaryInterpretations
      .slice(0, 2)
      .map((s) => s.label)
      .join(", ");
    if (secondary) return `${primary} — ${secondary}.`;
    return `${primary}.`;
  }
  if (momentInterpretation.dominantStory) return momentInterpretation.dominantStory;
  const byLayer = LAYER_ORDER.map((layer) =>
    conceptRoles.find((c) => c.layer === layer),
  ).filter(Boolean) as ConceptRoleEntry[];
  if (byLayer.length >= 2) {
    return `${byLayer[0].label} — ${byLayer.slice(1, 3).map((c) => c.label).join(", ")}.`;
  }
  if (byLayer[0]) return `${byLayer[0].label}.`;
  return "A lived moment seeking musical companionship.";
}

export function buildExperiencePriority(
  prompt: string,
  taxonomy: WorldConceptTaxonomy,
  momentInterpretation: MomentInterpretation,
  ambiguousResolution: AmbiguousPromptResolution,
): ExperiencePriorityResult {
  const lower = prompt.toLowerCase();

  if (DRIVE_RE.test(lower) && WEATHER_RE.test(lower)) {
    return reflectiveDrivingNarrative();
  }
  if (
    /\b(?:sitting|parked|parked up|just parked)\b/i.test(lower) &&
    (/\bcar\b/i.test(lower) || /\bbefore\b/i.test(lower)) &&
    (HOME_RE.test(lower) || /\bgoing in|inside\b/i.test(lower) || EXHAUSTION_RE.test(lower))
  ) {
    return parkedAfterWorkNarrative();
  }

  const conceptRoles: ConceptRoleEntry[] = [];
  const seen = new Set<string>();

  const addConcept = (label: string, category: string): void => {
    const key = label.toLowerCase();
    if (!label || seen.has(key)) return;
    seen.add(key);
    const layer = inferLayer(label, category, momentInterpretation);
    const role = inferRole(label, category);
    conceptRoles.push({
      label,
      role,
      whyMentioned: whyForRole(role, label, layer),
      layer,
    });
  };

  for (const concept of momentInterpretation.primaryConcepts.slice(0, 6)) {
    addConcept(concept.label, concept.category);
  }

  const taxonomyBuckets: Array<[string, string[]]> = [
    ["lifeContext", taxonomy.lifeContext],
    ["emotion", taxonomy.emotion],
    ["social", taxonomy.social],
    ["activity", taxonomy.activity],
    ["environment", taxonomy.environment],
    ["sensory", taxonomy.sensory],
  ];
  for (const [cat, values] of taxonomyBuckets) {
    for (const v of values.slice(0, 3)) addConcept(v, cat);
  }

  conceptRoles.sort(
    (a, b) => LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer),
  );

  const humanMeanings = [
    ...ambiguousResolution.humanMeanings,
    ...momentInterpretation.lifeEvents.map((e) => `${e.category.replace(/_/g, " ")} — ${e.trigger}`),
  ]
    .filter((m, i, arr) => arr.indexOf(m) === i)
    .slice(0, 4);

  const dominantExperience = buildDominantFromRoles(
    conceptRoles,
    ambiguousResolution,
    momentInterpretation,
  );

  let confidence = 0.45;
  if (ambiguousResolution.confidence > 0) confidence = ambiguousResolution.confidence;
  else if (momentInterpretation.narrativeDominance >= 0.6) confidence = 0.72;
  else if (conceptRoles.length >= 3) confidence = 0.58;
  if (EXHAUSTION_RE.test(lower) && HOME_RE.test(lower)) confidence = Math.max(confidence, 0.7);
  if (SOCIAL_RE.test(lower) && /after|everyone|went home/i.test(lower)) confidence = Math.max(confidence, 0.68);

  return {
    conceptRoles: conceptRoles.slice(0, 8),
    dominantExperience,
    humanMeanings,
    confidence: Math.round(confidence * 100) / 100,
  };
}
