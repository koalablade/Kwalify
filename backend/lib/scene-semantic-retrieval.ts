/**
 * Scene-semantic retrieval — prompt scene profile vs track semantic profile.
 */

import { splitSceneContracts } from "../core/dominant-intent-contract";
import {
  emptySceneProfile,
  signatureFromTags,
  type PromptSceneProfile,
  type SemanticMatchDiagnostics,
  type TrackSemanticProfile,
} from "./track-semantic-types";
import { enrichTrackSemanticProfile, type EnrichmentTrackInput } from "./track-semantic-enrichment";
import { artistEcosystemBoost, type ArtistEcosystemGraph } from "./artist-ecosystem-graph";

const PROMPT_LEXICON: Array<{ dimension: keyof PromptSceneProfile; tag: string; pattern: RegExp }> = [
  { dimension: "places", tag: "city", pattern: /\b(tokyo|city|urban|street|downtown|metropolis)\b/i },
  { dimension: "places", tag: "motorway", pattern: /\b(motorway|highway|road|drive|autobahn)\b/i },
  { dimension: "places", tag: "garage", pattern: /\b(garage|volvo|workshop|repair|fixing)\b/i },
  { dimension: "places", tag: "warehouse", pattern: /\b(warehouse|rave|bunker|club)\b/i },
  { dimension: "places", tag: "train", pattern: /\b(train|station|platform|last train)\b/i },
  { dimension: "times", tag: "night", pattern: /\b(night|midnight|3\s?am|2\s?am|late.?night)\b/i },
  { dimension: "times", tag: "sunrise", pattern: /\b(sunrise|dawn|morning after)\b/i },
  { dimension: "activities", tag: "driving", pattern: /\b(driv|road|motorway|cruise)\b/i },
  { dimension: "activities", tag: "repairing", pattern: /\b(fix|repair|garage|mechanic|volvo)\b/i },
  { dimension: "activities", tag: "walking", pattern: /\b(walk|stroll|empty streets)\b/i },
  { dimension: "weather", tag: "rain", pattern: /\b(rain|rainy|wet|storm)\b/i },
  { dimension: "weather", tag: "fog", pattern: /\b(fog|mist|haze)\b/i },
  { dimension: "atmospheres", tag: "lonely", pattern: /\b(lonely|solitude|alone|empty|neon-lit loneliness)\b/i },
  { dimension: "atmospheres", tag: "reflective", pattern: /\b(reflect|thought|missed|bad breakup)\b/i },
  { dimension: "atmospheres", tag: "nostalgic", pattern: /\b(nostalg|1997|forgotten|flyer|memory)\b/i },
  { dimension: "atmospheres", tag: "euphoric", pattern: /\b(euphor|party|club|anthem)\b/i },
  { dimension: "atmospheres", tag: "tense", pattern: /\b(tense|anxious|bad breakup)\b/i },
];

const PROMPT_CULTURAL: Array<{ tag: string; pattern: RegExp }> = [
  { tag: "neon", pattern: /\b(neon|city.?lights?|tokyo)\b/i },
  { tag: "urban", pattern: /\b(urban|city|tokyo|street)\b/i },
  { tag: "underground", pattern: /\b(underground|warehouse|rave|flyer)\b/i },
  { tag: "cinematic", pattern: /\b(cinematic|scene|visual)\b/i },
  { tag: "nostalgic", pattern: /\b(nostalg|1997|forgotten|retro)\b/i },
  { tag: "late-night", pattern: /\b(late.?night|3\s?am|2\s?am|after.?hours)\b/i },
];

const PROMPT_THEMES: Array<{ tag: string; pattern: RegExp }> = [
  { tag: "night", pattern: /\b(night|midnight|3\s?am)\b/i },
  { tag: "escape", pattern: /\b(escape|drive|road)\b/i },
  { tag: "loss", pattern: /\b(breakup|missed|gone|regret)\b/i },
  { tag: "travel", pattern: /\b(train|journey|motorway|road)\b/i },
  { tag: "city", pattern: /\b(tokyo|city|urban|street)\b/i },
  { tag: "hope", pattern: /\b(hope|sunrise|tomorrow)\b/i },
];

