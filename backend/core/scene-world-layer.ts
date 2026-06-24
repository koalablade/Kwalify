/**
 * Scene World Layer — structural playlist-world construction for soft scene prompts.
 *
 * Humans pick a world first, then tracks. This module runs before ranking:
 * extract scene → choose archetype → anchor world → score membership.
 */

import { buildPromptSceneProfile } from "../lib/scene-semantic-retrieval";
import type { PromptSceneProfile } from "../lib/track-semantic-types";
import {
  enrichSceneWorldWithClusters,
  type PlaylistAdjacencyInput,
  type SceneCohesionClusterContext,
} from "./scene-cohesion-clusters";
import { getGenreFamily } from "./v3/global-diversity-controller";
import type { LockedIntent } from "./v3/intent";

export type SceneDescriptor = {
  setting: string;
  energy: string;
  socialContext: string;
  season: string | null;
  timeOfDay: string | null;
  emotionalDirection: string;
  activity: string | null;
};

export type PlaylistArchetype = {
  id: string;
  label: string;
  curatorVoice: string;
  genreFamilies: string[];
  secondaryFamilies: string[];
  excludedFamilies: string[];
  texture: "acoustic" | "rhythmic" | "balanced" | "dense";
  targetEnergy: number;
  targetValence: number;
  targetDanceability: number;
  targetAcousticness: number;
  narrativeTags: string[];
};

export type WorldAnchorTrack = {
  trackId: string;
  anchorScore: number;
};

export type SceneWorldAnchorStats = {
  avgEnergy: number;
  avgValence: number;
  avgDanceability: number;
  avgAcousticness: number;
  dominantFamilies: string[];
  dominantTexture: PlaylistArchetype["texture"];
};

export type SceneWorldContext = {
  active: boolean;
  strictMode: boolean;
  descriptor: SceneDescriptor;
  archetype: PlaylistArchetype;
  candidateArchetypes: PlaylistArchetype[];
  anchors: WorldAnchorTrack[];
  anchorTrackIds: Set<string>;
  anchorStats: SceneWorldAnchorStats;
  sceneClusters: SceneCohesionClusterContext | null;
};

