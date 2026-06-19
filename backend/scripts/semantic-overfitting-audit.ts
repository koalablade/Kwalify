/**
 * Semantic overfitting audit — retrieval signatures, prompt collapse, taste preservation.
 *
 * Usage: npm run audit:semantic-overfitting
 */

import { buildDominantIntentContract } from "../core/dominant-intent-contract";
import { decomposeIntent } from "../core/intent-decomposer";
import { expandCulturalReferences, listCulturalReferenceEntries } from "../lib/cultural-reference-expansion";
import {
  buildIntentPipelineContext,
  mergeSceneAliasesIntoGenres,
} from "../lib/intent-pipeline-orchestrator";
import { buildPromptSceneProfile } from "../lib/scene-semantic-retrieval";
import { enrichTrackSemanticProfile } from "../lib/track-semantic-enrichment";
import { scoreSemanticSceneMatch } from "../lib/scene-semantic-retrieval";
import { computeSceneAliasRetrievalBoost } from "../lib/scene-alias-retrieval-boost";
import { SCENE_KNOWLEDGE_ENTRIES } from "../lib/scene-knowledge";

const SIGNATURE_PROMPTS = [
  "Reading Agatha Christie",
  "Reading Sherlock Holmes",
  "Reading Stephen King",
  "Reading Tolkien",
  "Reading Dune",
  "Reading Orwell",
  "Reading Lovecraft",
  "Victorian detective story",
  "Small-town horror novel",
  "Cyberpunk dystopia",
  "Tokyo at 3am",
  "Paris café in the rain",
  "Driving through rural France",
  "Working on a Volvo in a garage",
  "Last train home",
  "Reading a textbook",
  "Reading quietly",
  "Studying for an exam",
];

const UK_GARAGE_LIBRARY = [
  { trackId: "u1", trackName: "Archangel", artistName: "Burial", albumName: "Untrue", energy: 0.41, valence: 0.22, tempo: 134, danceability: 0.62, acousticness: 0.08, instrumentalness: 0.71, releaseYear: 2007, spotifyArtistGenres: ["uk garage", "electronic"] },
  { trackId: "u2", trackName: "Girl", artistName: "Jamie xx", albumName: "In Colour", energy: 0.55, valence: 0.35, tempo: 122, danceability: 0.68, acousticness: 0.05, instrumentalness: 0.42, releaseYear: 2015, spotifyArtistGenres: ["electronic", "indie"] },
  { trackId: "u3", trackName: "Kiara", artistName: "Bonobo", albumName: "Black Sands", energy: 0.48, valence: 0.42, tempo: 98, danceability: 0.55, acousticness: 0.12, instrumentalness: 0.65, releaseYear: 2010, spotifyArtistGenres: ["downtempo", "electronic"] },
  { trackId: "u4", trackName: "Vessel", artistName: "Four Tet", albumName: "Pink", energy: 0.52, valence: 0.38, tempo: 128, danceability: 0.71, acousticness: 0.03, instrumentalness: 0.88, releaseYear: 2012, spotifyArtistGenres: ["electronic", "idm"] },
  { trackId: "u5", trackName: "21 Seconds", artistName: "So Solid Crew", albumName: "They Don't Know", energy: 0.72, valence: 0.55, tempo: 140, danceability: 0.78, acousticness: 0.02, instrumentalness: 0.01, releaseYear: 2001, spotifyArtistGenres: ["uk garage", "grime"] },
];

const CLASSICAL_LIBRARY = [
  { trackId: "c1", trackName: "Clair de Lune", artistName: "Debussy", albumName: "Suite", energy: 0.12, valence: 0.35, tempo: 68, danceability: 0.18, acousticness: 0.98, instrumentalness: 0.95, releaseYear: 1905, spotifyArtistGenres: ["classical"] },
  { trackId: "c2", trackName: "The Murder", artistName: "Bernard Herrmann", albumName: "Psycho", energy: 0.55, valence: 0.22, tempo: 110, danceability: 0.22, acousticness: 0.45, instrumentalness: 0.92, releaseYear: 1960, spotifyArtistGenres: ["soundtrack", "classical"] },
];

