import type { IntentContract } from "./intent-contract";
import type { SemanticFingerprint } from "./types";
import {
  consultAtlas,
  getAtlasEntry,
  type AtlasConsultation,
} from "./atlas-loader";
import { buildEmotionalArc } from "./emotional-arc";
import type { MomentInterpretation } from "./moment-interpreter";
import type {
  HumanExperience,
  PlaylistIntent,
  WorldConceptTaxonomy,
} from "./types";

export interface HumanExperienceInput {
  prompt: string;
  fingerprint: SemanticFingerprint;
  taxonomy: WorldConceptTaxonomy;
  intent: IntentContract;
  momentInterpretation: MomentInterpretation;
  humanMeanings: string[];
  graphExperiences?: string[];
}

const INTENT_FROM_KIND: Partial<Record<string, PlaylistIntent>> = {
  emotional_support: "recover",
  nostalgia: "remember",
  achievement: "celebrate",
  energy: "drive",
  reflection: "focus",
  atmosphere: "relax",
};

const STRESS_QUALITIES = [
  "emotional exhaustion",
  "relief",
  "safety",
  "decompression",
  "private space",
  "low stimulation",
  "emotional recovery",
];

function inferPlaylistIntent(
  prompt: string,
  intent: IntentContract,
  consultations: AtlasConsultation[],
): { intent: PlaylistIntent; confidence: number } {
  const lower = prompt.toLowerCase();

  for (const c of consultations) {
    const entry = getAtlasEntry(c.entryId);
    if (entry?.playlistIntents?.length) {
      const mapped = entry.playlistIntents[0] as PlaylistIntent;
      return { intent: mapped, confidence: 0.7 + c.matchScore * 0.2 };
    }
  }

  if (intent.stressRecovery || /worst day|horrible day|awful day|difficult day/i.test(lower)) {
    return { intent: "recover", confidence: 0.82 };
  }
  if (/finally got home|coming home|got home/i.test(lower)) {
    return { intent: "recover", confidence: 0.78 };
  }
  if (intent.kind !== "unknown" && INTENT_FROM_KIND[intent.kind]) {
    return { intent: INTENT_FROM_KIND[intent.kind]!, confidence: intent.confidence };
  }
  if (/drive|driving|motorway|road/i.test(lower)) {
    return { intent: "drive", confidence: 0.65 };
  }
  if (/cry|grief|heartbreak|broke up/i.test(lower)) {
    return { intent: "cry", confidence: 0.7 };
  }

  return { intent: "unknown", confidence: 0.4 };
}

function inferQualities(
  prompt: string,
  taxonomy: WorldConceptTaxonomy,
  intent: IntentContract,
  consultations: AtlasConsultation[],
): string[] {
  const qualities: string[] = [];
  const lower = prompt.toLowerCase();

  if (
    intent.stressRecovery ||
    taxonomy.emotion.some((e) => /exhaustion|stress|overwhelm/i.test(e)) ||
    /worst day|horrible day|awful day|difficult day|bad day/i.test(lower)
  ) {
    qualities.push(...STRESS_QUALITIES);
  }

  for (const c of consultations) {
    const entry = getAtlasEntry(c.entryId);
    if (entry?.inferredQualities) {
      for (const q of entry.inferredQualities) {
        if (!qualities.includes(q)) qualities.push(q);
      }
    }
  }

  if (/home|door|inside|private/i.test(lower) && !qualities.includes("private space")) {
    qualities.push("private space", "safety");
  }
  if (/finally|after/i.test(lower) && !qualities.includes("transition")) {
    qualities.push("transition");
  }
  if (taxonomy.emotion.some((e) => /relief|peace|calm/i.test(e)) && !qualities.includes("relief")) {
    qualities.push("relief");
  }

  return qualities.slice(0, 10);
}

function collectMusicalBehaviours(
  consultations: AtlasConsultation[],
  taxonomy: WorldConceptTaxonomy,
): string[] {
  const behaviours: string[] = [];
  for (const c of consultations) {
    const entry = getAtlasEntry(c.entryId);
    if (entry) {
      for (const b of entry.musicalBehaviours) {
        if (!behaviours.includes(b)) behaviours.push(b);
      }
    }
  }
  if (taxonomy.emotion.some((e) => /nostalgia/i.test(e))) {
    if (!behaviours.includes("nostalgic warmth")) behaviours.push("nostalgic warmth");
  }
  if (taxonomy.emotion.some((e) => /peace|calm/i.test(e))) {
    if (!behaviours.includes("settles")) behaviours.push("settles");
  }
  return behaviours.slice(0, 8);
}

function collectSharedMemories(
  consultations: AtlasConsultation[],
  momentInterpretation: MomentInterpretation,
): string[] {
  const memories: string[] = [];
  for (const c of consultations) {
    const entry = getAtlasEntry(c.entryId);
    if (entry) {
      memories.push(entry.label);
      for (const thought of entry.typicalThoughts.slice(0, 1)) {
        memories.push(thought);
      }
    }
  }
  if (momentInterpretation.dominantStory) {
    memories.push(momentInterpretation.dominantStory);
  }
  return memories.slice(0, 6);
}

function buildNarrative(
  experience: Omit<HumanExperience, "narrative" | "emotionalArcSummary">,
  humanMeanings: string[],
): string {
  if (humanMeanings[0]) return humanMeanings[0];
  const qualityStr = experience.inferredQualities.slice(0, 3).join(", ");
  const intentStr = experience.playlistIntent.replace(/_/g, " ");
  if (qualityStr) {
    return `A human moment of ${qualityStr} — music to ${intentStr}.`;
  }
  if (experience.atlasConsultations[0]) {
    return experience.atlasConsultations[0].label;
  }
  return "A lived moment seeking musical companionship.";
}

export function buildHumanExperience(input: HumanExperienceInput): HumanExperience {
  const consultations = consultAtlas(input.prompt, input.fingerprint);
  const { intent: playlistIntent, confidence: playlistIntentConfidence } = inferPlaylistIntent(
    input.prompt,
    input.intent,
    consultations,
  );

  const inferredQualities = inferQualities(
    input.prompt,
    input.taxonomy,
    input.intent,
    consultations,
  );
  const musicalBehaviours = collectMusicalBehaviours(consultations, input.taxonomy);
  const sharedMemories = collectSharedMemories(consultations, input.momentInterpretation);

  const partial: Omit<HumanExperience, "narrative" | "emotionalArcSummary"> = {
    inferredQualities,
    sharedMemories,
    playlistIntent,
    playlistIntentConfidence,
    musicalBehaviours,
    atlasConsultations: consultations,
    semanticFingerprint: input.fingerprint,
    interpretationReasons: [
      ...consultations.map((c) => `${c.label}: ${c.reason}`),
      input.intent.trigger ? `intent ${input.intent.kind} (${input.intent.trigger})` : "",
      input.fingerprint.narrativeFrame ? `narrative ${input.fingerprint.narrativeFrame}` : "",
    ].filter(Boolean).slice(0, 6),
  };

  const narrative = buildNarrative(partial, input.humanMeanings);
  const experience: HumanExperience = {
    ...partial,
    narrative,
    emotionalArcSummary: "",
  };

  const arc = buildEmotionalArc(experience);
  experience.emotionalArcSummary = arc.summary;

  return experience;
}
