import test from "node:test";
import assert from "node:assert/strict";
import { inferMetadataAudioFeatures } from "../lib/metadata-audio-feature-inference";
import { getCulturalProfile, identityDerivedCulturalProfile } from "../core/editorial/cultural-identity-profile";
import { decomposeTrackWorldIdentity, type WorldIdentityTrack } from "../core/editorial/world-identity-score";
import { passesWorldIdentity, worldIdentityProfilesForLock } from "../core/editorial/world-identity-gate";
import {
  hasRealAudioFeatures,
  musicalFitRankAdjust,
  promptMusicalCharacter,
  scoreMusicalFit,
  softBandFit,
  steerIntentTowardMusicalCharacter,
  worldMusicalCharacter,
} from "../core/editorial/world-musical-character";

// Energy / valence / danceability are the real Spotify measurements from the library export;
// track ids, tempo and loudness are illustrative (they only need to look like real, non-inferred rows).
const SKINNY_LOVE = { trackId: "4RL77hMWUq35NYnPLXBpih", trackName: "Skinny Love", artistName: "Bon Iver", spotifyArtistGenres: ["indie folk"], genreFamily: "folk", energy: 0.257, valence: 0.111, danceability: 0.565, tempo: 75.1, loudness: -12.7 };
const WAITING_ROOM = { trackId: "6Y1aW1ZnrGLkJmvtnR1u7S", trackName: "Waiting Room", artistName: "Phoebe Bridgers", spotifyArtistGenres: ["indie"], genreFamily: "indie", energy: 0.29, valence: 0.12, danceability: 0.53, tempo: 120.3, loudness: -11.2 };
const KIDS = { trackId: "1jJci4qxiYcOHhQR247rEU", trackName: "Kids", artistName: "MGMT", spotifyArtistGenres: ["indie rock"], genreFamily: "indie", energy: 0.931, valence: 0.172, danceability: 0.451, tempo: 122.9, loudness: -3.6 };
const BAD_DREAM = { trackId: "0bad0dream0jungle0gnts", trackName: "Bad Dream", artistName: "The Jungle Giants", spotifyArtistGenres: ["indie"], genreFamily: "indie", energy: 0.58, valence: 0.32, danceability: 0.69, tempo: 110, loudness: -6.1 };
const WINNER = { trackId: "3oEkrIfXfSh9zGnE7eBzSV", trackName: "The Winner Takes It All", artistName: "ABBA", spotifyArtistGenres: ["europop"], genreFamily: "pop", energy: 0.788, valence: 0.52, danceability: 0.454, tempo: 126.1, loudness: -5.9 };
const DANCING_QUEEN = { trackId: "0GjEhVFGZW8afUYGChu3Rr", trackName: "Dancing Queen", artistName: "ABBA", spotifyArtistGenres: ["europop"], genreFamily: "pop", energy: 0.87, valence: 0.754, danceability: 0.543, tempo: 100.8, loudness: -6.5 };
const CHIQUITITA = { trackId: "2lP4nGQEWzfXFiLBbM2Esp", trackName: "Chiquitita", artistName: "ABBA", spotifyArtistGenres: ["europop"], genreFamily: "pop", energy: 0.56, valence: 0.38, danceability: 0.53, tempo: 84.4, loudness: -8.3 };

/** The same track as stored before the import: metadata-inferred values. */
function inferred<T extends { trackId: string; trackName: string; artistName: string }>(track: T): T {
  const f = inferMetadataAudioFeatures({ ...track, albumName: "" });
  return { ...track, energy: Math.fround(f.energy), valence: Math.fround(f.valence), danceability: f.danceability, tempo: Math.fround(f.tempo), loudness: Math.fround(f.loudness) };
}

test("real features are trusted, inferred values and id-less tracks are not", () => {
  assert.equal(hasRealAudioFeatures(SKINNY_LOVE), true);
  assert.equal(hasRealAudioFeatures(inferred(SKINNY_LOVE)), false);
  assert.equal(hasRealAudioFeatures({ ...SKINNY_LOVE, trackId: null }), false);
  const character = worldMusicalCharacter("soft_sad_world");
  assert.equal(scoreMusicalFit(inferred(KIDS), character), null, "no fake precision from inferred values");
  assert.equal(musicalFitRankAdjust(null), 0);
});

test("soft bands: full fit inside, linear fade outside, zero only past the soft width", () => {
  assert.equal(softBandFit(0.3, { max: 0.58 }), 1);
  assert.ok(Math.abs(softBandFit(0.68, { max: 0.58 }) - 0.5) < 1e-9);
  assert.equal(softBandFit(0.93, { max: 0.58 }), 0);
});

