import assert from "node:assert/strict";
import test from "node:test";
import { resolveCommittedWorld } from "../core/committed-world";
import { activityFallbackWorld, resolveVagueWorldCommit } from "../lib/vague-world-commit";

// Calm prompts that name an activity fell to the Sunday-chill default: "brainstorming playlist" came
// back as a cowboy demo, Bob Dylan and Leonard Cohen.

test("study, coding and brainstorming prompts get the focus world", () => {
  for (const p of ["brainstorming playlist", "brainstorming", "studying", "music for studying", "study music", "coding", "music for coding"]) {
    assert.equal(resolveCommittedWorld({ prompt: p })?.id, "focus_study_world", p);
  }
});

test("reading gets the reading world, driving the plain driving world", () => {
  for (const p of ["reading", "reading a book"]) {
    assert.equal(resolveCommittedWorld({ prompt: p })?.id, "rainy_reading_world", p);
  }
  for (const p of ["brain fog driving", "drive to work", "empty highway at sunset", "drive at sunset"]) {
    assert.equal(resolveCommittedWorld({ prompt: p })?.id, "evening_drive_world", p);
  }
});

test("the driving fallback never overrides a stated night drive", () => {
  for (const p of ["empty highway at night", "empty highway at 2am", "highway at night", "night drive", "late night drive"]) {
    assert.equal(resolveCommittedWorld({ prompt: p })?.id, "night_drive_world", p);
  }
  assert.equal(resolveCommittedWorld({ prompt: "sunset drive" })?.id, "evening_drive_world");
});

test("prompts without a recognised activity keep the Sunday default", () => {
  for (const p of ["melancholic", "chill", "something nice", "middle aged dad", "God rays", "brain fog", "songs that drive me crazy", "painting"]) {
    assert.equal(activityFallbackWorld(p), null, p);
    assert.equal(resolveVagueWorldCommit(p).worldId, "sunday_chill_world", p);
  }
  // Garage / workshop reads as "focus" in the intent layer but is not study music.
  assert.equal(activityFallbackWorld("in the garage"), null);
});

test("explicit everyday and situation routes are unchanged", () => {
  assert.equal(resolveCommittedWorld({ prompt: "rainy day in bed" })?.id, "rainy_reading_world");
  assert.equal(resolveCommittedWorld({ prompt: "writing essays" })?.id, "coffee_soft_focus_world");
  assert.equal(resolveCommittedWorld({ prompt: "sunday morning" })?.id, "sunday_chill_world");
  assert.equal(resolveCommittedWorld({ prompt: "music for driving" })?.id, "evening_drive_world");
});
