import type { HumanExperience, PlaylistIntent } from "./types";

export interface EmotionalArcPhase {
  label: string;
  emotion: string;
  weight: number;
}

export interface EmotionalArc {
  phases: EmotionalArcPhase[];
  summary: string;
}

const INTENT_ARCS: Record<PlaylistIntent, EmotionalArcPhase[]> = {
  recover: [
    { label: "exhaustion", emotion: "exhaustion", weight: 0.35 },
    { label: "release", emotion: "relief", weight: 0.3 },
    { label: "safety", emotion: "peace", weight: 0.25 },
    { label: "rest", emotion: "calm", weight: 0.2 },
  ],
  relax: [
    { label: "stillness", emotion: "calm", weight: 0.35 },
    { label: "ease", emotion: "peace", weight: 0.3 },
    { label: "drift", emotion: "contentment", weight: 0.25 },
  ],
  heal: [
    { label: "ache", emotion: "sadness", weight: 0.3 },
    { label: "processing", emotion: "reflection", weight: 0.3 },
    { label: "softening", emotion: "hope", weight: 0.25 },
    { label: "acceptance", emotion: "peace", weight: 0.2 },
  ],
  cry: [
    { label: "pressure", emotion: "grief", weight: 0.35 },
    { label: "release", emotion: "sadness", weight: 0.35 },
    { label: "emptiness", emotion: "loneliness", weight: 0.2 },
    { label: "after", emotion: "reflection", weight: 0.15 },
  ],
  remember: [
    { label: "return", emotion: "nostalgia", weight: 0.35 },
    { label: "memory", emotion: "longing", weight: 0.3 },
    { label: "bittersweet", emotion: "bittersweet", weight: 0.25 },
    { label: "acceptance", emotion: "peace", weight: 0.15 },
  ],
  celebrate: [
    { label: "build", emotion: "anticipation", weight: 0.25 },
    { label: "peak", emotion: "joy", weight: 0.4 },
    { label: "release", emotion: "relief", weight: 0.2 },
    { label: "afterglow", emotion: "contentment", weight: 0.15 },
  ],
  focus: [
    { label: "settle", emotion: "calm", weight: 0.3 },
    { label: "flow", emotion: "focus", weight: 0.45 },
    { label: "sustain", emotion: "determination", weight: 0.25 },
  ],
  drive: [
    { label: "departure", emotion: "anticipation", weight: 0.25 },
    { label: "motion", emotion: "freedom", weight: 0.35 },
    { label: "reflection", emotion: "reflection", weight: 0.25 },
    { label: "arrival", emotion: "relief", weight: 0.15 },
  ],
  escape: [
    { label: "constraint", emotion: "stress", weight: 0.3 },
    { label: "departure", emotion: "freedom", weight: 0.35 },
    { label: "distance", emotion: "peace", weight: 0.25 },
  ],
  unknown: [
    { label: "opening", emotion: "reflection", weight: 0.35 },
    { label: "middle", emotion: "peace", weight: 0.35 },
    { label: "close", emotion: "calm", weight: 0.3 },
  ],
  process: [
    { label: "unsettled", emotion: "reflection", weight: 0.35 },
    { label: "working through", emotion: "anticipation", weight: 0.3 },
    { label: "clarity", emotion: "peace", weight: 0.25 },
  ],
  transition: [
    { label: "leaving", emotion: "anticipation", weight: 0.3 },
    { label: "in between", emotion: "reflection", weight: 0.35 },
    { label: "arriving", emotion: "hope", weight: 0.25 },
  ],
  nostalgia: [
    { label: "return", emotion: "nostalgia", weight: 0.35 },
    { label: "memory", emotion: "longing", weight: 0.3 },
    { label: "bittersweet", emotion: "bittersweet", weight: 0.25 },
    { label: "acceptance", emotion: "peace", weight: 0.15 },
  ],
};

const QUALITY_PHASE_MAP: Record<string, EmotionalArcPhase> = {
  exhaustion: { label: "exhaustion", emotion: "exhaustion", weight: 0.3 },
  relief: { label: "relief", emotion: "relief", weight: 0.25 },
  safety: { label: "safety", emotion: "peace", weight: 0.2 },
  decompression: { label: "decompression", emotion: "relief", weight: 0.25 },
  transition: { label: "transition", emotion: "anticipation", weight: 0.2 },
  grief: { label: "grief", emotion: "grief", weight: 0.3 },
  nostalgia: { label: "nostalgia", emotion: "nostalgia", weight: 0.3 },
  hope: { label: "hope", emotion: "hope", weight: 0.25 },
};

function mergePhases(base: EmotionalArcPhase[], extra: EmotionalArcPhase[]): EmotionalArcPhase[] {
  const merged = [...base];
  for (const phase of extra) {
    const existing = merged.find((p) => p.label === phase.label);
    if (existing) {
      existing.weight = Math.min(0.5, existing.weight + phase.weight * 0.4);
    } else if (merged.length < 5) {
      merged.push({ ...phase, weight: phase.weight * 0.8 });
    }
  }
  const total = merged.reduce((s, p) => s + p.weight, 0);
  return merged.map((p) => ({
    ...p,
    weight: Math.round((p.weight / total) * 100) / 100,
  }));
}

function buildSummary(phases: EmotionalArcPhase[]): string {
  return phases.map((p) => p.emotion).join(" → ");
}

export function buildEmotionalArc(experience: HumanExperience): EmotionalArc {
  const base = INTENT_ARCS[experience.playlistIntent] ?? INTENT_ARCS.unknown;
  const qualityPhases: EmotionalArcPhase[] = [];

  for (const quality of experience.inferredQualities) {
    const mapped = QUALITY_PHASE_MAP[quality.toLowerCase()];
    if (mapped) qualityPhases.push(mapped);
  }

  const phases = mergePhases(base, qualityPhases);
  return {
    phases,
    summary: buildSummary(phases),
  };
}

export function arcEnergyAtPosition(arc: EmotionalArc, position: number): number {
  const idx = Math.min(arc.phases.length - 1, Math.floor(position * arc.phases.length));
  const phase = arc.phases[idx];
  const lowEnergy = /exhaustion|calm|peace|grief|sadness|reflection/i.test(phase.emotion);
  const highEnergy = /joy|freedom|anticipation|determination/i.test(phase.emotion);
  if (lowEnergy) return 0.25 + idx * 0.08;
  if (highEnergy) return 0.55 + idx * 0.1;
  return 0.4 + idx * 0.05;
}