test("situation worlds get a scoring profile derived from their identity — no flat score", () => {
  const derived = identityDerivedCulturalProfile("soft_sad_world");
  assert.ok(derived?.derivedFromIdentity);
  assert.equal(getCulturalProfile("soft_sad_world"), null, "derived profiles stay out of the curated-profile gates");
  assert.ok(!getCulturalProfile("grunge_world")?.derivedFromIdentity, "hand-written profiles are untouched");
  const funeral = decomposeTrackWorldIdentity(SKINNY_LOVE as WorldIdentityTrack, derived!);
  const kids = decomposeTrackWorldIdentity(KIDS as WorldIdentityTrack, derived!);
  assert.ok(funeral.score >= 0.6, `Skinny Love ${funeral.score}`);
  assert.ok(kids.score < 0.5, `Kids ${kids.score}`);
  assert.ok(funeral.score - kids.score > 0.15);
});

test("song-level evidence separates songs by the same artist", () => {
  const party = identityDerivedCulturalProfile("party_prep_world")!;
  const sad = worldMusicalCharacter("soft_sad_world");
  const dq = decomposeTrackWorldIdentity(DANCING_QUEEN as WorldIdentityTrack, party);
  const ch = decomposeTrackWorldIdentity(CHIQUITITA as WorldIdentityTrack, party);
  assert.ok(dq.score > ch.score, `party: Dancing Queen ${dq.score} vs Chiquitita ${ch.score}`);
  assert.ok((scoreMusicalFit(CHIQUITITA, sad) ?? 0) > (scoreMusicalFit(DANCING_QUEEN, sad) ?? 1));
  assert.ok((scoreMusicalFit(WINNER, sad) ?? 1) < 0.1, "Winner Takes It All is measured at energy 0.79");
});

test("existing identity bands now act on real measurements (Kids out, Skinny Love in)", () => {
  const profiles = worldIdentityProfilesForLock({ anchors: ["soft_sad_world"] });
  assert.equal(passesWorldIdentity(SKINNY_LOVE, profiles, { hardLock: true }), true);
  assert.equal(passesWorldIdentity(WAITING_ROOM, profiles, { hardLock: true }), true);
  assert.equal(passesWorldIdentity(KIDS, profiles, { hardLock: true }), false);
  // Inside the band, fit still ranks: the heart of the world beats its edge.
  const sad = worldMusicalCharacter("soft_sad_world");
  assert.ok((scoreMusicalFit(SKINNY_LOVE, sad) ?? 0) > (scoreMusicalFit(BAD_DREAM, sad) ?? 1));
});

test("prompt character composes the world and the recognised situation", () => {
  const funeral = promptMusicalCharacter("going to a funeral", "soft_sad_world");
  assert.ok(funeral?.sets.some((s) => s.source === "world:soft_sad_world"));
  assert.ok(funeral?.sets.some((s) => s.source.startsWith("situation:")));
  const drive = promptMusicalCharacter("2000s emo for driving home at night", null);
  assert.ok(drive?.sets.some((s) => s.source === "world:night_drive_world"), JSON.stringify(drive));
  assert.equal(promptMusicalCharacter("", null), null);
});

test("the generic intent target is steered toward the world's musical centre, not replaced", () => {
  const neutral = { energyRange: [0.4, 0.7] as [number, number], valenceTarget: 0 };
  const funeral = steerIntentTowardMusicalCharacter(neutral, promptMusicalCharacter("going to a funeral", "soft_sad_world"));
  assert.ok(funeral.energyRange[1] < 0.55, JSON.stringify(funeral));
  assert.ok(funeral.valenceTarget < -0.2, JSON.stringify(funeral));
  const party = steerIntentTowardMusicalCharacter(neutral, promptMusicalCharacter("getting ready for a massive night out", "party_prep_world"));
  assert.ok(party.energyRange[0] > 0.5 && party.valenceTarget > 0.2, JSON.stringify(party));
  assert.deepEqual(steerIntentTowardMusicalCharacter(neutral, null), neutral);
});

test("musically, 'motorway at 2am' is the motorway; '2am thoughts' stays a quiet 2am", () => {
  const sources = (prompt: string) => (promptMusicalCharacter(prompt, null)?.sets ?? []).map((s) => s.source);
  assert.ok(sources("indie songs for a lonely motorway at 2am").includes("situation:motorway_at_night"));
  assert.ok(!sources("indie songs for a lonely motorway at 2am").includes("situation:two_am_thoughts"));
  assert.ok(sources("2am thoughts").includes("situation:two_am_thoughts"));
  // A soft acoustic song no longer fits the motorway reading better than a moving indie one.
  const character = promptMusicalCharacter("indie songs for a lonely motorway at 2am", "indie_dream_world")!;
  const skinnyLove = scoreMusicalFit(SKINNY_LOVE, character);
  const movingIndie = scoreMusicalFit(BAD_DREAM, character);
  assert.ok(skinnyLove != null && movingIndie != null);
  assert.ok(movingIndie! > skinnyLove!, `${movingIndie} > ${skinnyLove}`);
});
