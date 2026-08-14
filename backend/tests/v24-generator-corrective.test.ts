import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasExplicitMusicalHardLock,
  resolveCommittedWorld,
  resolveRetrievalWorldIds,
} from "../core/committed-world";
import { getCulturalProfile } from "../core/editorial/cultural-identity-profile";
import { inferWorldIdentityIdsFromPrompt } from "../core/editorial/world-identity-gate";
import { scoreTrackWorldIdentity } from "../core/editorial/world-identity-score";
import { retrieveScoringCandidates } from "../lib/candidate-retrieval-pipeline";
import { enforceThesisOpener } from "../core/editorial/thesis-opener-gate";
import {
  filterTracksForDeliveryNegation,
  parsePromptNegationEnforcement,
  parsePromptExcludedArtists,
  trackMatchesExcludedArtist,
} from "../lib/prompt-negation-enforcement";

describe("V24 generator corrective", () => {
  it("G-030: hard techno gym retrieval excludes gym-rock substitution", () => {
    const prompt = "hard techno gym";
    const world = resolveCommittedWorld({ prompt })!;
    assert.equal(world.id, "gym_energy_world");
    assert.ok(hasExplicitMusicalHardLock(world));

    const retrievalIds = resolveRetrievalWorldIds({ committed: world, prompt });
    assert.ok(retrievalIds.includes("gym_energy_world"));
    assert.ok(!retrievalIds.includes("gym_rock_world"));

    const inferred = inferWorldIdentityIdsFromPrompt(prompt);
    assert.ok(inferred.includes("gym_energy_world"));
    assert.ok(!inferred.includes("gym_rock_world"));

    const profile = getCulturalProfile("gym_energy_world");
    assert.ok(profile);
    assert.ok(
      scoreTrackWorldIdentity(
        { artistName: "Charlotte de Witte", trackName: "Selected", energy: 0.88, danceability: 0.72 },
        profile!,
      ) >= 0.75,
    );
    assert.equal(
      scoreTrackWorldIdentity(
        { artistName: "AC/DC", trackName: "Back In Black", energy: 0.92, danceability: 0.55 },
        profile!,
      ),
      0,
    );

    const library = [
      { trackId: "t1", trackName: "Selected", artistName: "Charlotte de Witte", albumName: "A", energy: 0.88, danceability: 0.72 },
      { trackId: "t2", trackName: "Back In Black", artistName: "AC/DC", albumName: "B", energy: 0.92, danceability: 0.55 },
      { trackId: "t3", trackName: "Sweet Child", artistName: "Guns N' Roses", albumName: "C", energy: 0.9, danceability: 0.5 },
      { trackId: "t4", trackName: "Rave", artistName: "Amelie Lens", albumName: "D", energy: 0.9, danceability: 0.68 },
    ];
    const classMap = new Map([
      ["t1", { genrePrimary: "techno", genreFamily: "electronic", primarySubgenre: "techno", secondarySubgenre: null, subGenres: ["techno"] }],
      ["t2", { genrePrimary: "hard_rock", genreFamily: "rock", primarySubgenre: "hard_rock", secondarySubgenre: null, subGenres: ["rock"] }],
      ["t3", { genrePrimary: "hard_rock", genreFamily: "rock", primarySubgenre: "hard_rock", secondarySubgenre: null, subGenres: ["rock"] }],
      ["t4", { genrePrimary: "techno", genreFamily: "electronic", primarySubgenre: "techno", secondarySubgenre: null, subGenres: ["techno"] }],
    ]);

    const result = retrieveScoringCandidates({
      tracks: library,
      vibe: prompt,
      intent: { activity: "gym", mood: [], genreFamilies: ["electronic"] },
      emotionProfile: { energy: 0.85, valence: 0.55, tension: 0.4, nostalgia: 0.2, calm: 0.1, environment: null, timeOfDay: null, motionState: null },
      classMap,
      requestedLength: 25,
      sceneActive: true,
    });

    const artists = result.tracks.map((t) => t.artistName.toLowerCase());
    assert.ok(!artists.some((a) => a.includes("ac/dc") || a.includes("guns n")));
    assert.ok(artists.some((a) => a.includes("charlotte") || a.includes("amelie")));
    assert.notEqual((result.diagnostics as { fallback?: string }).fallback, "activity_ranked_full_library");
  });

  it("G-034: excluded artist absent from negation filter and thesis opener", () => {
    const prompt = "pop punk cardio playlist with no Blink-182";
    const excluded = parsePromptExcludedArtists(prompt);
    assert.ok(excluded.some((a) => a.includes("blink")));

    assert.ok(trackMatchesExcludedArtist("Blink-182", excluded));
    assert.ok(!trackMatchesExcludedArtist("Paramore", excluded));

    const negation = parsePromptNegationEnforcement(prompt);
    const pool = [
      { artistName: "Blink-182", trackName: "All The Small Things", genreFamily: "rock" },
      { artistName: "Paramore", trackName: "Misery Business", genreFamily: "rock" },
      { artistName: "Sum 41", trackName: "Still Waiting", genreFamily: "rock" },
    ];
    const filtered = filterTracksForDeliveryNegation(pool, negation);
    assert.equal(filtered.removed, 1);
    assert.ok(!filtered.tracks.some((t) => /blink/i.test(t.artistName ?? "")));

    const world = resolveCommittedWorld({ prompt })!;
    const profile = getCulturalProfile("pop_punk_world")!;
    const tracks = [
      { artistName: "Blink-182", trackName: "All The Small Things", energy: 0.9 },
      { artistName: "Paramore", trackName: "Misery Business", energy: 0.88 },
    ];
    const thesis = enforceThesisOpener(tracks, profile, world, undefined, 20, negation.excludedArtists);
    assert.ok(!/blink/i.test(thesis.tracks[0]?.artistName ?? ""));
  });

  it("exclusion survives retrieval fallback filtering", () => {
    const prompt = "2000s pop punk gym workout with no Green Day";
    const negation = parsePromptNegationEnforcement(prompt);
    const tracks = [
      { trackId: "g1", trackName: "Basket Case", artistName: "Green Day", albumName: "A", energy: 0.9 },
      { trackId: "p1", trackName: "Misery Business", artistName: "Paramore", albumName: "B", energy: 0.88 },
    ];
    const classMap = new Map([
      ["g1", { genrePrimary: "pop_punk", genreFamily: "rock", primarySubgenre: "pop_punk", secondarySubgenre: null, subGenres: ["pop_punk"] }],
      ["p1", { genrePrimary: "pop_punk", genreFamily: "rock", primarySubgenre: "pop_punk", secondarySubgenre: null, subGenres: ["pop_punk"] }],
    ]);
    const result = retrieveScoringCandidates({
      tracks,
      vibe: prompt,
      intent: { activity: "gym", mood: [], genreFamilies: ["rock"] },
      emotionProfile: { energy: 0.85, valence: 0.6, tension: 0.3, nostalgia: 0.4, calm: 0.1, environment: null, timeOfDay: null, motionState: null },
      classMap,
      requestedLength: 25,
      sceneActive: true,
    });
    assert.ok(!result.tracks.some((t) => /green day/i.test(t.artistName)));
  });

  it("V22 world resolution regressions preserved", () => {
    const uk = resolveCommittedWorld({ prompt: "late night uk garage drive" })!;
    assert.equal(uk.id, "uk_garage_world");
    assert.ok(hasExplicitMusicalHardLock(uk));

    const popPunk = resolveCommittedWorld({ prompt: "2000s pop punk gym workout" })!;
    assert.equal(popPunk.id, "pop_punk_world");
    assert.equal(popPunk.activityContext, "gym");

    const dadRock = resolveCommittedWorld({ prompt: "dad rock BBQ with beers" })!;
    assert.equal(dadRock.id, "dad_rock_world");
  });
});
