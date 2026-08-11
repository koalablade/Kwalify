/**
 * Diagnostic: trace retrieval funnel for 4 test prompts with ~9000 track mock library.
 * Usage: npx tsx backend/scripts/v15-retrieval-funnel-diagnostic.ts
 */
import { analyzeVibe } from "../lib/emotion";
import { buildLockedIntent } from "../core/v3/intent";
import { resolveCommittedWorld, getCulturalProfile } from "../core/committed-world";
import { retrieveScoringCandidates } from "../lib/candidate-retrieval-pipeline";
import { orchestratePlaylistRetrieval } from "../lib/playlist-retrieval-orchestrator";
import { retrieveWithRecovery, runLayeredWorldRetrieval } from "../core/editorial/layered-world-retrieval";
import { assessWorldCoverage } from "../core/editorial/world-coverage";
import { trackFailsActivityHardGate, resolveActivityProfile } from "../lib/activity-profiles";
import { artistForbiddenInWorld } from "../core/editorial/artist-identity-map";
import { committedWorldArtistForbidden } from "../core/committed-world";

const PROMPTS = [
  "dad rock BBQ with beers",
  "empty motorway at midnight rain on the windscreen",
  "disco rooftop party 1978",
  "heavy gym workout aggressive",
];

const ANCHOR_ARTISTS: Record<string, string[]> = {
  dad_rock: ["Queen", "Tom Petty", "AC/DC", "Eagles", "Fleetwood Mac", "Led Zeppelin", "Guns N' Roses"],
  motorway: ["M83", "Chromatics", "Depeche Mode", "New Order", "The Cure", "Pet Shop Boys"],
  disco: ["Donna Summer", "Chic", "Bee Gees", "Michael Jackson", "Earth Wind & Fire"],
  gym: ["Metallica", "AC/DC", "Slayer", "Guns N' Roses", "Rage Against the Machine", "Linkin Park"],
  filler: ["Bon Iver", "Phoebe Bridgers", "Clairo", "Arctic Monkeys", "Taylor Swift", "Drake", "The Weeknd"],
  generic: ["Unknown Artist A", "Random Band B", "Indie Person C"],
};

function buildMockLibrary(size = 9000) {
  const allAnchors = [
    ...ANCHOR_ARTISTS.dad_rock,
    ...ANCHOR_ARTISTS.motorway,
    ...ANCHOR_ARTISTS.disco,
    ...ANCHOR_ARTISTS.gym,
  ];
  const filler = [...ANCHOR_ARTISTS.filler, ...ANCHOR_ARTISTS.generic];
  const classMap = new Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>();

  const tracks = Array.from({ length: size }, (_, i) => {
    const anchorPick = i < 120 ? allAnchors[i % allAnchors.length]! : filler[i % filler.length]!;
    const isAnchor = allAnchors.includes(anchorPick);
    const family = isAnchor
      ? anchorPick === "Donna Summer" || anchorPick === "Chic"
        ? "soul"
        : anchorPick === "M83" || anchorPick === "Chromatics"
          ? "electronic"
          : "rock"
      : ["pop", "indie", "hip_hop", "electronic"][i % 4]!;
    const trackId = `track-${i}`;
    classMap.set(trackId, {
      genrePrimary: family,
      genreFamily: family,
      primarySubgenre: family,
      secondarySubgenre: null,
      subGenres: [family],
    });
    const energy = isAnchor
      ? anchorPick === "M83" || anchorPick === "Chromatics"
        ? 0.55
        : anchorPick === "Donna Summer" || anchorPick === "Chic"
          ? 0.72
          : 0.82
      : 0.45 + (i % 10) * 0.04;
    return {
      trackId,
      trackName: `Song ${i}`,
      artistName: anchorPick,
      albumName: "Album",
      energy,
      valence: 0.5,
      danceability: energy * 0.85,
      tempo: 90 + (i % 40),
      popularity: 30 + (i % 50),
      releaseYear: 1975 + (i % 45),
    };
  });

  return { tracks, classMap };
}

function countPrefilterStages(
  prompt: string,
  tracks: ReturnType<typeof buildMockLibrary>["tracks"],
  classMap: ReturnType<typeof buildMockLibrary>["classMap"],
) {
  const lockedIntent = buildLockedIntent(prompt);
  const committed = resolveCommittedWorld({ prompt, lockedIntent });
  const worldIds = committed?.worldIds ?? [];
  let afterBasic = 0;
  let afterWorldForbidden = 0;
  let afterActivityHard = 0;
  const activityProfile = resolveActivityProfile(prompt, lockedIntent);

  for (const track of tracks) {
    afterBasic += 1;
    if (
      committed?.hardLock &&
      (artistForbiddenInWorld(track.artistName, worldIds) ||
        committedWorldArtistForbidden(committed, track.artistName, track.trackName))
    ) {
      continue;
    }
    afterWorldForbidden += 1;
    const classification = classMap.get(track.trackId) ?? null;
    if (
      activityProfile &&
      trackFailsActivityHardGate(track, classification, activityProfile, prompt)
    ) {
      continue;
    }
    afterActivityHard += 1;
  }

  return {
    committedWorld: committed?.id ?? null,
    hardLock: committed?.hardLock ?? false,
    activityProfile: activityProfile?.id ?? null,
    totalLibrary: tracks.length,
    afterBasic,
    afterWorldForbidden,
    afterActivityHard,
  };
}