export type SceneWorldTrack = {
  trackId: string;
  artistName?: string | null;
  genrePrimary?: string | null;
  genreFamily?: string | null;
  energy?: number | null;
  valence?: number | null;
  danceability?: number | null;
  acousticness?: number | null;
  tempo?: number | null;
  speechiness?: number | null;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function feature(value: number | null | undefined, fallback = 0.5): number {
  return typeof value === "number" && Number.isFinite(value) ? clamp01(value) : fallback;
}

function familyOf(track: SceneWorldTrack): string {
  const raw = track.genreFamily ?? track.genrePrimary ?? "unknown";
  return getGenreFamily(raw);
}

function textureBucket(track: SceneWorldTrack): PlaylistArchetype["texture"] {
  const acoustic = feature(track.acousticness);
  const dance = feature(track.danceability);
  if (acoustic >= 0.55) return "acoustic";
  if (dance >= 0.65) return "rhythmic";
  if (acoustic <= 0.25 && dance <= 0.45) return "dense";
  return "balanced";
}

export function isSoftScenePrompt(vibe: string, lockedIntent: LockedIntent): boolean {
  if (lockedIntent.genreFamilies.length > 0 || lockedIntent.eraRange) return false;
  const lower = vibe.toLowerCase();
  if (/\b(?:only|just)\s+(?:rock|pop|hip.?hop|rap|metal|jazz|country|techno|house|drum and bass|dnb)\b/.test(lower)) {
    return false;
  }
  return (
    lockedIntent.mood.length > 0 ||
    !!lockedIntent.activity ||
    !!lockedIntent.energy ||
    /\b(?:morning|evening|night|sunset|sunrise|commute|walk|drive|driving|study|gym|cozy|rainy|summer|sunday|feel.?good|getting ready|late.?night|optimistic|reflective|think(?:ing)?|scene|vibe|feeling)\b/i.test(vibe)
  );
}

export function extractSceneDescriptor(
  vibe: string,
  lockedIntent: LockedIntent,
  profile: PromptSceneProfile = buildPromptSceneProfile(vibe),
): SceneDescriptor {
  const lower = vibe.toLowerCase();
  let setting = "open";
  if (/\b(?:commute|getting ready|morning routine|start to the day)\b/.test(lower)) setting = "morning commute";
  else if (/\b(?:rainy|rain)\b/.test(lower) && /\b(?:walk|city|street)\b/.test(lower)) setting = "rainy city walk";
  else if (/\b(?:sunday|cozy)\b/.test(lower)) setting = "cozy home morning";
  else if (/\b(?:sunset|golden hour)\b/.test(lower) && /\b(?:drive|driving|road)\b/.test(lower)) setting = "sunset drive";
  else if (/\b(?:late.?night|midnight)\b/.test(lower)) setting = "late night interior";
  else if (/\b(?:study|studying|focus|thinking)\b/.test(lower)) setting = "quiet focus space";
  else if (/\b(?:gym|workout|training)\b/.test(lower)) setting = "gym floor";
  else if (profile.places.includes("city")) setting = "urban";
  else if (profile.activities.includes("driving")) setting = "driving";

  let energy = "balanced";
  if (lockedIntent.energy === "high" || /\b(?:hype|pump|boost|energ(?:y|ised|ized)|uplift)\b/.test(lower)) {
    energy = "positive uplift";
  } else if (lockedIntent.energy === "low" || /\b(?:calm|soft|peaceful|quiet|gentle)\b/.test(lower)) {
    energy = "calm warmth";
  } else if (/\b(?:reflect|melanchol|rainy|late.?night)\b/.test(lower)) {
    energy = "reflective";
  }

  let socialContext = "personal";
  if (/\b(?:party|friends|mates|club|social)\b/.test(lower)) socialContext = "social";
  else if (/\b(?:alone|solitude|by myself)\b/.test(lower)) socialContext = "solitary";

  let season: string | null = null;
  if (/\b(?:summer|sunshine|sunny|beach)\b/.test(lower)) season = "summer";
  else if (/\b(?:winter|cold|snow)\b/.test(lower)) season = "winter";
  else if (/\b(?:autumn|fall)\b/.test(lower)) season = "autumn";

  let timeOfDay: string | null = null;
  if (/\b(?:morning|sunrise|dawn|breakfast|getting ready)\b/.test(lower)) timeOfDay = "morning";
  else if (/\b(?:afternoon|midday|sunday)\b/.test(lower)) timeOfDay = "afternoon";
  else if (/\b(?:sunset|golden hour|evening|dusk)\b/.test(lower)) timeOfDay = "evening";
  else if (/\b(?:late.?night|midnight|2\s?am|3\s?am)\b/.test(lower)) timeOfDay = "late_night";
  else if (profile.times.includes("night")) timeOfDay = "late_night";

  let emotionalDirection = "steady";
  if (/\b(?:optimistic|hope|forward|hype|uplift|feel.?good)\b/.test(lower)) emotionalDirection = "forward";
  else if (/\b(?:reflect|melanchol|rainy|think(?:ing)?|introspect)\b/.test(lower)) emotionalDirection = "inward";
  else if (/\b(?:cozy|warm|soft|gentle)\b/.test(lower)) emotionalDirection = "comfort";

  let activity: string | null = null;
  if (/\bgetting ready\b/.test(lower)) activity = "getting ready";
  else if (/\b(?:commute|commuting)\b/.test(lower)) activity = "commute";
  else if (/\b(?:walk|walking)\b/.test(lower)) activity = "walking";
  else if (/\b(?:drive|driving)\b/.test(lower)) activity = "driving";
  else if (/\b(?:study|studying|focus)\b/.test(lower)) activity = "study";
  else if (/\b(?:gym|workout)\b/.test(lower)) activity = "workout";
  else activity = lockedIntent.activity ?? profile.activities[0] ?? null;

  return {
    setting,
    energy,
    socialContext,
    season,
    timeOfDay,
    emotionalDirection,
    activity,
  };
}

function archetype(
  partial: Omit<PlaylistArchetype, "id"> & { id: string },
): PlaylistArchetype {
  return partial;
}

export function generateArchetypeCandidates(descriptor: SceneDescriptor): PlaylistArchetype[] {
  const key = [
    descriptor.setting,
    descriptor.energy,
    descriptor.season ?? "",
    descriptor.timeOfDay ?? "",
  ].join("|");

  if (
    descriptor.setting === "morning commute" ||
    (descriptor.season === "summer" && descriptor.timeOfDay === "morning" && descriptor.energy === "positive uplift")
  ) {
    return [
      archetype({
        id: "indie_pop_sunshine_commute",
        label: "indie-pop sunshine commute",
        curatorVoice: "indie-pop morning person who wants bright, forward-moving songs",
        genreFamilies: ["indie", "pop"],
        secondaryFamilies: ["electronic"],
        excludedFamilies: ["metal", "hip_hop", "classical", "soundtrack"],
        texture: "rhythmic",
        targetEnergy: 0.62,
        targetValence: 0.68,
        targetDanceability: 0.62,
        targetAcousticness: 0.32,
        narrativeTags: ["sunshine", "commute", "feel-good", "morning"],
      }),
      archetype({
        id: "upbeat_alt_morning_drive",
        label: "upbeat alternative morning drive",
        curatorVoice: "alternative fan curating confident morning momentum",
        genreFamilies: ["indie", "rock"],
        secondaryFamilies: ["pop"],
        excludedFamilies: ["metal", "hip_hop", "country"],
        texture: "balanced",
        targetEnergy: 0.66,
        targetValence: 0.62,
        targetDanceability: 0.56,
        targetAcousticness: 0.28,
        narrativeTags: ["morning", "drive", "alt", "uplift"],
      }),
      archetype({
        id: "modern_feelgood_pop",
        label: "modern feel-good pop discovery",
        curatorVoice: "pop-focused curator building a polished getting-ready playlist",
        genreFamilies: ["pop"],
        secondaryFamilies: ["indie", "electronic"],
        excludedFamilies: ["metal", "hip_hop", "punk", "country"],
        texture: "rhythmic",
        targetEnergy: 0.64,
        targetValence: 0.72,
        targetDanceability: 0.68,
        targetAcousticness: 0.24,
        narrativeTags: ["pop", "feel-good", "modern", "bright"],
      }),
    ];
  }

  if (descriptor.setting === "rainy city walk" || (descriptor.energy === "reflective" && descriptor.setting.includes("walk"))) {
    return [
      archetype({
        id: "indie_folk_rain_walk",
        label: "indie folk rainy walk",
        curatorVoice: "melancholy urban walker with indie and folk leanings",
        genreFamilies: ["indie", "folk"],
        secondaryFamilies: ["rock", "soul"],
        excludedFamilies: ["metal", "hip_hop", "electronic"],
        texture: "acoustic",
        targetEnergy: 0.42,
        targetValence: 0.38,
        targetDanceability: 0.38,
        targetAcousticness: 0.58,
        narrativeTags: ["rain", "walk", "reflective", "city"],
      }),
      archetype({
        id: "mellow_alt_stroll",
        label: "mellow alternative stroll",
        curatorVoice: "alternative curator for grey-day city movement",
        genreFamilies: ["indie", "rock"],
        secondaryFamilies: ["folk"],
        excludedFamilies: ["metal", "hip_hop", "pop"],
        texture: "balanced",
        targetEnergy: 0.46,
        targetValence: 0.42,
        targetDanceability: 0.42,
        targetAcousticness: 0.45,
        narrativeTags: ["rain", "alternative", "stroll"],
      }),
    ];
  }

  if (descriptor.setting === "cozy home morning" || (descriptor.emotionalDirection === "comfort" && descriptor.timeOfDay === "morning")) {
    return [
      archetype({
        id: "soft_indie_morning",
        label: "soft indie morning warmth",
        curatorVoice: "cozy morning curator favoring gentle indie and folk",
        genreFamilies: ["indie", "folk"],
        secondaryFamilies: ["pop", "soul"],
        excludedFamilies: ["metal", "hip_hop", "electronic"],
        texture: "acoustic",
        targetEnergy: 0.44,
        targetValence: 0.58,
        targetDanceability: 0.42,
        targetAcousticness: 0.56,
        narrativeTags: ["cozy", "morning", "soft", "warm"],
      }),
      archetype({
        id: "light_pop_sunday",
        label: "light pop Sunday ease",
        curatorVoice: "easy Sunday curator with light pop and soul",
        genreFamilies: ["pop", "soul"],
        secondaryFamilies: ["indie"],
        excludedFamilies: ["metal", "hip_hop", "rock"],
        texture: "balanced",
        targetEnergy: 0.48,
        targetValence: 0.64,
        targetDanceability: 0.48,
        targetAcousticness: 0.42,
        narrativeTags: ["sunday", "happy", "light", "warm"],
      }),
    ];
  }

  if (descriptor.setting === "late night interior" || descriptor.timeOfDay === "late_night") {
    return [
      archetype({
        id: "late_night_indie",
        label: "late-night indie introspection",
        curatorVoice: "late-night listener with sparse indie and electronic textures",
        genreFamilies: ["indie", "electronic"],
        secondaryFamilies: ["ambient", "rock"],
        excludedFamilies: ["metal", "country", "hip_hop"],
        texture: "balanced",
        targetEnergy: 0.38,
        targetValence: 0.34,
        targetDanceability: 0.36,
        targetAcousticness: 0.42,
        narrativeTags: ["late-night", "introspective", "quiet"],
      }),
      archetype({
        id: "nocturnal_alt",
        label: "nocturnal alternative mood",
        curatorVoice: "alternative night curator with moody but not heavy selections",
        genreFamilies: ["indie", "rock"],
        secondaryFamilies: ["electronic"],
        excludedFamilies: ["metal", "country", "pop"],
        texture: "dense",
        targetEnergy: 0.42,
        targetValence: 0.36,
        targetDanceability: 0.40,
        targetAcousticness: 0.35,
        narrativeTags: ["night", "alternative", "mood"],
      }),
    ];
  }

  if (descriptor.setting === "quiet focus space" || descriptor.activity === "focus") {
    return [
      archetype({
        id: "ambient_focus_study",
        label: "ambient focus study",
        curatorVoice: "study session curator with low-distraction ambient and indie",
        genreFamilies: ["ambient", "indie"],
        secondaryFamilies: ["electronic", "classical"],
        excludedFamilies: ["metal", "hip_hop", "rock", "pop"],
        texture: "acoustic",
        targetEnergy: 0.34,
        targetValence: 0.46,
        targetDanceability: 0.32,
        targetAcousticness: 0.58,
        narrativeTags: ["focus", "study", "thinking", "calm"],
      }),
    ];
  }

  if (descriptor.setting === "sunset drive") {
    return [
      archetype({
        id: "sunset_indie_drive",
        label: "sunset indie drive",
        curatorVoice: "golden-hour driver with cinematic indie and soft rock",
        genreFamilies: ["indie", "rock"],
        secondaryFamilies: ["pop", "folk"],
        excludedFamilies: ["metal", "hip_hop", "electronic"],
        texture: "balanced",
        targetEnergy: 0.52,
        targetValence: 0.52,
        targetDanceability: 0.48,
        targetAcousticness: 0.38,
        narrativeTags: ["sunset", "drive", "open-road"],
      }),
    ];
  }

  if (descriptor.setting === "gym floor" || descriptor.energy === "positive uplift") {
    return [
      archetype({
        id: "gym_confidence_boost",
        label: "gym confidence boost",
        curatorVoice: "workout curator with high-energy pop, hip-hop, and electronic",
        genreFamilies: ["hip_hop", "electronic", "pop"],
        secondaryFamilies: ["rock"],
        excludedFamilies: ["folk", "ambient", "classical"],
        texture: "rhythmic",
        targetEnergy: 0.78,
        targetValence: 0.62,
        targetDanceability: 0.72,
        targetAcousticness: 0.18,
        narrativeTags: ["gym", "confidence", "energy"],
      }),
    ];
  }

  return [
    archetype({
      id: "balanced_scene_default",
      label: "balanced scene default",
      curatorVoice: "general scene curator with cohesive indie-pop balance",
      genreFamilies: ["indie", "pop"],
      secondaryFamilies: ["rock", "electronic"],
      excludedFamilies: ["metal"],
      texture: "balanced",
      targetEnergy: 0.52,
      targetValence: 0.54,
      targetDanceability: 0.50,
      targetAcousticness: 0.40,
      narrativeTags: ["scene", "balanced"],
    }),
  ];
}

function stableUnitHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

export function selectPlaylistArchetype(
  candidates: PlaylistArchetype[],
  vibe: string,
  seed = "scene-world",
): PlaylistArchetype {
  if (candidates.length === 1) return candidates[0]!;
  const scored = candidates.map((candidate) => {
    let score = 0.5;
    const lower = vibe.toLowerCase();
    for (const tag of candidate.narrativeTags) {
      if (lower.includes(tag.replace(/-/g, " ")) || lower.includes(tag)) score += 0.12;
    }
    if (/\b(?:pop|mainstream)\b/.test(lower) && candidate.genreFamilies.includes("pop")) score += 0.10;
    if (/\b(?:indie|alternative)\b/.test(lower) && candidate.genreFamilies.includes("indie")) score += 0.10;
    if (/\b(?:hype|energy|boost)\b/.test(lower) && candidate.targetEnergy >= 0.60) score += 0.08;
    if (/\b(?:soft|cozy|calm)\b/.test(lower) && candidate.targetEnergy <= 0.50) score += 0.08;
    score += stableUnitHash(`${seed}:${candidate.id}`) * 0.04;
    return { candidate, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]!.candidate;
}

function archetypeFitScore(track: SceneWorldTrack, archetypeDef: PlaylistArchetype): number {
  const family = familyOf(track);
  const energy = feature(track.energy);
  const valence = feature(track.valence);
  const dance = feature(track.danceability);
  const acoustic = feature(track.acousticness);
  const texture = textureBucket(track);

  if (archetypeDef.excludedFamilies.includes(family)) return 0;
  const familyOk =
    archetypeDef.genreFamilies.includes(family) ||
    archetypeDef.secondaryFamilies.includes(family) ||
    family === "unknown";

  const energyFit = 1 - Math.min(1, Math.abs(energy - archetypeDef.targetEnergy) * 2.2);
  const valenceFit = 1 - Math.min(1, Math.abs(valence - archetypeDef.targetValence) * 2.0);
  const danceFit = 1 - Math.min(1, Math.abs(dance - archetypeDef.targetDanceability) * 1.8);
  const acousticFit = 1 - Math.min(1, Math.abs(acoustic - archetypeDef.targetAcousticness) * 1.6);
  const textureFit = texture === archetypeDef.texture ? 1 : texture === "balanced" || archetypeDef.texture === "balanced" ? 0.78 : 0.55;

  const audioScore = clamp01(energyFit * 0.28 + valenceFit * 0.28 + danceFit * 0.22 + acousticFit * 0.12 + textureFit * 0.10);
  if (!familyOk && family !== "unknown") return audioScore * 0.35;
  if (family === "unknown") return audioScore * 0.82;
  return clamp01(audioScore * 0.88 + 0.12);
}

export function buildWorldAnchors(
  tracks: SceneWorldTrack[],
  archetypeDef: PlaylistArchetype,
  limit = 18,
): WorldAnchorTrack[] {
  const minAnchors = 10;
  const scored = tracks
    .map((track) => ({
      trackId: track.trackId,
      anchorScore: archetypeFitScore(track, archetypeDef),
    }))
    .filter((row) => row.anchorScore >= 0.52)
    .sort((a, b) => b.anchorScore - a.anchorScore);

  const chosen = scored.slice(0, Math.max(minAnchors, Math.min(limit, scored.length)));
  if (chosen.length >= minAnchors) return chosen;

  return tracks
    .map((track) => ({
      trackId: track.trackId,
      anchorScore: archetypeFitScore(track, archetypeDef),
    }))
    .sort((a, b) => b.anchorScore - a.anchorScore)
    .slice(0, Math.max(minAnchors, Math.min(limit, tracks.length)));
}

function computeAnchorStats(
  tracks: SceneWorldTrack[],
  anchors: WorldAnchorTrack[],
  archetypeDef: PlaylistArchetype,
): SceneWorldAnchorStats {
  const anchorTracks = tracks.filter((track) => anchors.some((anchor) => anchor.trackId === track.trackId));
  const source = anchorTracks.length > 0 ? anchorTracks : tracks.slice(0, Math.min(12, tracks.length));
  const avgEnergy = source.reduce((sum, track) => sum + feature(track.energy), 0) / Math.max(1, source.length);
  const avgValence = source.reduce((sum, track) => sum + feature(track.valence), 0) / Math.max(1, source.length);
  const avgDanceability = source.reduce((sum, track) => sum + feature(track.danceability), 0) / Math.max(1, source.length);
  const avgAcousticness = source.reduce((sum, track) => sum + feature(track.acousticness), 0) / Math.max(1, source.length);

  const familyCounts = new Map<string, number>();
  for (const track of source) {
    const family = familyOf(track);
    if (family === "unknown") continue;
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
  }
  const dominantFamilies = [...familyCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([family]) => family);
  if (dominantFamilies.length === 0) dominantFamilies.push(...archetypeDef.genreFamilies.slice(0, 2));

  const textureCounts = new Map<string, number>();
  for (const track of source) {
    const bucket = textureBucket(track);
    textureCounts.set(bucket, (textureCounts.get(bucket) ?? 0) + 1);
  }
  const dominantTexture = ([...textureCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? archetypeDef.texture) as PlaylistArchetype["texture"];

  return {
    avgEnergy,
    avgValence,
    avgDanceability,
    avgAcousticness,
    dominantFamilies,
    dominantTexture,
  };
}

export function computeWorldMembershipScore(
  track: SceneWorldTrack,
  context: SceneWorldContext,
): number {
  if (!context.active) return 1;

  const { archetype: archetypeDef, anchorStats, anchors } = context;
  const family = familyOf(track);
  const energy = feature(track.energy);
  const valence = feature(track.valence);
  const dance = feature(track.danceability);
  const acoustic = feature(track.acousticness);
  const texture = textureBucket(track);

  if (archetypeDef.excludedFamilies.includes(family)) return 0.08;

  const anchorRow = anchors.find((row) => row.trackId === track.trackId);
  const anchorBoost = anchorRow ? clamp01(0.55 + anchorRow.anchorScore * 0.45) : 0;

  const familyInWorld =
    archetypeDef.genreFamilies.includes(family) ||
    archetypeDef.secondaryFamilies.includes(family) ||
    anchorStats.dominantFamilies.includes(family);

  let familyScore = 0.22;
  if (familyInWorld) {
    const secondaryOnly =
      !archetypeDef.genreFamilies.includes(family) &&
      archetypeDef.secondaryFamilies.includes(family);
    if (secondaryOnly && context.sceneClusters && context.strictMode) {
      familyScore = 0.52;
    } else {
      familyScore = 0.92;
    }
  } else if (family === "unknown") familyScore = 0.48;
  else familyScore = 0.18;

  const energyFit = 1 - Math.min(1, Math.abs(energy - anchorStats.avgEnergy) * 2.4);
  const valenceFit = 1 - Math.min(1, Math.abs(valence - anchorStats.avgValence) * 2.2);
  const danceFit = 1 - Math.min(1, Math.abs(dance - anchorStats.avgDanceability) * 1.8);
  const acousticFit = 1 - Math.min(1, Math.abs(acoustic - anchorStats.avgAcousticness) * 1.6);
  const textureFit = texture === anchorStats.dominantTexture ? 1 : texture === "balanced" ? 0.72 : 0.48;

  const archetypeFit = archetypeFitScore(track, archetypeDef);
  const audioWorld = clamp01(energyFit * 0.26 + valenceFit * 0.24 + danceFit * 0.18 + acousticFit * 0.12 + textureFit * 0.20);

  if (family === "unknown") {
    return clamp01(audioWorld * 0.55 + archetypeFit * 0.25 + anchorBoost * 0.20);
  }

  return clamp01(familyScore * 0.42 + audioWorld * 0.33 + archetypeFit * 0.15 + anchorBoost * 0.10);
}

export function buildSceneWorldContext(opts: {
  vibe: string;
  lockedIntent: LockedIntent;
  tracks: SceneWorldTrack[];
  seed?: string;
  playlistAdjacency?: PlaylistAdjacencyInput[];
  likedAdjacency?: Array<{ trackId: string; addedAt?: string | Date | null }>;
}): SceneWorldContext | null {
  if (!isSoftScenePrompt(opts.vibe, opts.lockedIntent)) return null;

  const profile = buildPromptSceneProfile(opts.vibe);
  const descriptor = extractSceneDescriptor(opts.vibe, opts.lockedIntent, profile);
  const candidateArchetypes = generateArchetypeCandidates(descriptor);
  const archetypeDef = selectPlaylistArchetype(candidateArchetypes, opts.vibe, opts.seed ?? opts.vibe);
  const anchors = buildWorldAnchors(opts.tracks, archetypeDef);
  const anchorStats = computeAnchorStats(opts.tracks, anchors, archetypeDef);

  const base: SceneWorldContext = {
    active: true,
    strictMode: true,
    descriptor,
    archetype: archetypeDef,
    candidateArchetypes,
    anchors,
    anchorTrackIds: new Set(anchors.map((row) => row.trackId)),
    anchorStats,
    sceneClusters: null,
  };

  return enrichSceneWorldWithClusters(base, opts.tracks, {
    playlistAdjacency: opts.playlistAdjacency,
    likedAdjacency: opts.likedAdjacency,
  });
}

export function blendScoreWithWorldMembership(
  relevanceScore: number,
  worldMembership: number,
  strictMode: boolean,
): number {
  if (!strictMode) return relevanceScore * (0.55 + worldMembership * 0.45);
  return relevanceScore * (0.22 + worldMembership * 0.78);
}
