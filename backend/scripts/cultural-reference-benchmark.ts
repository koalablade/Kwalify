/**
 * Cultural reference benchmark — expansion, scene profile, and retrieval coherence.
 *
 * Usage: npm run benchmark:cultural-references
 */

import { buildDominantIntentContract } from "../core/dominant-intent-contract";
import { decomposeIntent } from "../core/intent-decomposer";
import { expandCulturalReferences } from "../lib/cultural-reference-expansion";
import { buildIntentPipelineContext } from "../lib/intent-pipeline-orchestrator";
import { enrichTrackSemanticProfile } from "../lib/track-semantic-enrichment";
import {
  buildPromptSceneProfile,
  scoreSemanticSceneMatch,
} from "../lib/scene-semantic-retrieval";

type Expectation = {
  prompt: string;
  minCulturalTags: string[];
  minAtmospheres: string[];
  expectSceneId: string;
  expectAliases: string[];
  notOnlyActivity?: string;
};

const FIXTURES: Expectation[] = [
  {
    prompt: "reading agatha christie books",
    minCulturalTags: ["mystery", "detective", "british"],
    minAtmospheres: ["mystery", "suspense"],
    expectSceneId: "cozy-mystery",
    expectAliases: ["jazz", "classical"],
    notOnlyActivity: "reading",
  },
  {
    prompt: "Reading Sherlock Holmes on a foggy night",
    minCulturalTags: ["victorian", "detective", "london"],
    minAtmospheres: ["mystery", "nocturnal"],
    expectSceneId: "victorian-detective",
    expectAliases: ["classical", "jazz"],
  },
  {
    prompt: "Reading Stephen King before bed",
    minCulturalTags: ["horror", "suspense"],
    minAtmospheres: ["suspense", "foreboding"],
    expectSceneId: "horror-suspense",
    expectAliases: ["ambient", "soundtrack"],
  },
  {
    prompt: "Reading Tolkien by the fire",
    minCulturalTags: ["fantasy", "mythic"],
    minAtmospheres: ["epic", "wonder"],
    expectSceneId: "epic-fantasy",
    expectAliases: ["folk", "classical"],
  },
  {
    prompt: "Reading Dune late at night",
    minCulturalTags: ["sci-fi", "desert", "epic"],
    minAtmospheres: ["epic", "futuristic"],
    expectSceneId: "desert-epic",
    expectAliases: ["orchestral", "ambient"],
  },
  {
    prompt: "Victorian detective story atmosphere",
    minCulturalTags: ["victorian", "detective", "mystery"],
    minAtmospheres: ["mystery", "vintage"],
    expectSceneId: "victorian-detective",
    expectAliases: ["classical", "jazz"],
  },
  {
    prompt: "Solving a murder mystery in the library",
    minCulturalTags: ["detective", "mystery"],
    minAtmospheres: ["mystery", "suspense"],
    expectSceneId: "cozy-mystery",
    expectAliases: ["jazz", "classical"],
  },
  {
    prompt: "Neo-noir city at night",
    minCulturalTags: ["noir", "urban", "neon"],
    minAtmospheres: ["nocturnal", "mystery"],
    expectSceneId: "neo-noir",
    expectAliases: ["jazz", "electronic"],
  },
  {
    prompt: "Tokyo after midnight in the rain",
    minCulturalTags: ["tokyo", "urban", "late-night"],
    minAtmospheres: ["nocturnal", "urban"],
    expectSceneId: "tokyo-night",
    expectAliases: ["electronic", "ambient"],
  },
  {
    prompt: "Parisian café in the rain",
    minCulturalTags: ["paris", "romantic"],
    minAtmospheres: ["romantic", "melancholy"],
    expectSceneId: "paris-cafe",
    expectAliases: ["jazz", "classical"],
  },
];

const LITERARY_TRACKS = [
  { trackId: "m1", trackName: "Mystery Train", artistName: "Junior Parker", albumName: "Blues", energy: 0.42, valence: 0.38, tempo: 92, danceability: 0.48, acousticness: 0.55, instrumentalness: 0.02, releaseYear: 1953 },
  { trackId: "m2", trackName: "Take Five", artistName: "Dave Brubeck", albumName: "Time Out", energy: 0.35, valence: 0.52, tempo: 176, danceability: 0.44, acousticness: 0.72, instrumentalness: 0.88, releaseYear: 1959 },
  { trackId: "m3", trackName: "Clair de Lune", artistName: "Claude Debussy", albumName: "Suite Bergamasque", energy: 0.12, valence: 0.35, tempo: 68, danceability: 0.18, acousticness: 0.98, instrumentalness: 0.95, releaseYear: 1905 },
  { trackId: "m4", trackName: "The Murder", artistName: "Bernard Herrmann", albumName: "Psycho", energy: 0.55, valence: 0.22, tempo: 110, danceability: 0.22, acousticness: 0.45, instrumentalness: 0.92, releaseYear: 1960 },
  { trackId: "m5", trackName: "Concerning Hobbits", artistName: "Howard Shore", albumName: "The Lord of the Rings", energy: 0.28, valence: 0.62, tempo: 88, danceability: 0.25, acousticness: 0.68, instrumentalness: 0.91, releaseYear: 2001 },
  { trackId: "m8", trackName: "Mystery of Love", artistName: "Sufjan Stevens", albumName: "Call Me By Your Name", energy: 0.24, valence: 0.41, tempo: 76, danceability: 0.32, acousticness: 0.82, instrumentalness: 0.05, releaseYear: 2017 },
  { trackId: "m6", trackName: "Blade Runner Blues", artistName: "Vangelis", albumName: "Blade Runner", energy: 0.31, valence: 0.28, tempo: 72, danceability: 0.35, acousticness: 0.42, instrumentalness: 0.78, releaseYear: 1982 },
  { trackId: "m7", trackName: "Focus Playlist Noise", artistName: "Lo-Fi Study", albumName: "Study", energy: 0.22, valence: 0.55, tempo: 80, danceability: 0.5, acousticness: 0.6, instrumentalness: 0.85, releaseYear: 2020 },
];

