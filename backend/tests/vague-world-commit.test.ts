import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveVagueWorldCommit,
  shouldSuppressVagueWiden,
} from "../lib/vague-world-commit";
import { evaluatePromptReadiness } from "../lib/prompt-readiness";
import { resolveActivityProfile } from "../lib/activity-profiles";
import { inferWorldIdentityIdsFromPrompt, passesWorldIdentity, stripRetrievalFillerTracks, demoteOpenerFillerTracks, sanitizePsychIndieOpenerChain, countPsychIndieOpenerFillers, maxPsychIndieOpenersForWorlds, OPENER_FILLER_PATTERN, worldIdentityProfilesForLock } from "../core/editorial/world-identity-gate";

test("party prep vague prompts commit to party_prep_world", () => {
  const c = resolveVagueWorldCommit("hype night out", { tier: "low", promptConfidenceScore: 0.3 });
  assert.equal(c.action, "commit");
  assert.equal(c.worldId, "party_prep_world");
});

test("vague lifestyle prompts auto-commit one everyday world", () => {
  const cases: Array<[string, string]> = [
    ["happy vibes only", "feel_good_world"],
    ["idk just make me feel something", "nostalgia_warm_world"],
    ["what would a cool older sibling put on", "older_sibling_world"],
    ["playlist that feels like a film ending", "film_ending_world"],
    ["songs my dad would secretly like", "dad_secret_world"],
    ["latin summer rooftop drinks", "latin_summer_rooftop_world"],
    ["music for cooking dinner with friends", "social_kitchen_world"],
    ["something chill for Sunday morning", "sunday_chill_world"],
    ["need energy for the gym", "gym_energy_world"],
    ["i just got dumped be gentle", "soft_sad_world"],
    ["coffee shop laptop session", "coffee_soft_focus_world"],
    ["driving home after work", "evening_drive_world"],
    ["nostalgic driving", "evening_drive_world"],
    ["cozy Sunday morning", "sunday_chill_world"],
  ];
  for (const [prompt, world] of cases) {
    const c = resolveVagueWorldCommit(prompt, { tier: "low", promptConfidenceScore: 0.25 });
    assert.ok(c.action === "commit" || c.action === "clarify", prompt);
    assert.equal(c.worldId, world, prompt);
    assert.ok(c.action === "clarify" || shouldSuppressVagueWiden(c), prompt);
  }
});

test("late night drive commits to night drive world", () => {
  const c = resolveVagueWorldCommit("late night drive", { tier: "low", promptConfidenceScore: 0.25 });
  assert.equal(c.action, "commit");
  assert.equal(c.worldId, "night_drive_world");
  assert.ok(shouldSuppressVagueWiden(c));
});

test("evening drive stays distinct from late night drive", () => {
  const evening = resolveVagueWorldCommit("evening drive", { tier: "low", promptConfidenceScore: 0.25 });
  assert.equal(evening.action, "commit");
  assert.equal(evening.worldId, "evening_drive_world");
});

test("named genre prompts passthrough without everyday override", () => {
  const c = resolveVagueWorldCommit("90s grunge dark cloudy night", { tier: "high" });
  assert.equal(c.action, "passthrough");
});

test("readiness allows commit without four-word bypass alone", () => {
  const r = evaluatePromptReadiness({
    vibe: "happy vibes only please thanks",
    tier: "low",
    score: 0.2,
  });
  assert.equal(r.ready, true);
  assert.equal(r.vagueCommit?.action, "commit");
  assert.equal(r.vagueCommit?.worldId, "feel_good_world");
});

test("inferWorldIdentityIdsFromPrompt commits everyday worlds", () => {
  const ids = inferWorldIdentityIdsFromPrompt("cooking dinner with friends");
  assert.ok(ids.includes("social_kitchen_world"), String(ids));
});

test("nostalgic driving and lo-fi study route to correct worlds", () => {
  const driveIds = inferWorldIdentityIdsFromPrompt("nostalgic driving");
  assert.ok(driveIds.includes("evening_drive_world"), String(driveIds));
  const studyIds = inferWorldIdentityIdsFromPrompt("lo-fi study");
  assert.ok(studyIds.includes("lofi_world"), String(studyIds));
  assert.ok(studyIds.includes("focus_study_world"), String(studyIds));
});

test("sunday chill rejects Storm Queen / DMX", () => {
  const profiles = worldIdentityProfilesForLock({ prompt: "cozy evening on the sofa" });
  assert.ok(profiles.some((p) => p.id === "sunday_chill_world"));
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "Look Right Through",
        artistName: "Storm Queen",
        spotifyArtistGenres: ["house", "uk garage"],
        energy: 0.7,
      },
      profiles,
      { hardLock: true },
    ),
    false,
  );
});

test("gym prompt matches lift without gym keyword", () => {
  const profile = resolveActivityProfile("ex's birthday ignore them and lift", {});
  assert.equal(profile?.id, "gym");
});

