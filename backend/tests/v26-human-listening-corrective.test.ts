import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasExplicitMusicalHardLock,
  resolveCommittedWorld,
  resolveRetrievalWorldIds,
} from "../core/committed-world";
import { getCulturalProfile } from "../core/editorial/cultural-identity-profile";
import { inferWorldIdentityIdsFromPrompt } from "../core/editorial/world-identity-gate";
import { applyWorldPurityGate } from "../core/editorial/world-purity-gate";
import { scoreTrackWorldIdentity } from "../core/editorial/world-identity-score";
import {
  filterTracksForDeliveryNegation,
  parsePromptNegationEnforcement,
  trackMatchesExcludedArtist,
} from "../lib/prompt-negation-enforcement";

describe("V26 Human Listening Corrective", () => {
  it("sunset beach reggae commits reggae_world not beach_sunset_world", () => {
    const prompt = "sunset beach reggae";
    const world = resolveCommittedWorld({ prompt })!;

    assert.equal(world.id, "reggae_world");
    assert.equal(world.musicalWorldId, "reggae_world");
    assert.notEqual(world.id, "beach_sunset_world");
    assert.equal(world.source, "explicit_genre");
    assert.ok(hasExplicitMusicalHardLock(world));

    const inferred = inferWorldIdentityIdsFromPrompt(prompt);
    assert.ok(inferred.includes("reggae_world"));
    assert.ok(!inferred.includes("beach_sunset_world"));

    const profile = getCulturalProfile("reggae_world")!;
    assert.ok(
      scoreTrackWorldIdentity(
        { artistName: "Bob Marley", trackName: "Three Little Birds", energy: 0.55, valence: 0.72 },
        profile,
      ) >= 0.75,
    );
    assert.equal(
      scoreTrackWorldIdentity(
        { artistName: "MGMT", trackName: "Electric Feel", energy: 0.68, valence: 0.72 },
        profile,
      ),
      0,
    );
    assert.equal(
      scoreTrackWorldIdentity(
        { artistName: "Wallows", trackName: "Are You Bored Yet?", energy: 0.62, valence: 0.66 },
        profile,
      ),
      0,
    );
  });

  it("hard techno gym rejects Paramore in purity gate", () => {
    const prompt = "hard techno gym";
    const world = resolveCommittedWorld({ prompt })!;
    assert.equal(world.id, "gym_energy_world");

    const profile = getCulturalProfile("gym_energy_world")!;
    const pool = [
      { artistName: "Charlotte de Witte", trackName: "Selected", energy: 0.88, danceability: 0.72, genreFamily: "electronic" },
      { artistName: "Amelie Lens", trackName: "In My Mind", energy: 0.9, danceability: 0.68, genreFamily: "electronic" },
      { artistName: "Paramore", trackName: "Misery Business", energy: 0.88, danceability: 0.55, genreFamily: "rock" },
      { artistName: "Fall Out Boy", trackName: "Sugar, We're Goin Down", energy: 0.85, danceability: 0.52, genreFamily: "rock" },
      { artistName: "Fred again..", trackName: "Delilah", energy: 0.82, danceability: 0.65, genreFamily: "electronic" },
    ];

    const purity = applyWorldPurityGate(pool, world, {
      prompt,
      requestedLength: 25,
      coverageTier: "LOW",
    });

    const artists = purity.tracks.map((t) => t.artistName?.toLowerCase() ?? "");
    assert.ok(!artists.some((a) => a.includes("paramore")));
    assert.ok(!artists.some((a) => a.includes("fall out boy")));
    assert.ok(artists.some((a) => a.includes("charlotte") || a.includes("amelie") || a.includes("fred")));

    assert.equal(
      scoreTrackWorldIdentity(
        { artistName: "Paramore", trackName: "Misery Business", energy: 0.88, danceability: 0.55 },
        profile,
      ),
      0,
    );
  });

  it("exclusion regression: no Blink-182 in negation-filtered delivery", () => {
    const prompt = "pop punk road trip, no Blink-182";
    const negation = parsePromptNegationEnforcement(prompt);
    assert.ok(trackMatchesExcludedArtist("Blink-182", negation.excludedArtists));

    const pool = [
      { artistName: "Blink-182", trackName: "All The Small Things", genreFamily: "rock" },
      { artistName: "Paramore", trackName: "Misery Business", genreFamily: "rock" },
      { artistName: "Sum 41", trackName: "Still Waiting", genreFamily: "rock" },
    ];
    const filtered = filterTracksForDeliveryNegation(pool, negation);
    assert.equal(filtered.removed, 1);
    assert.ok(!filtered.tracks.some((t) => /blink/i.test(t.artistName ?? "")));
    assert.ok(filtered.tracks.some((t) => /paramore/i.test(t.artistName ?? "")));
  });

  it("V22 world resolution preserved", () => {
    const uk = resolveCommittedWorld({ prompt: "late night uk garage drive" })!;
    assert.equal(uk.id, "uk_garage_world");
    assert.ok(hasExplicitMusicalHardLock(uk));
    assert.ok(resolveRetrievalWorldIds({ committed: uk, prompt: "late night uk garage drive" }).includes("uk_garage_world"));

    const popPunk = resolveCommittedWorld({ prompt: "2000s pop punk gym workout" })!;
    assert.equal(popPunk.id, "pop_punk_world");
    assert.equal(popPunk.activityContext, "gym");

    const dadRock = resolveCommittedWorld({ prompt: "dad rock BBQ with beers" })!;
    assert.equal(dadRock.id, "dad_rock_world");

    const motorway = resolveCommittedWorld({ prompt: "rain on the windscreen empty motorway at midnight" })!;
    assert.equal(motorway.id, "rainy_motorway_world");

    const technoGym = resolveCommittedWorld({ prompt: "hard techno gym" })!;
    assert.equal(technoGym.id, "gym_energy_world");
    assert.notEqual(technoGym.id, "gym_rock_world");
  });
});