function tagHits(tags: string[], required: string[]): string[] {
  const lower = tags.map((t) => t.toLowerCase());
  return required.filter((req) => lower.some((tag) => tag.includes(req) || req.includes(tag)));
}

function main(): void {
  const profiles = LITERARY_TRACKS.map((track) => ({
    track,
    profile: enrichTrackSemanticProfile(track),
  }));

  let failed = 0;
  for (const fixture of FIXTURES) {
    const expansion = expandCulturalReferences(fixture.prompt);
    const sceneProfile = buildPromptSceneProfile(fixture.prompt);
    const pipeline = buildIntentPipelineContext(fixture.prompt, "balanced");
    const contract = buildDominantIntentContract({
      prompt: fixture.prompt,
      intentContract: {
        primarySubgenre: null,
        genreFamilies: [],
        activity: pipeline.decomposedIntent.inferredActivity,
        places: [],
        eraRange: null,
        explicitDimensions: [],
      },
    });
    const decomposed = decomposeIntent(fixture.prompt);

    const culturalHits = tagHits(sceneProfile.culturalTags, fixture.minCulturalTags);
    const atmosphereHits = tagHits(sceneProfile.atmospheres, fixture.minAtmospheres);
    const aliasHits = fixture.expectAliases.filter((alias) => pipeline.sceneAliases.includes(alias));
    const ranked = profiles
      .map(({ track, profile }) => ({
        track,
        boost: scoreSemanticSceneMatch(sceneProfile, profile, {
          artistName: track.artistName,
          trackName: track.trackName,
        }).boost,
      }))
      .sort((a, b) => b.boost - a.boost);
    const topTrack = ranked[0]?.track.trackName ?? "";
    const topBoost = ranked[0]?.boost ?? 0;
    const sceneOk = expansion.sceneId === fixture.expectSceneId;
    const culturalOk = culturalHits.length >= Math.min(2, fixture.minCulturalTags.length);
    const atmosphereOk = atmosphereHits.length >= Math.min(1, fixture.minAtmospheres.length);
    const aliasOk = aliasHits.length >= Math.min(1, fixture.expectAliases.length);
    const refsOk = decomposed.scene === fixture.expectSceneId
      || decomposed.culturalRefs.some((ref) =>
        ref === fixture.expectSceneId || ref.includes(fixture.expectSceneId),
      );
    const notCollapsed = !fixture.notOnlyActivity
      || sceneProfile.culturalTags.length >= 3
      || expansion.atmosphereOverActivity;
    const genreOk = contract.genreFamilies.length === 0
      || contract.genreFamilies.some((g) => fixture.expectAliases.includes(g));
    const retrievalOk = topBoost >= 0.01;
    const ok = sceneOk && culturalOk && atmosphereOk && aliasOk && refsOk && notCollapsed && genreOk && retrievalOk;

    if (!ok) failed += 1;
    console.log(JSON.stringify({
      prompt: fixture.prompt,
      sceneId: expansion.sceneId,
      culturalTags: sceneProfile.culturalTags,
      atmospheres: sceneProfile.atmospheres,
      culturalHits,
      atmosphereHits,
      aliases: pipeline.sceneAliases.slice(0, 6),
      genreFamilies: contract.genreFamilies,
      topTrack,
      ok,
    }));
  }

  const genericReading = buildPromptSceneProfile("reading a book quietly");
  const agatha = buildPromptSceneProfile("reading agatha christie books");
  const uniquenessOk = genericReading.retrievalSignature !== agatha.retrievalSignature;
  if (!uniquenessOk) {
    failed += 1;
    console.log(JSON.stringify({ check: "prompt-uniqueness", ok: false }));
  }

  if (failed > 0) {
    console.error(`cultural reference benchmark failed: ${failed} checks`);
    process.exit(1);
  }
  console.log(`cultural reference benchmark passed (${FIXTURES.length} prompts + uniqueness)`);
}

main();