function analyzePrompt(prompt: string, libraryFamilies: string[] = []) {
  const expansion = expandCulturalReferences(prompt);
  const sceneProfile = buildPromptSceneProfile(prompt);
  const pipeline = buildIntentPipelineContext(prompt, "balanced");
  const decomposed = decomposeIntent(prompt);
  const contract = buildDominantIntentContract({
    prompt,
    intentContract: {
      primarySubgenre: null,
      genreFamilies: [],
      activity: decomposed.inferredActivity,
      places: [],
      eraRange: null,
      explicitDimensions: [],
    },
  });
  const mergedGenresEmptyBase = mergeSceneAliasesIntoGenres([], pipeline.sceneAliases);
  const mergedGenresWithLibrary = mergeSceneAliasesIntoGenres(
    libraryFamilies.slice(0, 1),
    pipeline.sceneAliases,
    { libraryGenreFamilies: libraryFamilies },
  );

  return {
    prompt,
    sceneId: expansion.sceneId,
    atmospheres: [...new Set([...sceneProfile.atmospheres, ...expansion.atmospheres])].sort(),
    culturalTags: sceneProfile.culturalTags.slice(0, 10),
    themes: sceneProfile.themes,
    sceneConcepts: sceneProfile.sceneConcepts.slice(0, 6),
    expansionGenreHints: expansion.genreFamilies,
    contractGenreFamilies: contract.genreFamilies,
    contractEraRange: contract.eraRange,
    contractDominantEmotion: contract.dominantEmotion,
    contractActivity: contract.activity,
    maxTastePullWeight: contract.maxTastePullWeight,
    sceneAliases: pipeline.sceneAliases.slice(0, 8),
    retrievalSignature: sceneProfile.retrievalSignature.slice(0, 160),
    intentSignature: contract.intentSignature,
    atmosphereSignature: expansion.atmosphereSignature,
    culturalDominance: expansion.culturalDominance,
    atmosphereOverActivity: expansion.atmosphereOverActivity,
    mergedGenresEmptyBase,
    mergedGenresWithLibrary,
  };
}

function jaccard(a: string, b: string): number {
  const setA = new Set(a.split("|"));
  const setB = new Set(b.split("|"));
  const inter = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : inter / union;
}

