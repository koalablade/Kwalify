/**
 * Deterministic track semantic enrichment — no LLM, no external lyrics API.
 * Runs at sync time; results persisted on liked_songs.semantic_profile.
 */

import { classifyTrack } from "./genre-taxonomy";
import { buildMusicSemanticProfile } from "./music-semantic-inference";
import { parseMusicSemanticProfile } from "./music-semantic-parse";
import { emptyMusicSemanticProfile } from "./music-semantic-types";
import {
  SEMANTIC_ENRICHMENT_VERSION,
  emptySceneProfile,
  signatureFromTags,
  type SceneDimensionProfile,
  type TrackSemanticProfile,
} from "./track-semantic-types";

export type EnrichmentTrackInput = {
  trackId: string;
  trackName: string;
  artistName: string;
  albumName?: string | null;
  energy?: number | null;
  valence?: number | null;
  tempo?: number | null;
  danceability?: number | null;
  acousticness?: number | null;
  instrumentalness?: number | null;
  speechiness?: number | null;
  loudness?: number | null;
  spotifyArtistGenres?: unknown;
  albumGenres?: unknown;
  releaseYear?: number | null;
  popularity?: number | null;
  primaryArtistId?: string | null;
  artistIds?: string[] | null;
};

type LexiconEntry = { tag: string; pattern: RegExp };

const CULTURAL_LEXICON: LexiconEntry[] = [
  { tag: "neon", pattern: /\b(neon|fluorescent|city.?lights?)\b/i },
  { tag: "night-driving", pattern: /\b(night.?drive|midnight.?city|motorway|highway)\b/i },
  { tag: "urban", pattern: /\b(urban|city|downtown|metro|subway|tokyo|london|berlin)\b/i },
  { tag: "nostalgic", pattern: /\b(nostalg|memory|retro|throwback|vintage|90s|80s)\b/i },
  { tag: "late-night", pattern: /\b(late.?night|3\s?am|2\s?am|after.?hours|midnight)\b/i },
  { tag: "underground", pattern: /\b(underground|warehouse|bunker|pirate|illegal)\b/i },
  { tag: "cinematic", pattern: /\b(cinematic|soundtrack|score|theme|overture)\b/i },
  { tag: "mystery", pattern: /\b(mystery|detective|noir|whodunit|suspense|thriller)\b/i },
  { tag: "vintage", pattern: /\b(vintage|classic|timeless|retro|antique)\b/i },
  { tag: "detective", pattern: /\b(detective|investigation|sleuth|clue)\b/i },
  { tag: "industrial", pattern: /\b(industrial|factory|machine|warehouse)\b/i },
  { tag: "futuristic", pattern: /\b(future|cyber|synth|digital|chrome)\b/i },
  { tag: "coastal", pattern: /\b(beach|ocean|sea|coast|shore|tidal)\b/i },
];

const PLACE_LEXICON: LexiconEntry[] = [
  { tag: "city", pattern: /\b(city|urban|downtown|tokyo|paris|london|berlin|neon|street)\b/i },
  { tag: "countryside", pattern: /\b(country|field|farm|rural|meadow|valley)\b/i },
  { tag: "motorway", pattern: /\b(motorway|highway|freeway|road|drive|autobahn)\b/i },
  { tag: "warehouse", pattern: /\b(warehouse|bunker|factory|industrial)\b/i },
  { tag: "club", pattern: /\b(club|dancefloor|rave|afterparty)\b/i },
  { tag: "beach", pattern: /\b(beach|shore|coast|ocean|sea)\b/i },
  { tag: "garage", pattern: /\b(garage|workshop|shed|volvo|car)\b/i },
  { tag: "train", pattern: /\b(train|station|platform|last.?train|commute)\b/i },
  { tag: "bedroom", pattern: /\b(bedroom|home|apartment|flat)\b/i },
];

