import type { EmotionProfile } from "../emotion";
import type { MusicBehaviourModel, WorldUnderstandingResult } from "./types";

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function applyWorldUnderstandingToProfile(
  profile: EmotionProfile,
  world: WorldUnderstandingResult,
  weight = 0.32,
): EmotionProfile {
  const w = clamp01(weight) * clamp01(world.confidence);
  if (w <= 0.02) return profile;

  const energy = world.musicBehaviour.energy;
  const hasLoneliness = world.taxonomy.emotion.some((e) => /lonely|loneliness|solitary/i.test(e));
  const hasPeace = world.taxonomy.emotion.some((e) => /peace|calm|quiet/i.test(e));
  const hasNostalgia = world.taxonomy.emotion.some((e) => /nostalgia|memory|wistful/i.test(e));
  const hasHope = world.taxonomy.emotion.some((e) => /hope|anticipation|fresh/i.test(e));
  const hasSadness = world.taxonomy.emotion.some((e) => /sad|grief|loss|melanchol/i.test(e));

  const lerp = (a: number, b: number) => a * (1 - w) + b * w;

  let valence = profile.valence;
  if (hasSadness) valence = lerp(valence, 0.32);
  else if (hasHope) valence = lerp(valence, 0.68);
  else if (hasPeace) valence = lerp(valence, 0.62);

  let calm = profile.calm;
  if (hasPeace || world.musicBehaviour.textures.some((t) => /ambient|soft|cosy/i.test(t))) {
    calm = lerp(calm, 0.72);
  }

  let nostalgia = profile.nostalgia;
  if (hasNostalgia) nostalgia = lerp(nostalgia, 0.7);

  let tension = profile.tension;
  if (hasLoneliness && !hasPeace) tension = lerp(tension, 0.45);
  else if (hasPeace) tension = lerp(tension, 0.22);

  const next: EmotionProfile = {
    ...profile,
    energy: lerp(profile.energy, energy),
    valence,
    calm,
    nostalgia,
    tension,
  };

  if (!next.environment && world.taxonomy.environment.length > 0) {
    const env = world.taxonomy.environment[0].toLowerCase();
    if (/car|motorway|drive|road/i.test(env)) next.environment = "car";
    else if (/home|bedroom|flat|house/i.test(env)) next.environment = "home";
    else if (/beach|coast|sea/i.test(env)) next.environment = "beach";
    else if (/city|street|urban/i.test(env)) next.environment = "city";
    else if (/country|lane|rural/i.test(env)) next.environment = "countryside";
  }

  if (!next.timeOfDay && world.taxonomy.environment.some((e) => /night|midnight|late/i.test(e))) {
    next.timeOfDay = "night";
  }

  if (!next.motionState && world.taxonomy.activity.some((a) => /driv|travel|walk/i.test(a))) {
    next.motionState = "moving";
  }

  const fp = world.semanticMoment;
  if (fp && fp.confidence >= 0.3) {
    if (!next.timeOfDay && fp.time.values.some((t) => /night|midnight|late/i.test(t))) {
      next.timeOfDay = "night";
    }
    if (!next.environment && fp.environment.values.length > 0) {
      const env = fp.environment.values[0].toLowerCase();
      if (/car|motorway|drive|road/i.test(env)) next.environment = "car";
      else if (/home|bedroom|flat|house/i.test(env)) next.environment = "home";
      else if (/train|rail/i.test(env)) next.environment = "train";
    }
    next.energy = lerp(next.energy, fp.playlistBehaviour.energy);
  }

  const hx = world.humanExperience;
  if (hx && hx.playlistIntentConfidence >= 0.5) {
    const hxWeight = w * 0.45;
    if (hx.playlistIntent === "recover" || hx.playlistIntent === "relax") {
      next.calm = lerp(next.calm, 0.75);
      next.tension = lerp(next.tension, 0.25);
      next.energy = lerp(next.energy, Math.min(next.energy, 0.45));
    }
    if (hx.playlistIntent === "remember" || hx.playlistIntent === "nostalgia") {
      next.nostalgia = lerp(next.nostalgia, 0.72);
    }
    if (hx.inferredQualities.some((q) => /relief|safety|decompression/i.test(q))) {
      next.valence = lerp(next.valence, 0.58);
      next.calm = lerp(next.calm, 0.7);
    }
    if (world.emotionalArc?.phases.length) {
      const opening = world.emotionalArc.phases[0]?.emotion ?? "";
      if (/exhaustion|grief|stress/i.test(opening)) {
        next.energy = lerp(next.energy, 0.35);
      }
    }
  }

  return next;
}