const PROMPT_CONCEPTS: Array<{ tag: string; pattern: RegExp }> = [
  { tag: "warehouse-rave", pattern: /\b(warehouse|rave|techno)\b/i },
  { tag: "late-train-home", pattern: /\b(last train|missed the last train|platform)\b/i },
  { tag: "post-club", pattern: /\b(outside the club|cigarette|afterparty)\b/i },
  { tag: "road-trip", pattern: /\b(motorway|highway|road trip|driving home)\b/i },
  { tag: "urban-nostalgia", pattern: /\b(nostalg|city|forgotten|1997)\b/i },
  { tag: "petrol-station", pattern: /\b(petrol|gas station|forecourt)\b/i },
];

function promptRecall(promptTags: string[], trackTags: string[]): number {
  if (promptTags.length === 0) return 0;
  const setB = new Set(trackTags);
  const hits = promptTags.filter((x) => setB.has(x)).length;
  return hits / promptTags.length;
}

function overlapRatio(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const recall = promptRecall(a, b);
  const setA = new Set(a);
  const precision = b.filter((x) => setA.has(x)).length / b.length;
  return recall * 0.72 + precision * 0.28;
}

function flattenScene(profile: TrackSemanticProfile | PromptSceneProfile): string[] {
  const scene = "scene" in profile ? profile.scene : profile;
  return [
    ...scene.places,
    ...scene.times,
    ...scene.activities,
    ...scene.weather,
    ...scene.atmospheres,
  ];
}

export function buildPromptSceneProfile(prompt: string): PromptSceneProfile {
  const scene = emptySceneProfile();
  const culturalTags: string[] = [];
  const themes: string[] = [];
  const sceneConcepts: string[] = [];

  for (const entry of PROMPT_LEXICON) {
    if (entry.pattern.test(prompt)) {
      if (entry.dimension === "places") scene.places.push(entry.tag);
      else if (entry.dimension === "times") scene.times.push(entry.tag);
      else if (entry.dimension === "activities") scene.activities.push(entry.tag);
      else if (entry.dimension === "weather") scene.weather.push(entry.tag);
      else scene.atmospheres.push(entry.tag);
    }
  }
  for (const { tag, pattern } of PROMPT_CULTURAL) {
    if (pattern.test(prompt)) culturalTags.push(tag);
  }
  for (const { tag, pattern } of PROMPT_THEMES) {
    if (pattern.test(prompt)) themes.push(tag);
  }
  for (const { tag, pattern } of PROMPT_CONCEPTS) {
    if (pattern.test(prompt)) sceneConcepts.push(tag);
  }

  const dominantScene = splitSceneContracts(prompt);
  scene.places = [...new Set([...scene.places, ...dominantScene.place])];
  scene.times = [...new Set([...scene.times, ...dominantScene.time])];
  scene.atmospheres = [...new Set([...scene.atmospheres, ...dominantScene.atmosphere])];
  culturalTags.push(...dominantScene.visual.filter((v) => !culturalTags.includes(v)));

  const all = [
    ...culturalTags,
    ...flattenScene({
      culturalTags,
      themes,
      sceneConcepts,
      retrievalSignature: "",
      ...scene,
    }),
    ...themes,
    ...sceneConcepts,
  ];

  return {
    places: scene.places,
    times: scene.times,
    activities: scene.activities,
    weather: scene.weather,
    atmospheres: scene.atmospheres,
    culturalTags: [...new Set(culturalTags)],
    themes: [...new Set(themes)],
    sceneConcepts: [...new Set(sceneConcepts)],
    retrievalSignature: signatureFromTags(all),
  };
}

function titleMatchBoost(promptProfile: PromptSceneProfile, trackName: string): number {
  const title = trackName.toLowerCase();
  let bonus = 0;
  if (promptProfile.places.includes("garage") && title.includes("garage")) bonus += 0.05;
  if (promptProfile.places.includes("motorway") && (title.includes("road") || title.includes("motorway"))) bonus += 0.05;
  if (promptProfile.places.includes("city") && title.includes("city")) bonus += 0.04;
  if (promptProfile.places.includes("train") && title.includes("train")) bonus += 0.05;
  if (promptProfile.times.some((t) => t.includes("night")) && title.includes("midnight")) bonus += 0.03;
  if (promptProfile.activities.includes("repairing") && title.includes("garage")) bonus += 0.04;
  return Math.min(0.12, bonus);
}