const TIME_LEXICON: LexiconEntry[] = [
  { tag: "sunrise", pattern: /\b(sunrise|dawn|morning|early)\b/i },
  { tag: "daytime", pattern: /\b(afternoon|daytime|noon|sunny)\b/i },
  { tag: "sunset", pattern: /\b(sunset|golden.?hour|dusk|evening)\b/i },
  { tag: "night", pattern: /\b(night|midnight|late.?night|3\s?am|2\s?am|after.?dark)\b/i },
  { tag: "late-night", pattern: /\b(late.?night|after.?hours|3\s?am|2\s?am)\b/i },
];

const ACTIVITY_LEXICON: LexiconEntry[] = [
  { tag: "driving", pattern: /\b(driv|road|motorway|highway|cruise|car)\b/i },
  { tag: "studying", pattern: /\b(study|focus|library|read|work)\b/i },
  { tag: "repairing", pattern: /\b(fix|repair|garage|wrench|mechanic|volvo)\b/i },
  { tag: "walking", pattern: /\b(walk|stroll|commute|footsteps)\b/i },
  { tag: "travelling", pattern: /\b(travel|journey|flight|train|trip)\b/i },
  { tag: "working", pattern: /\b(work|office|shift|grind)\b/i },
  { tag: "dancing", pattern: /\b(dance|club|rave|party)\b/i },
  { tag: "relaxing", pattern: /\b(chill|relax|rest|unwind)\b/i },
];

const WEATHER_LEXICON: LexiconEntry[] = [
  { tag: "rain", pattern: /\b(rain|rainy|storm|wet|drizzle)\b/i },
  { tag: "fog", pattern: /\b(fog|mist|haze|smoke)\b/i },
  { tag: "snow", pattern: /\b(snow|winter|frost|ice)\b/i },
  { tag: "heat", pattern: /\b(heat|summer|hot|sun|warm.?day)\b/i },
];

const ATMOSPHERE_LEXICON: LexiconEntry[] = [
  { tag: "lonely", pattern: /\b(lonely|alone|solitude|empty|isolated)\b/i },
  { tag: "euphoric", pattern: /\b(euphor|bliss|ecstasy|peak|anthem)\b/i },
  { tag: "reflective", pattern: /\b(reflect|thought|introspect|memory|wistful)\b/i },
  { tag: "tense", pattern: /\b(tense|anxious|dread|suspense|thriller)\b/i },
  { tag: "hopeful", pattern: /\b(hope|rise|light|tomorrow|dawn)\b/i },
  { tag: "nocturnal", pattern: /\b(nocturnal|night|midnight|moon)\b/i },
  { tag: "melancholic", pattern: /\b(sad|blue|melanchol|grief|tear)\b/i },
  { tag: "hypnotic", pattern: /\b(hypnot|trance|pulse|loop|drift)\b/i },
  { tag: "suspense", pattern: /\b(suspense|tension|thriller|noir|mystery)\b/i },
  { tag: "intellectual", pattern: /\b(intellect|clever|puzzle|study|classical)\b/i },
  { tag: "cozy", pattern: /\b(cozy|cosy|warm|fireplace|tea)\b/i },
  { tag: "epic", pattern: /\b(epic|legend|quest|hero|saga)\b/i },
  { tag: "foreboding", pattern: /\b(dread|dark|ominous|haunt|horror)\b/i },
];

const THEME_LEXICON: LexiconEntry[] = [
  { tag: "night", pattern: /\b(night|midnight|dark|moon|stars)\b/i },
  { tag: "escape", pattern: /\b(escape|run|away|leave|flee)\b/i },
  { tag: "love", pattern: /\b(love|heart|kiss|romance|baby|girl|boy)\b/i },
  { tag: "regret", pattern: /\b(regret|sorry|gone|lost|miss)\b/i },
  { tag: "travel", pattern: /\b(road|journey|travel|fly|train|drive)\b/i },
  { tag: "city", pattern: /\b(city|street|urban|downtown|lights)\b/i },
  { tag: "hope", pattern: /\b(hope|rise|light|tomorrow|dream)\b/i },
  { tag: "loss", pattern: /\b(loss|gone|death|fade|empty)\b/i },
  { tag: "party", pattern: /\b(party|dance|club|rave|tonight)\b/i },
  { tag: "freedom", pattern: /\b(free|fly|open|wind|road)\b/i },
];

