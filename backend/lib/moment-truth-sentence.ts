import type { EmotionalSequencePhases } from "./emotional-sequencing";
import type { EnergyProfileBand } from "./playlist-why-summary";

function energyArcPhrase(band: EnergyProfileBand, phases: EmotionalSequencePhases | null): string {
  if (!phases || phases.intro + phases.build + phases.peak + phases.cooldown < 4) {
    if (band === "high") return "lifts quickly and rides high energy throughout";
    if (band === "low") return "stays calm and settles into a soft landing";
    return "eases in, breathes, and finds a steady groove";
  }
  if (band === "high") {
    return "starts focused, builds momentum, peaks hard, then exhales";
  }
  if (band === "low") {
    return "starts calm, gathers quiet tension, and resolves into reflective release";
  }
  return "starts calm, builds emotional tension, and resolves into reflective release";
}

/** Internal QA summary — deterministic, no LLM. */
export function buildMomentTruthSentence(opts: {
  topSceneMatch: string | null;
  dominantEmotion: string | null;
  energyProfile: EnergyProfileBand;
  sequencePhases?: EmotionalSequencePhases | null;
}): string {
  const scene = opts.topSceneMatch?.trim() || "open-ended moment";
  const emotion = opts.dominantEmotion?.trim() || "reflective";
  const energyWord =
    opts.energyProfile === "high"
      ? "high-energy"
      : opts.energyProfile === "low"
        ? "low-key"
        : "balanced";
  const arc = energyArcPhrase(opts.energyProfile, opts.sequencePhases ?? null);

  const article = /^[aeiou]/i.test(scene) ? "An" : "A";
  return `${article} ${scene} ${emotion} ${energyWord} set that ${arc}.`;
}