export function scoreSemanticSceneMatch(
  promptProfile: PromptSceneProfile,
  trackProfile: TrackSemanticProfile,
  opts: {
    artistName?: string | null;
    trackName?: string | null;
    artistGraph?: ArtistEcosystemGraph | null;
    maxBoost?: number;
  } = {},
): { boost: number; diagnostics: SemanticMatchDiagnostics } {
  const sceneOverlap = overlapRatio(flattenScene(promptProfile), flattenScene(trackProfile));
  const culturalOverlap = overlapRatio(promptProfile.culturalTags, trackProfile.culturalTags);
  const themeOverlap = overlapRatio(promptProfile.themes, trackProfile.themes);
  const conceptOverlap = overlapRatio(promptProfile.sceneConcepts, trackProfile.sceneConcepts);
  const ecosystemBoost = artistEcosystemBoost(opts.artistName, opts.artistGraph);
  const titleBoost = titleMatchBoost(promptProfile, opts.trackName ?? "");

  const raw =
    sceneOverlap * 0.38 +
    culturalOverlap * 0.22 +
    themeOverlap * 0.18 +
    conceptOverlap * 0.14 +
    ecosystemBoost +
    titleBoost;

  const cap = opts.maxBoost ?? 0.28;
  const boost = Math.min(cap, raw * cap);

  return {
    boost,
    diagnostics: {
      sceneOverlap: Math.round(sceneOverlap * 1000) / 1000,
      culturalOverlap: Math.round(culturalOverlap * 1000) / 1000,
      themeOverlap: Math.round(themeOverlap * 1000) / 1000,
      conceptOverlap: Math.round(conceptOverlap * 1000) / 1000,
      ecosystemBoost: Math.round(ecosystemBoost * 1000) / 1000,
      totalBoost: Math.round(boost * 1000) / 1000,
    },
  };
}

export function semanticRetrievalBoost(
  track: EnrichmentTrackInput & { semanticProfile?: TrackSemanticProfile | null },
  promptProfile: PromptSceneProfile,
  artistGraph?: ArtistEcosystemGraph | null,
): number {
  const profile = track.semanticProfile ?? enrichTrackSemanticProfile(track);
  return scoreSemanticSceneMatch(promptProfile, profile, {
    artistName: track.artistName,
    trackName: track.trackName,
    artistGraph,
  }).boost;
}

export function semanticSurvivalMetrics(
  promptProfile: PromptSceneProfile,
  tracks: Array<{ profile: TrackSemanticProfile; artistName?: string | null }>,
  artistGraph?: ArtistEcosystemGraph | null,
): {
  sceneSurvivalPercent: number;
  atmosphereSurvivalPercent: number;
  semanticCoherencePercent: number;
  ecosystemConsistencyPercent: number;
  promptUniquenessSignature: string;
} {
  if (tracks.length === 0) {
    return {
      sceneSurvivalPercent: 0,
      atmosphereSurvivalPercent: 0,
      semanticCoherencePercent: 0,
      ecosystemConsistencyPercent: 0,
      promptUniquenessSignature: promptProfile.retrievalSignature,
    };
  }
  const scores = tracks.map((t) => scoreSemanticSceneMatch(promptProfile, t.profile, {
    artistName: t.artistName,
    artistGraph,
  }).diagnostics);

  const sceneHits = scores.filter((s) => s.sceneOverlap >= 0.2).length;
  const atmosphereHits = tracks.filter((t) =>
    overlapRatio(promptProfile.atmospheres, t.profile.scene.atmospheres) >= 0.25
  ).length;
  const avgBoost = scores.reduce((sum, s) => sum + s.totalBoost, 0) / scores.length;
  const ecosystemHits = tracks.filter((t) =>
    artistGraph && t.artistName
      ? (artistGraph.artistToEcosystems[t.artistName.toLowerCase()] ?? []).length > 0
      : false,
  ).length;

  return {
    sceneSurvivalPercent: Math.round((sceneHits / tracks.length) * 100),
    atmosphereSurvivalPercent: Math.round((atmosphereHits / tracks.length) * 100),
    semanticCoherencePercent: Math.round(Math.min(100, avgBoost / 0.2 * 100)),
    ecosystemConsistencyPercent: Math.round((ecosystemHits / tracks.length) * 100),
    promptUniquenessSignature: promptProfile.retrievalSignature,
  };
}
