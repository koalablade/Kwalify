/**
 * Gravity wells — scene/genre attraction zones (bias only, never override truth anchors).
 */

import type { RootGenre } from "../../lib/genre-taxonomy";
import type { EmotionProfile } from "../../lib/emotion";
import type { SceneFamily } from "../../lib/scene-validation";
import type { SceneGenreRouting } from "../scene-intelligence/scene-genre-routing";

export interface GravityWell {
  id: string;
  pullStrength: number;
  genreAttraction: Partial<Record<RootGenre, number>>;
}

const WELL_PRESETS: {
  id: string;
  re: RegExp;
  sceneFamilies?: SceneFamily[];
  attraction: Partial<Record<RootGenre, number>>;
  pull: number;
}[] = [
  {
    id: "country_road_trip",
    re: /\b(country|road trip|nashville|highway|americana|outlaw)\b/i,
    attraction: { country: 0.22, folk: 0.08, rock: 0.04 },
    pull: 0.14,
  },
  {
    id: "late_night_drive",
    re: /\b(late night|night drive|2\s*am|midnight|motorway|neon)\b/i,
    sceneFamilies: ["night_introspective"],
    attraction: { indie: 0.14, electronic: 0.1, rnb: 0.08, jazz: 0.06 },
    pull: 0.12,
  },
  {
    id: "nostalgic_indie",
    re: /\b(nostalg|memory|take me back|forgot you loved|childhood)\b/i,
    sceneFamilies: ["memory_nostalgia"],
    attraction: { indie: 0.16, pop: 0.08, folk: 0.1, soul: 0.06 },
    pull: 0.13,
  },
  {
    id: "sun_warm_day",
    re: /\b(sun|sunny|summer day|golden hour|warm day|feel(s)? like sun)\b/i,
    sceneFamilies: ["sun_day"],
    attraction: { pop: 0.12, soul: 0.1, rnb: 0.08, indie: 0.06 },
    pull: 0.11,
  },
  {
    id: "social_drive",
    re: /\b(friends|reunion|windows down|after seeing friends)\b/i,
    sceneFamilies: ["social_friends"],
    attraction: { pop: 0.14, hip_hop: 0.08, rnb: 0.08, electronic: 0.06 },
    pull: 0.1,
  },
];

export function resolveGravityWells(opts: {
  vibe: string;
  sceneFamily: SceneFamily;
  sceneRouting: SceneGenreRouting;
  emotionProfile: EmotionProfile;
}): GravityWell[] {
  const lower = opts.vibe.toLowerCase();
  const wells: GravityWell[] = [];

  for (const preset of WELL_PRESETS) {
    const sceneOk =
      !preset.sceneFamilies || preset.sceneFamilies.includes(opts.sceneFamily);
    if (!preset.re.test(lower) && !sceneOk) continue;
    if (!preset.re.test(lower) && sceneOk && preset.sceneFamilies) {
      /* scene-only match with weaker pull */
    }

    const genreAttraction = { ...preset.attraction };
    for (const g of opts.sceneRouting.boostedGenres) {
      genreAttraction[g] = (genreAttraction[g] ?? 0) + 0.06;
    }

    let pull = preset.pull;
    if (opts.emotionProfile.nostalgia > 0.5 && preset.id.includes("nostalg")) pull += 0.04;
    if (opts.emotionProfile.energy > 0.6 && preset.id.includes("drive")) pull += 0.03;

    wells.push({
      id: preset.id,
      pullStrength: Math.min(0.2, pull),
      genreAttraction,
    });
  }

  if (wells.length === 0 && opts.sceneRouting.boostedGenres.length > 0) {
    const genreAttraction: Partial<Record<RootGenre, number>> = {};
    for (const g of opts.sceneRouting.boostedGenres.slice(0, 4)) {
      genreAttraction[g] = 0.1;
    }
    wells.push({
      id: "scene_routing_well",
      pullStrength: 0.08,
      genreAttraction,
    });
  }

  return wells;
}

export function gravityWellPullForGenre(
  genre: RootGenre,
  wells: GravityWell[]
): number {
  let pull = 0;
  for (const w of wells) {
    const att = w.genreAttraction[genre] ?? 0;
    if (att > 0) pull += att * w.pullStrength * 4;
  }
  return Math.min(0.22, pull);
}