const SCENE_CONCEPT_LEXICON: LexiconEntry[] = [
  { tag: "warehouse-rave", pattern: /\b(warehouse|rave|techno|hard.?techno|industrial)\b/i },
  { tag: "uk-garage", pattern: /\b(uk.?garage|garage|2.?step|grime)\b/i },
  { tag: "road-trip", pattern: /\b(road.?trip|highway|motorway|drive)\b/i },
  { tag: "afterparty", pattern: /\b(afterparty|after.?party|sunrise|5\s?am)\b/i },
  { tag: "late-train-home", pattern: /\b(last.?train|platform|missed|commute|station)\b/i },
  { tag: "post-club", pattern: /\b(after.?club|cigarette|outside|taxi|uber)\b/i },
  { tag: "urban-nostalgia", pattern: /\b(nostalg|city|memory|retro|old.?photos)\b/i },
  { tag: "petrol-station", pattern: /\b(petrol|gas.?station|service.?station|forecourt)\b/i },
];

const GENRE_SCENE_HINTS: Record<string, string[]> = {
  electronic: ["nocturnal", "hypnotic", "urban", "warehouse-rave"],
  ambient: ["reflective", "nocturnal", "fog"],
  techno: ["warehouse-rave", "industrial", "night", "underground"],
  house: ["club", "euphoric", "night"],
  indie: ["reflective", "melancholic", "city"],
  rock: ["driving", "freedom", "road-trip"],
  hip_hop: ["urban", "night", "city"],
  jazz: ["late-night", "reflective", "city", "mystery", "nocturnal"],
  classical: ["reflective", "cinematic", "vintage", "intellectual"],
  soundtrack: ["cinematic", "suspense", "mystery", "epic"],
  folk: ["nostalgic", "reflective", "rural", "adventure"],
  blues: ["reflective", "melancholic", "nocturnal"],
  orchestral: ["epic", "cinematic", "wonder"],
  pop: ["hope", "love", "city"],
  soul: ["reflective", "love", "night"],
  country: ["countryside", "road-trip", "nostalgic"],
  reggae: ["beach", "hope", "sunset"],
};

function matchLexicon(text: string, lexicon: LexiconEntry[]): string[] {
  const found = new Set<string>();
  for (const { tag, pattern } of lexicon) {
    if (pattern.test(text)) found.add(tag);
  }
  return [...found];
}

function uniquePush(base: string[], extra: string[]): string[] {
  return [...new Set([...base, ...extra])];
}

function inferFromAudio(
  energy: number | null | undefined,
  valence: number | null | undefined,
  acousticness: number | null | undefined,
  instrumentalness: number | null | undefined,
  danceability: number | null | undefined,
): Partial<SceneDimensionProfile> & { culturalTags?: string[]; themes?: string[] } {
  const atmospheres: string[] = [];
  const times: string[] = [];
  const activities: string[] = [];
  const culturalTags: string[] = [];
  const themes: string[] = [];
  const e = energy ?? 0.5;
  const v = valence ?? 0.5;
  const a = acousticness ?? 0.3;
  const inst = instrumentalness ?? 0.2;
  const d = danceability ?? 0.5;

  if (e < 0.4 && v < 0.45) atmospheres.push("melancholic", "reflective");
  if (e >= 0.65 && v >= 0.55) atmospheres.push("euphoric");
  if (e >= 0.55 && d >= 0.6) activities.push("dancing");
  if (e >= 0.45 && e <= 0.75 && d >= 0.45) activities.push("driving");
  if (inst >= 0.5 && e < 0.55) atmospheres.push("hypnotic", "nocturnal");
  if (a >= 0.45 && e < 0.5) atmospheres.push("reflective");
  if (e < 0.35) times.push("late-night");
  if (e >= 0.5 && v < 0.5) themes.push("loss");
  if (v >= 0.6) themes.push("hope");
  if (inst >= 0.4) culturalTags.push("cinematic");

  return { atmospheres, times, activities, culturalTags, themes };
}

