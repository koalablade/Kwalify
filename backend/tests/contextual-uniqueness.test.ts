import test from "node:test";
import assert from "node:assert/strict";
import {
  applyContextualUniquenessPenalty,
  buildContextualTrackMemory,
  buildPlaylistContextFingerprint,
  contextualUniquenessPenalty,
  contextSpreadForTrack,
  CUP_MAX_PENALTY,
  CUP_MIN_CONTEXT_SPREAD,
  formatContextFingerprint,
  inferCategoryFromVibe,
  isExplicitArtistOrAlbumPrompt,
} from "../lib/contextual-uniqueness";

const focusContext = buildPlaylistContextFingerprint({
  category: "focus",
  curatorIdentityType: "focus_minimalist",
  primaryGenreFamily: "ambient",
  activity: "focus",
  energy: "low",
});

const gymContext = buildPlaylistContextFingerprint({
  category: "gym",
  curatorIdentityType: "gym_beast",
  primaryGenreFamily: "rock",
  activity: "gym",
  energy: "high",
});

const partyContext = buildPlaylistContextFingerprint({
  category: "party",
  curatorIdentityType: "party_social",
  primaryGenreFamily: "pop",
  activity: "party",
  energy: "high",
});

test("contextualUniquenessPenalty — no penalty below spread threshold", () => {
  assert.equal(contextualUniquenessPenalty(0), 0);
  assert.equal(contextualUniquenessPenalty(2), 0);
  assert.ok(contextualUniquenessPenalty(3) > 0);
  assert.ok(contextualUniquenessPenalty(5) <= CUP_MAX_PENALTY);
});

test("buildContextualTrackMemory — tracks distinct winning contexts", () => {
  const memory = buildContextualTrackMemory([
    { trackIds: ["laurindo"], context: focusContext },
    { trackIds: ["laurindo"], context: gymContext },
    { trackIds: ["laurindo"], context: partyContext },
  ]);
  assert.equal(contextSpreadForTrack(memory, "laurindo"), 3);
  assert.equal(contextSpreadForTrack(memory, "fresh"), 0);
});

test("applyContextualUniquenessPenalty — universal winner loses score headroom", () => {
  const memory = buildContextualTrackMemory([
    { trackIds: ["repeat"], context: focusContext },
    { trackIds: ["repeat"], context: gymContext },
    { trackIds: ["repeat"], context: partyContext },
    { trackIds: ["repeat"], context: buildPlaylistContextFingerprint({
      category: "chill",
      curatorIdentityType: "chill_warm",
      primaryGenreFamily: "jazz",
      activity: "chill",
      energy: "low",
    }) },
  ]);
  const config = { enabled: true, memory };
  const penalised = applyContextualUniquenessPenalty(0.82, "repeat", "Laurindo Almeida", config);
  const fresh = applyContextualUniquenessPenalty(0.74, "fresh", "New Artist", config);
  assert.ok(penalised.penalty > 0);
  assert.equal(fresh.penalty, 0);
  assert.ok(fresh.score > penalised.score);
});

test("applyContextualUniquenessPenalty — thin library bypass", () => {
  const memory = buildContextualTrackMemory([
    { trackIds: ["repeat"], context: focusContext },
    { trackIds: ["repeat"], context: gymContext },
    { trackIds: ["repeat"], context: partyContext },
  ]);
  const result = applyContextualUniquenessPenalty(0.8, "repeat", "Artist", {
    enabled: true,
    memory,
    thinLibraryRelaxed: true,
  });
  assert.equal(result.penalty, 0);
  assert.equal(result.bypassReason, "thin_library_relaxed");
});

test("applyContextualUniquenessPenalty — explicit artist prompt bypass", () => {
  const memory = buildContextualTrackMemory([
    { trackIds: ["repeat"], context: focusContext },
    { trackIds: ["repeat"], context: gymContext },
    { trackIds: ["repeat"], context: partyContext },
  ]);
  const result = applyContextualUniquenessPenalty(0.8, "repeat", "Queen", {
    enabled: true,
    memory,
    explicitArtistOrAlbumPrompt: true,
  });
  assert.equal(result.penalty, 0);
  assert.equal(result.bypassReason, "explicit_artist_or_album_prompt");
});

test("inferCategoryFromVibe — maps common benchmark families", () => {
  assert.equal(inferCategoryFromVibe("focus deep study no distractions"), "focus");
  assert.equal(inferCategoryFromVibe("gym cardio workout"), "gym");
  assert.equal(inferCategoryFromVibe("party pre drinks"), "party");
});

test("formatContextFingerprint — stable key", () => {
  const key = formatContextFingerprint(focusContext);
  assert.match(key, /focus\|focus_minimalist\|ambient\|focus\|low-energy/);
});

test("isExplicitArtistOrAlbumPrompt — detects artist and album prompts", () => {
  assert.equal(isExplicitArtistOrAlbumPrompt("Queen greatest hits"), true);
  assert.equal(isExplicitArtistOrAlbumPrompt("focus study beats"), false);
});
