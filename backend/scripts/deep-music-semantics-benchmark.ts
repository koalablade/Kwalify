/**
 * Deep music semantics benchmark — UK garage vs ambient, cinematic vs club, nocturnal vs energetic.
 *
 * Usage: npm run benchmark:deep-music-semantics
 */

import { enrichTrackSemanticProfile } from "../lib/track-semantic-enrichment";
import { buildUserTasteManifold } from "../lib/user-taste-manifold";
import { scoreMusicSemanticCompatibility } from "../lib/music-semantic-retrieval";
import { buildMusicSemanticConstraintsFromPrompt } from "../lib/scene-music-alignment";

const UK_GARAGE = [
  { trackId: "u1", trackName: "Archangel", artistName: "Burial", energy: 0.41, valence: 0.22, tempo: 134, danceability: 0.62, acousticness: 0.08, instrumentalness: 0.71, spotifyArtistGenres: ["uk garage"] },
  { trackId: "u2", trackName: "Girl", artistName: "Jamie xx", energy: 0.55, valence: 0.35, tempo: 122, danceability: 0.68, acousticness: 0.05, instrumentalness: 0.42, spotifyArtistGenres: ["electronic"] },
  { trackId: "u3", trackName: "Vessel", artistName: "Four Tet", energy: 0.52, valence: 0.38, tempo: 128, danceability: 0.71, acousticness: 0.03, instrumentalness: 0.88, spotifyArtistGenres: ["electronic"] },
];

const AMBIENT = [
  { trackId: "a1", trackName: "An Ending", artistName: "Brian Eno", energy: 0.18, valence: 0.42, tempo: 72, danceability: 0.22, acousticness: 0.35, instrumentalness: 0.88, spotifyArtistGenres: ["ambient"] },
  { trackId: "a2", trackName: "Avril 14th", artistName: "Aphex Twin", energy: 0.22, valence: 0.48, tempo: 80, danceability: 0.28, acousticness: 0.55, instrumentalness: 0.92, spotifyArtistGenres: ["ambient"] },
  { trackId: "a3", trackName: "We Float", artistName: "Goldfrapp", energy: 0.35, valence: 0.45, tempo: 98, danceability: 0.42, acousticness: 0.28, instrumentalness: 0.55, spotifyArtistGenres: ["downtempo"] },
];

const CINEMATIC = [
  { trackId: "c1", trackName: "Time", artistName: "Hans Zimmer", energy: 0.48, valence: 0.52, tempo: 88, danceability: 0.28, acousticness: 0.42, instrumentalness: 0.91, spotifyArtistGenres: ["soundtrack"] },
  { trackId: "c2", trackName: "Cornfield Chase", artistName: "Hans Zimmer", energy: 0.55, valence: 0.48, tempo: 96, danceability: 0.32, acousticness: 0.38, instrumentalness: 0.89, spotifyArtistGenres: ["soundtrack"] },
];

const CLUB = [
  { trackId: "cl1", trackName: "One More Time", artistName: "Daft Punk", energy: 0.78, valence: 0.72, tempo: 123, danceability: 0.82, acousticness: 0.02, instrumentalness: 0.05, spotifyArtistGenres: ["house"] },
  { trackId: "cl2", trackName: "Insomnia", artistName: "Faithless", energy: 0.74, valence: 0.58, tempo: 127, danceability: 0.79, acousticness: 0.03, instrumentalness: 0.12, spotifyArtistGenres: ["electronic"] },
];

function enrich(track: typeof UK_GARAGE[number]) {
  return enrichTrackSemanticProfile({
    trackId: track.trackId,
    trackName: track.trackName,
    artistName: track.artistName,
    albumName: "",
    energy: track.energy,
    valence: track.valence,
    tempo: track.tempo,
    danceability: track.danceability,
    acousticness: track.acousticness,
    instrumentalness: track.instrumentalness,
    spotifyArtistGenres: track.spotifyArtistGenres,
  });
}

function signatureSet(tracks: ReturnType<typeof enrich>[]): Set<string> {
  return new Set(tracks.map((t) => t.musicSemantic.deepSignature));
}