function inferEra(releaseYear: number | null | undefined): string[] {
  if (!releaseYear || releaseYear < 1960) return [];
  const decade = Math.floor(releaseYear / 10) * 10;
  return [`${decade}s`];
}

function genreMetadataText(genres: unknown): string {
  if (!Array.isArray(genres)) return "";
  return genres.filter((g) => typeof g === "string").join(" ");
}

export function enrichTrackSemanticProfile(track: EnrichmentTrackInput): TrackSemanticProfile {
  const classification = classifyTrack({
    trackName: track.trackName,
    artistName: track.artistName,
    albumName: track.albumName ?? "",
    energy: track.energy ?? null,
    valence: track.valence ?? null,
    spotifyArtistGenres: track.spotifyArtistGenres,
    albumGenres: track.albumGenres,
  });

  const corpus = [
    track.trackName,
    track.artistName,
    track.albumName ?? "",
    genreMetadataText(track.spotifyArtistGenres),
    genreMetadataText(track.albumGenres),
  ].join(" ");

  const culturalTags = matchLexicon(corpus, CULTURAL_LEXICON);
  const scene: SceneDimensionProfile = {
    places: matchLexicon(corpus, PLACE_LEXICON),
    times: matchLexicon(corpus, TIME_LEXICON),
    activities: matchLexicon(corpus, ACTIVITY_LEXICON),
    weather: matchLexicon(corpus, WEATHER_LEXICON),
    atmospheres: matchLexicon(corpus, ATMOSPHERE_LEXICON),
  };
  const themes = matchLexicon(corpus, THEME_LEXICON);
  const sceneConcepts = matchLexicon(corpus, SCENE_CONCEPT_LEXICON);
  const eras = inferEra(track.releaseYear);

  const audioHints = inferFromAudio(
    track.energy,
    track.valence,
    track.acousticness,
    track.instrumentalness,
    track.danceability,
  );
  scene.places = uniquePush(scene.places, audioHints.places ?? []);
  scene.times = uniquePush(scene.times, audioHints.times ?? []);
  scene.activities = uniquePush(scene.activities, audioHints.activities ?? []);
  scene.atmospheres = uniquePush(scene.atmospheres, audioHints.atmospheres ?? []);

  const genreHints = GENRE_SCENE_HINTS[classification.genreFamily] ?? GENRE_SCENE_HINTS[classification.genrePrimary] ?? [];
  for (const hint of genreHints) {
    if (PLACE_LEXICON.some((e) => e.tag === hint) || hint === "city" || hint === "countryside") {
      scene.places.push(hint);
    } else if (TIME_LEXICON.some((e) => e.tag === hint)) {
      scene.times.push(hint);
    } else if (ACTIVITY_LEXICON.some((e) => e.tag === hint)) {
      scene.activities.push(hint);
    } else if (ATMOSPHERE_LEXICON.some((e) => e.tag === hint)) {
      scene.atmospheres.push(hint);
    } else if (SCENE_CONCEPT_LEXICON.some((e) => e.tag === hint)) {
      sceneConcepts.push(hint);
    } else {
      culturalTags.push(hint);
    }
  }

  const title = track.trackName.toLowerCase();
  if (/\bgarage\b/.test(title)) {
    scene.places.push("garage");
    scene.activities.push("repairing");
  }
  if (/\broad\b|\bmotorway\b|\bhighway\b/.test(title)) {
    scene.places.push("motorway");
    scene.activities.push("driving");
    sceneConcepts.push("road-trip");
  }
  if (/\bcity\b|\burban\b/.test(title)) {
    scene.places.push("city");
    culturalTags.push("urban");
  }
  if (/\btrain\b|\bstation\b|\bplatform\b/.test(title)) {
    scene.places.push("train");
    sceneConcepts.push("late-train-home");
    themes.push("travel");
  }
  if (/\bmidnight\b|\bnight\b/.test(title)) {
    scene.times.push("night");
    culturalTags.push("late-night");
    themes.push("night");
  }
  if (/\bwarehouse\b|\brave\b|\bclub\b/.test(title)) {
    scene.places.push("warehouse");
    sceneConcepts.push("warehouse-rave");
    culturalTags.push("underground");
  }
  if (/\brain\b|\bstorm\b/.test(title)) {
    scene.weather.push("rain");
  }

  const allTags = uniquePush(
    uniquePush(culturalTags, audioHints.culturalTags ?? []),
    [...scene.places, ...scene.times, ...scene.atmospheres, ...themes, ...sceneConcepts],
  );

  const baseSemantic = {
    culturalTags: uniquePush(culturalTags, audioHints.culturalTags ?? []),
    scene: {
      places: [...new Set(scene.places)],
      times: [...new Set(scene.times)],
      activities: [...new Set(scene.activities)],
      weather: [...new Set(scene.weather)],
      atmospheres: [...new Set(scene.atmospheres)],
    },
    themes: uniquePush(themes, audioHints.themes ?? []),
    sceneConcepts: [...new Set(sceneConcepts)],
  };

  const musicSemantic = buildMusicSemanticProfile(track, baseSemantic);

  return {
    version: SEMANTIC_ENRICHMENT_VERSION,
    ...baseSemantic,
    eras: [...new Set(eras)],
    musicSemantic,
    retrievalSignature: signatureFromTags([
      ...allTags,
      ...musicSemantic.narrativeTags.slice(0, 3),
      ...musicSemantic.cinematicTags.slice(0, 2),
    ]),
    enrichedAt: new Date().toISOString(),
  };
}