test("gym energy rejects Blondie / Storm Queen / classic rock", () => {
  const profiles = worldIdentityProfilesForLock({ prompt: "need energy for the gym" });
  assert.ok(profiles.some((p) => p.id === "gym_energy_world"));
  for (const artist of ["Blondie", "Storm Queen", "Fleetwood Mac", "The Doors", "Iron Maiden"]) {
    assert.equal(
      passesWorldIdentity(
        {
          trackName: "Hit",
          artistName: artist,
          spotifyArtistGenres: ["rock", "pop"],
          energy: 0.8,
        },
        profiles,
        { hardLock: true },
      ),
      false,
      artist,
    );
  }
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "HUMBLE.",
        artistName: "Kendrick Lamar",
        spotifyArtistGenres: ["hip hop", "rap"],
        energy: 0.72,
        danceability: 0.55,
      },
      profiles,
      { hardLock: true },
    ),
    true,
  );
});

test("retrieval filler blocked outside natural worlds", () => {
  const profiles = worldIdentityProfilesForLock({ prompt: "happy vibes only" });
  assert.ok(profiles.some((p) => p.id === "feel_good_world"));
  for (const artist of ["Tame Impala", "Kasabian", "Q Lazzarus"]) {
    assert.equal(
      passesWorldIdentity(
        {
          trackName: "Track",
          artistName: artist,
          spotifyArtistGenres: ["indie", "psychedelic rock"],
          energy: 0.55,
          valence: 0.55,
        },
        profiles,
        { hardLock: true },
      ),
      false,
      artist,
    );
  }
});

test("stripRetrievalFillerTracks removes opener fillers when supply exists", () => {
  const tracks = [
    { artist: "Tame Impala" },
    { artist: "Kasabian" },
    { artist: "Dua Lipa" },
    { artist: "Mark Ronson" },
    { artist: "ABBA" },
  ];
  const out = stripRetrievalFillerTracks(tracks, ["feel_good_world"], { minKeep: 3 });
  assert.ok(!out.tracks.some((t) => /tame impala|kasabian/i.test(String(t.artist))));
  assert.ok(out.tracks.length >= 3);
});

test("demoteOpenerFillerTracks moves kasabian/q opener chain to tail", () => {
  const tracks = [
    { artist: "Kasabian" },
    { artist: "Q Lazzarus" },
    { artist: "Dua Lipa" },
    { artist: "ABBA" },
    { artist: "Donna Summer" },
  ];
  const out = demoteOpenerFillerTracks(tracks, ["feel_good_world"], 3);
  const opener = out.tracks.slice(0, 2).map((t) => String(t.artist));
  assert.ok(!/kasabian|q lazzarus/i.test(opener.join(" ")));
  assert.ok(out.demoted.length >= 1);
});

test("stripRetrievalFillerTracks does not restore fillers when minKeep is honest floor", () => {
  const tracks = Array.from({ length: 25 }, (_, i) => ({
    artist: i < 3 ? ["Tame Impala", "Kasabian", "Q Lazzarus"][i]! : `Artist ${i}`,
  }));
  const out = stripRetrievalFillerTracks(tracks, ["dad_secret_world"], { minKeep: 3 });
  assert.equal(out.tracks.length, 22);
  assert.ok(!out.tracks.slice(0, 3).some((t) => /tame impala|kasabian|q lazzarus/i.test(String(t.artist))));
});

test("sanitizePsychIndieOpenerChain caps opener psych-indie fillers even in nostalgia world", () => {
  const tracks = [
    { artist: "Tame Impala" },
    { artist: "Kasabian" },
    { artist: "Q Lazzarus" },
    { artist: "Franz Ferdinand" },
    { artist: "Interpol" },
  ];
  const out = sanitizePsychIndieOpenerChain(tracks, 3, 1);
  assert.equal(countPsychIndieOpenerFillers(out.tracks, 3), 1);
  assert.ok(!/kasabian|q lazzarus/i.test(String(out.tracks[0]!.artist)));
});

test("sanitizePsychIndieOpenerChain removes all psych openers for film-ending world cap", () => {
  const tracks = [
    { artist: "Tame Impala" },
    { artist: "Kasabian" },
    { artist: "Q Lazzarus" },
    { artist: "Sigur Rós" },
    { artist: "Radiohead" },
    { artist: "Interpol" },
  ];
  const out = sanitizePsychIndieOpenerChain(tracks, 3, 0);
  assert.equal(countPsychIndieOpenerFillers(out.tracks, 3, ["film_ending_world"]), 0);
  assert.ok(!OPENER_FILLER_PATTERN.test(String(out.tracks[0]!.artist)));
});

test("coffee shop rejects psych filler and hip-hop", () => {
  const profiles = worldIdentityProfilesForLock({ prompt: "coffee shop laptop session" });
  assert.ok(profiles.some((p) => p.id === "coffee_soft_focus_world"));
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "Roll Up",
        artistName: "Wiz Khalifa",
        spotifyArtistGenres: ["hip hop", "rap"],
        energy: 0.5,
      },
      profiles,
      { hardLock: true },
    ),
    false,
  );
});

test("madchester britpop profile rejects remix bait titles", () => {
  const profiles = worldIdentityProfilesForLock({ prompt: "madchester pub walk" });
  assert.ok(profiles.some((p) => p.id === "britpop_world"));
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "Fools Gold - Extended Remix",
        artistName: "The Stone Roses",
        spotifyArtistGenres: ["madchester", "indie rock"],
        energy: 0.7,
      },
      profiles,
      { hardLock: true },
    ),
    false,
  );
});