function avgScore(tracks: ReturnType<typeof enrich>[], prompt: string): number {
  const constraints = buildMusicSemanticConstraintsFromPrompt(prompt);
  const scores = tracks.map((t) => scoreMusicSemanticCompatibility(constraints, t.musicSemantic).boost);
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

function main(): void {
  const ukProfiles = UK_GARAGE.map(enrich);
  const ambientProfiles = AMBIENT.map(enrich);
  const cinematicProfiles = CINEMATIC.map(enrich);
  const clubProfiles = CLUB.map(enrich);

  const ukSigs = signatureSet(ukProfiles);
  const ambientSigs = signatureSet(ambientProfiles);
  const overlapUkAmbient = [...ukSigs].filter((s) => ambientSigs.has(s)).length;

  const ukBroken = ukProfiles.filter((t) => t.musicSemantic.rhythmicComplexity === "broken").length;
  const ambientMinimal = ambientProfiles.filter((t) => t.musicSemantic.rhythmicComplexity === "minimal").length;
  const ukGrainy = ukProfiles.filter((t) => t.musicSemantic.sonicTexture.grain === "grainy").length;
  const ambientSparse = ambientProfiles.filter((t) => t.musicSemantic.sonicTexture.density === "sparse").length;

  const cinematicWide = cinematicProfiles.filter((t) => t.musicSemantic.spatialFeel.includes("wide")).length;
  const clubTight = clubProfiles.filter((t) => t.musicSemantic.spatialFeel.includes("tight")).length;
  const cinematicStatic = cinematicProfiles.filter((t) => t.musicSemantic.emotionalMovement === "static" || t.musicSemantic.emotionalMovement === "evolving").length;
  const clubPulse = clubProfiles.filter((t) => t.musicSemantic.emotionalMovement === "pulse").length;

  const nocturnalScoreUk = avgScore(ukProfiles, "Tokyo at 3am");
  const energeticScoreClub = avgScore(clubProfiles, "warehouse rave at midnight");
  const nocturnalScoreAmbient = avgScore(ambientProfiles, "Tokyo at 3am");

  const manifold = buildUserTasteManifold([...UK_GARAGE, ...AMBIENT]);
  const manifoldV2 = manifold.version === "manifold-v2" && manifold.semanticClusters.length >= 2;

  const checks = [
    { id: "uk-ambient-signatures-separate", pass: overlapUkAmbient === 0 },
    { id: "uk-broken-beat-detected", pass: ukBroken >= 2 },
    { id: "ambient-minimal-rhythm", pass: ambientMinimal >= 2 },
    { id: "uk-grainy-texture", pass: ukGrainy >= 1 },
    { id: "ambient-sparse-density", pass: ambientSparse >= 2 },
    { id: "cinematic-wide-spatial", pass: cinematicWide >= 1 },
    { id: "club-tight-spatial", pass: clubTight >= 1 },
    { id: "cinematic-vs-club-movement", pass: cinematicStatic >= 1 && clubPulse >= 1 },
    { id: "nocturnal-uk-garage-fit", pass: nocturnalScoreUk > nocturnalScoreAmbient * 0.85 },
    { id: "energetic-club-fit", pass: energeticScoreClub >= 0.04 },
    { id: "manifold-v2-semantic-clusters", pass: manifoldV2 },
    { id: "secondary-genre-not-primary", pass: ukProfiles.every((t) => t.musicSemantic.culturalContextTags.length >= 1) },
  ];

  let failed = 0;
  for (const check of checks) {
    if (!check.pass) failed += 1;
    console.log(JSON.stringify(check));
  }

  console.log(JSON.stringify({
    ukDeepSignatures: [...ukSigs],
    ambientDeepSignatures: [...ambientSigs],
    semanticClusters: manifold.semanticClusters?.map((c) => c.clusterId).slice(0, 4),
    sampleUk: ukProfiles[0]?.musicSemantic,
    sampleAmbient: ambientProfiles[0]?.musicSemantic,
  }, null, 2));

  if (failed > 0) {
    console.error(`benchmark:deep-music-semantics failed (${failed}/${checks.length})`);
    process.exit(1);
  }
  console.log(`benchmark:deep-music-semantics passed (${checks.length}/${checks.length})`);
}

main();
