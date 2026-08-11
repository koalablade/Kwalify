/**
 * Before/after candidate counts — world belonging retrieval widening.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolveCommittedWorld, getCulturalProfile } from "../dist/core/committed-world.js";
import { runLayeredWorldRetrieval } from "../dist/core/editorial/layered-world-retrieval.js";
import { retrieveScoringCandidates } from "../dist/lib/candidate-retrieval-pipeline.js";
import { trackBelongsForWorldRetrieval } from "../dist/core/editorial/world-belonging-retrieval.js";
import { passesWorldIdentity, worldIdentityProfilesForLock } from "../dist/core/editorial/world-identity-gate.js";

const PROMPTS = [
  { id: "dad_rock", prompt: "dad rock BBQ with beers", roster: ["Queen", "Tom Petty", "AC/DC", "Eagles", "Journey", "Guns N' Roses", "Bon Iver", "Phoebe Bridgers"] },
  { id: "motorway_rain", prompt: "empty motorway at midnight rain on the windscreen", roster: ["M83", "Chromatics", "The War on Drugs", "Depeche Mode", "Oasis", "Bon Iver"] },
  { id: "disco", prompt: "disco rooftop party 1978", roster: ["Chic", "Bee Gees", "Donna Summer", "Dua Lipa", "The Weeknd"] },
  { id: "gym", prompt: "heavy gym workout aggressive", roster: ["Metallica", "AC/DC", "Slayer", "Paramore", "Green Day"] },
];

const FILLER_ARTISTS = ["Arctic Monkeys", "Tame Impala", "Drake", "Taylor Swift", "Ed Sheeran", "Billie Eilish"];

function buildLibrary(roster, total = 9000) {
  const tracks = [];
  let i = 0;
  for (const artist of roster) {
    for (let j = 0; j < 12; j++) {
      tracks.push({
        trackId: `r${i++}`,
        trackName: `${artist} Track ${j + 1}`,
        artistName: artist,
        albumName: "Album",
        energy: 0.72,
        valence: 0.5,
        danceability: 0.55,
        releaseYear: 1985,
      });
    }
  }
  while (tracks.length < total) {
    const artist = FILLER_ARTISTS[tracks.length % FILLER_ARTISTS.length];
    tracks.push({
      trackId: `f${tracks.length}`,
      trackName: `Filler ${tracks.length}`,
      artistName: artist,
      albumName: "Album",
      energy: 0.55,
      valence: 0.5,
      danceability: 0.5,
      releaseYear: 2019,
    });
  }
  return tracks;
}

function countVerifiedStrict(tracks, world, prompt) {
  const profiles = worldIdentityProfilesForLock({
    anchors: world.worldIds,
    prompt,
    reason: world.reason,
  });
  let count = 0;
  for (const t of tracks) {
    if (passesWorldIdentity(
      { artistName: t.artistName, trackName: t.trackName, genreFamily: "rock", genrePrimary: "rock", genres: ["rock"], energy: t.energy, valence: t.valence, danceability: t.danceability },
      profiles,
      { hardLock: true },
    )) count++;
  }
  return count;
}

function countBelonging(tracks, profile) {
  return tracks.filter((t) => trackBelongsForWorldRetrieval(
    { artistName: t.artistName, trackName: t.trackName, genreFamily: "rock", genrePrimary: "rock", genres: ["rock"], energy: t.energy, releaseYear: t.releaseYear },
    profile,
  )).length;
}

const emotionProfile = { energy: 0.6, valence: 0.5, tension: 0.4, nostalgia: 0.3, calm: 0.4, environment: null, timeOfDay: null, motionState: null };
const lines = ["# World Belonging — Before/After Candidate Counts", "", "| Prompt | Library | Strict verified | Belonging pool | Layered | Retrieval output |", "|--------|---------|-----------------|----------------|---------|-------------------|"];

for (const { id, prompt, roster } of PROMPTS) {
  const world = resolveCommittedWorld({ prompt });
  const profile = getCulturalProfile(world.id);
  const library = buildLibrary(roster);
  const classMap = new Map(library.map((t) => [t.trackId, { genrePrimary: "rock", genreFamily: "rock", primarySubgenre: "rock", secondarySubgenre: null, subGenres: ["rock"] }]));
  const strict = countVerifiedStrict(library, world, prompt);
  const belonging = countBelonging(library, profile);
  const layered = runLayeredWorldRetrieval({ prompt, userLibrary: library, culturalProfile: profile, committedWorld: world });
  const retrieval = retrieveScoringCandidates({
    tracks: library,
    vibe: prompt,
    intent: { genreFamilies: [], primaryGenres: [], mood: [] },
    emotionProfile,
    classMap,
    requestedLength: 25,
    sceneActive: true,
    traceRetrievalFunnel: true,
    activeWorldIds: world.worldIds,
  });
  const funnel = retrieval.diagnostics.retrievalFunnel?.stages ?? {};
  lines.push(`| ${id} | ${library.length} | ${strict} | ${belonging} | ${layered.tracks.length} | ${retrieval.tracks.length} (world=${funnel.afterWorldFilter ?? "?"}) |`);
}

mkdirSync("reports/playlist-evaluation", { recursive: true });
const out = "reports/playlist-evaluation/world-belonging-funnel-2026-07-28.md";
writeFileSync(out, lines.join("\n"));
console.log(lines.join("\n"));
console.log(`\nWrote ${out}`);