export function parseTrackSemanticProfile(raw: unknown): TrackSemanticProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const scene = o["scene"];
  if (!scene || typeof scene !== "object") return null;
  const s = scene as Record<string, unknown>;
  const asStrings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

  const culturalTags = asStrings(o["culturalTags"]);
  const parsedScene = {
    places: asStrings(s["places"]),
    times: asStrings(s["times"]),
    activities: asStrings(s["activities"]),
    weather: asStrings(s["weather"]),
    atmospheres: asStrings(s["atmospheres"]),
  };
  const themes = asStrings(o["themes"]);
  const sceneConcepts = asStrings(o["sceneConcepts"]);

  let musicSemantic = emptyMusicSemanticProfile();
  if (o["musicSemantic"]) {
    musicSemantic = parseMusicSemanticProfile(o["musicSemantic"]);
  }

  const version =
    typeof o["version"] === "string" ? o["version"] : SEMANTIC_ENRICHMENT_VERSION;

  const profile: TrackSemanticProfile = {
    version: version as typeof SEMANTIC_ENRICHMENT_VERSION,
    culturalTags,
    scene: parsedScene,
    themes,
    sceneConcepts,
    eras: asStrings(o["eras"]),
    musicSemantic,
    retrievalSignature: typeof o["retrievalSignature"] === "string" ? o["retrievalSignature"] : "",
    enrichedAt: typeof o["enrichedAt"] === "string" ? o["enrichedAt"] : "",
  };

  if (!profile.musicSemantic.deepSignature || profile.version !== SEMANTIC_ENRICHMENT_VERSION) {
    profile.musicSemantic = buildMusicSemanticProfile(
      { trackId: "backfill", trackName: "", artistName: "", albumName: "" },
      profile,
    );
  }

  return profile;
}
