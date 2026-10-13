import assert from "node:assert/strict";
import test from "node:test";
import { resolveCommittedWorld } from "../core/committed-world";
import { containsCue, cueIndex } from "../lib/world-understanding/text-match";
import { promptNamesAtlasEntry } from "../lib/world-understanding/atlas-loader";
import { resolveSituationWorld } from "../lib/world-understanding/situation-world-router";

// "rain" matched inside "brainstorming" / "brain", so the situation router sent those prompts to
// rainy / night driving worlds.

test("cues match whole words and their inflections, not the inside of other words", () => {
  for (const [text, cue] of [
    ["rain", "rain"], ["rainy drive", "rain"], ["raining again", "rain"], ["it rains", "rain"],
    ["driven home", "drive"], ["night driver", "drive"], ["drives", "drive"],
    ["stormy night", "storm"], ["lying in bed", "in bed"], ["up at 2am", "2am"],
    ["driving in the rain", "driving in the rain"], ["visiting my hometown", "home"], ["Back Home", "home"],
    ["midnight drive", "night drive"], ["tonight", "night"],
  ]) {
    assert.equal(containsCue(text, cue), true, `${cue} in ${text}`);
  }
  for (const [text, cue] of [
    ["brainstorming playlist", "rain"], ["brain fog driving", "rain"], ["brainstorming", "storm"],
    ["train ride home", "rain"], ["rainbow road", "rain"], ["homecoming", "home"],
    ["knight rider", "night"], ["fortnight", "night"], ["scar", "car"], ["driveway", "drive"],
    ["driving home", "drive"], // never matched; the data lists "driving" itself
  ]) {
    assert.equal(containsCue(text, cue), false, `${cue} not in ${text}`);
  }
  assert.equal(cueIndex("the brain and the rain", "rain"), 18);
});

test("a situation needs the prompt's own words, not an association", () => {
  assert.equal(promptNamesAtlasEntry("rain in bed", "motorway_at_night"), false); // "rain" is only nearby
  assert.equal(promptNamesAtlasEntry("lonely motorway at 2am", "motorway_at_night"), true);
  assert.equal(promptNamesAtlasEntry("rainy drive home", "rainy_windscreen_drive"), true);
  assert.equal(promptNamesAtlasEntry("brain fog driving", "rainy_windscreen_drive"), true); // "driving" is its activity…
  assert.notEqual(resolveSituationWorld("brain fog driving")?.experienceId, "rainy_windscreen_drive"); // …but not its dominant moment
  for (const p of ["brainstorming playlist", "rainy day in bed", "rain in bed"]) {
    assert.notEqual(resolveSituationWorld(p)?.experienceId, "motorway_at_night", p);
  }
});

test("substring prompts no longer route to driving worlds", () => {
  const rainyOrNight = ["night_drive_world", "rainy_drive_world", "rainy_motorway_world"];
  for (const p of ["brainstorming playlist", "rainy day in bed", "rain in bed", "brain fog driving"]) {
    assert.equal(rainyOrNight.includes(resolveCommittedWorld({ prompt: p })?.id ?? ""), false, p);
  }
  for (const p of ["brainstorming playlist", "rainy day in bed", "rain in bed"]) {
    assert.notEqual(resolveCommittedWorld({ prompt: p })?.id, "evening_drive_world", p);
  }
  // No rain in either: brainstorming is focus work; brain fog driving is a plain (calm) drive.
  assert.equal(resolveCommittedWorld({ prompt: "brainstorming playlist" })?.id, "focus_study_world");
  assert.equal(resolveCommittedWorld({ prompt: "brain fog driving" })?.id, "evening_drive_world");
  // The everyday map's explicit "rainy day in bed" pattern.
  assert.equal(resolveCommittedWorld({ prompt: "rainy day in bed" })?.id, "rainy_reading_world");
  // Explicit evidence: "bed" is lying_awake's environment.
  assert.equal(resolveSituationWorld("rain in bed")?.experienceId, "lying_awake");
});

test("real rainy driving prompts keep their worlds", () => {
  for (const p of ["rainy drive", "rainy driving", "rainy drive home", "driving in the rain"]) {
    assert.equal(resolveCommittedWorld({ prompt: p })?.id, "rainy_drive_world", p);
  }
  assert.equal(resolveCommittedWorld({ prompt: "rainy motorway" })?.id, "rainy_motorway_world");
  for (const p of ["rainy day", "rainy sunday", "rainy afternoon reading"]) {
    assert.equal(resolveCommittedWorld({ prompt: p })?.id, "rainy_reading_world", p);
  }
});