function main(): void {
  console.log("=== KB INVENTORY ===");
  const byCategory = new Map<string, string[]>();
  for (const entry of SCENE_KNOWLEDGE_ENTRIES) {
    const list = byCategory.get(entry.category) ?? [];
    list.push(entry.id);
    byCategory.set(entry.category, list);
  }
  console.log(JSON.stringify({
    totalEntries: listCulturalReferenceEntries().length,
    categories: Object.fromEntries([...byCategory.entries()].map(([k, v]) => [k, v.length])),
    sampleIds: [...byCategory.entries()].map(([k, v]) => ({ category: k, ids: v.slice(0, 8) })),
  }, null, 2));

  console.log("\n=== RETRIEVAL SIGNATURES ===");
  const analyses = SIGNATURE_PROMPTS.map((p) => analyzePrompt(p));
  for (const row of analyses) {
    console.log(JSON.stringify(row, null, 2));
  }

  console.log("\n=== PROMPT COLLAPSE CHECK (10 literary/cultural) ===");
  const literary = analyses.filter((a) =>
    /Reading|Victorian|Small-town|Cyberpunk|Sherlock/i.test(a.prompt),
  ).slice(0, 10);
  const sigs = literary.map((a) => a.atmosphereSignature || a.sceneId || a.prompt);
  let maxOverlap = 0;
  let collapsePair = "";
  for (let i = 0; i < sigs.length; i++) {
    for (let j = i + 1; j < sigs.length; j++) {
      if (sigs[i] === sigs[j]) continue;
      const overlap = jaccard(sigs[i]!, sigs[j]!);
      if (overlap > maxOverlap) {
        maxOverlap = overlap;
        collapsePair = `${literary[i]!.prompt} <> ${literary[j]!.prompt}`;
      }
    }
  }
  const distinctSceneIds = new Set(literary.map((a) => a.sceneId).filter(Boolean)).size;
  console.log(JSON.stringify({
    distinctSceneIds,
    maxAtmosphereSignatureOverlap: Math.round(maxOverlap * 1000) / 1000,
    worstPair: collapsePair,
    pass: distinctSceneIds >= 8 && maxOverlap < 0.72,
  }, null, 2));

  console.log("\n=== TASTE PRESERVATION: UK GARAGE LIBRARY + AGATHA CHRISTIE ===");
  const libraryFamilies = ["electronic", "hip_hop"];
  const agatha = analyzePrompt("Reading Agatha Christie", libraryFamilies);
  const profiles = UK_GARAGE_LIBRARY.map((t) => ({
    track: t,
    profile: enrichTrackSemanticProfile(t),
  }));
  const sceneProfile = buildPromptSceneProfile("Reading Agatha Christie");
  const ranked = profiles.map(({ track, profile }) => ({
    track: track.trackName,
    artist: track.artistName,
    semanticBoost: scoreSemanticSceneMatch(sceneProfile, profile, {
      artistName: track.artistName,
      trackName: track.trackName,
      maxBoost: 0.28,
    }).boost,
    aliasBoost: computeSceneAliasRetrievalBoost(
      { genreFamily: "electronic", genres: track.spotifyArtistGenres as string[] },
      agatha.sceneAliases,
      {},
    ),
  })).sort((a, b) => (b.semanticBoost + b.aliasBoost) - (a.semanticBoost + a.aliasBoost));

  const classicalRanked = CLASSICAL_LIBRARY.map((t) => ({
    track: t.trackName,
    aliasBoost: computeSceneAliasRetrievalBoost(
      { genreFamily: "classical", genres: ["classical"] },
      agatha.sceneAliases,
      {},
    ),
  }));

  console.log(JSON.stringify({
    contractGenreFamilies: agatha.contractGenreFamilies,
    expansionGenreHints: agatha.expansionGenreHints,
    mergedGenresEmptyBase: agatha.mergedGenresEmptyBase,
    mergedGenresWithLibrary: agatha.mergedGenresWithLibrary,
    maxTastePullWeight: agatha.maxTastePullWeight,
    topLibraryTracks: ranked.slice(0, 5),
    classicalAliasBoost: classicalRanked,
    tastePreserved: agatha.contractGenreFamilies.length === 0
      && agatha.mergedGenresEmptyBase.length === 0
      && ranked[0]!.semanticBoost > 0,
  }, null, 2));

  console.log("\n=== OVERFITTING VERDICT ===");
  const failures: string[] = [];
  if (agatha.contractGenreFamilies.some((g) => ["jazz", "classical", "soundtrack"].includes(g))) {
    failures.push("contract still injects cultural genre families");
  }
  if (agatha.contractEraRange) {
    failures.push("contract injects cultural era range");
  }
  if (agatha.mergedGenresEmptyBase.length > 0) {
    failures.push("empty genre base still receives cultural scene aliases");
  }
  if (distinctSceneIds < 8) {
    failures.push("literary prompts collapse to too few scene ids");
  }
  if (maxOverlap >= 0.72) {
    failures.push("atmosphere signature overlap too high");
  }
  if (!ranked[0] || ranked[0].semanticBoost <= 0) {
    failures.push("UK garage library gets no semantic boost for Agatha Christie");
  }

  const verdict = failures.length === 0 ? "MERGE" : "FIX_REQUIRED";
  console.log(JSON.stringify({ verdict, failures, recommendation: verdict === "MERGE" ? "Safe to merge — cultural enrichment without genre domination" : failures }, null, 2));

  if (verdict !== "MERGE") process.exit(1);
}

main();