function runPrompt(prompt: string, tracks: ReturnType<typeof buildMockLibrary>["tracks"], classMap: ReturnType<typeof buildMockLibrary>["classMap"]) {
  const emotionProfile = analyzeVibe(prompt);
  const lockedIntent = buildLockedIntent(prompt);
  const committed = resolveCommittedWorld({ prompt, lockedIntent });
  const culturalProfile = committed ? getCulturalProfile(committed.id) : null;

  const prefilter = countPrefilterStages(prompt, tracks, classMap);

  let layeredPrimary = 0;
  let layeredRecovery = 0;
  if (committed && culturalProfile) {
    const eligible = tracks.filter((t) => {
      if (
        committed.hardLock &&
        (artistForbiddenInWorld(t.artistName, committed.worldIds) ||
          committedWorldArtistForbidden(committed, t.artistName, t.trackName))
      ) {
        return false;
      }
      return true;
    });
    const primary = runLayeredWorldRetrieval({
      prompt,
      userLibrary: eligible,
      culturalProfile,
      committedWorld: committed,
    });
  layeredPrimary = primary.tracks.length;
    const recovery = retrieveWithRecovery({
      prompt,
      userLibrary: tracks,
      culturalProfile,
      committedWorld: committed,
    });
    layeredRecovery = recovery.tracks.length;
  }

  const retrieval = retrieveScoringCandidates({
    tracks,
    vibe: prompt,
    intent: lockedIntent,
    emotionProfile,
    classMap,
    requestedLength: 25,
    sceneActive: true,
    traceRetrievalFunnel: true,
    debugRetrieval: true,
  });

  const orchestration = orchestratePlaylistRetrieval({
    tracks,
    vibe: prompt,
    intent: lockedIntent,
    emotionProfile,
    classMap,
    requestedLength: 25,
    sceneActive: true,
    debugRetrieval: true,
  });

  const coverage =
    committed && culturalProfile
      ? assessWorldCoverage(committed, tracks, culturalProfile)
      : null;

  const funnel = (retrieval.diagnostics as { retrievalFunnel?: { stages: Record<string, number> } }).retrievalFunnel;

  return {
    prompt,
    prefilter,
    layeredPrimary,
    layeredRecovery,
    coverage: coverage
      ? { score: coverage.score, anchorHits: coverage.anchorHits, level: coverage.score }
      : null,
    retrieval: {
      input: (retrieval.diagnostics as { inputCount?: number }).inputCount ?? tracks.length,
      output: retrieval.tracks.length,
      funnel: funnel?.stages ?? null,
      fallback: (retrieval.diagnostics as { fallback?: string }).fallback ?? null,
    },
    orchestration: {
      output: orchestration.tracks.length,
      failure: orchestration.failure?.code ?? null,
      combinedConfidence: orchestration.diagnostics.combinedConfidence,
      strictValid: orchestration.diagnostics.validCandidateSupply.strictValidCount,
      relaxedValid: orchestration.diagnostics.validCandidateSupply.relaxedValidCount,
    },
  };
}

const { tracks, classMap } = buildMockLibrary(9000);

type Scenario = { name: string; tracks: typeof tracks; classMap: typeof classMap };
const scenarios: Scenario[] = [
  { name: "mixed_with_anchors", tracks, classMap },
];

function buildNoAnchorLibrary(size = 9000) {
  const classMap = new Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>();
  const artists = ["Taylor Swift", "Drake", "The Weeknd", "Ed Sheeran", "Ariana Grande", "Post Malone", "Billie Eilish", "Kendrick Lamar"];
  const tracks = Array.from({ length: size }, (_, i) => {
    const trackId = `na-${i}`;
    classMap.set(trackId, {
      genrePrimary: "unknown",
      genreFamily: "unknown",
      primarySubgenre: "unknown",
      secondarySubgenre: null,
      subGenres: [],
    });
    return {
      trackId,
      trackName: `Song ${i}`,
      artistName: artists[i % artists.length]!,
      albumName: "Album",
      energy: 0.55 + (i % 8) * 0.04,
      valence: 0.5,
      danceability: 0.6,
      tempo: 110,
      popularity: 50,
      releaseYear: 2015 + (i % 8),
    };
  });
  return { tracks, classMap };
}

function buildSparseAnchorUnknownGenre(size = 9000) {
  const classMap = new Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>();
  const anchors = ["Queen", "Metallica", "Donna Summer", "M83"];
  const filler = ["Taylor Swift", "Drake", "Bon Iver", "Phoebe Bridgers"];
  const tracks = Array.from({ length: size }, (_, i) => {
    const artist = i < 8 ? anchors[i % anchors.length]! : filler[i % filler.length]!;
    const trackId = `sp-${i}`;
    classMap.set(trackId, {
      genrePrimary: "unknown",
      genreFamily: "unknown",
      primarySubgenre: "unknown",
      secondarySubgenre: null,
      subGenres: [],
    });
    return {
      trackId,
      trackName: `Song ${i}`,
      artistName: artist,
      albumName: "Album",
      energy: artist === "Metallica" ? 0.9 : artist === "M83" ? 0.55 : 0.65,
      valence: 0.5,
      danceability: 0.6,
      tempo: 120,
      popularity: 50,
      releaseYear: 1985,
    };
  });
  return { tracks, classMap };
}

scenarios.push({ name: "no_anchors_unknown_genre", ...buildNoAnchorLibrary(9000) });
scenarios.push({ name: "sparse_anchors_unknown_genre", ...buildSparseAnchorUnknownGenre(9000) });

for (const scenario of scenarios) {
  console.log(`\n=== SCENARIO: ${scenario.name} ===`);
  console.log(JSON.stringify(PROMPTS.map((p) => runPrompt(p, scenario.tracks, scenario.classMap)), null, 2));
}
