import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveActivityProfile,
  scoreActivityCandidateFit,
  trackFailsActivityHardGate,
  activityGenreMultiplier,
  isPartyPregamePrompt,
} from "../lib/activity-profiles";

test("resolveActivityProfile detects focus coding and study separately", () => {
  const coding = resolveActivityProfile("deep focus coding session late evening", { activity: null });
  const study = resolveActivityProfile("study for exams with calm background music", { activity: null });
  assert.equal(coding?.id, "focus_coding");
  assert.equal(study?.id, "study");
  assert.equal(coding?.energyMax, 0.4);
  assert.equal(study?.energyMax, 0.45);
});

test("focus coding down-ranks UKG and grime", () => {
  const profile = resolveActivityProfile("deep focus coding", { activity: "focus" });
  assert.ok(profile);
  const vetoed = activityGenreMultiplier(
    { genreFamily: "electronic", primarySubgenre: "uk_garage", subGenres: ["uk garage", "2-step"] },
    profile,
    "deep focus coding",
  );
  const ambient = activityGenreMultiplier(
    { genreFamily: "electronic", primarySubgenre: "ambient", subGenres: ["ambient", "idm"] },
    profile,
    "deep focus coding",
  );
  assert.ok(vetoed < 0.5);
  assert.ok(ambient > vetoed);
});

test("party pregame prefers mainstream and rejects hard techno energy combo", () => {
  const vibe = "pregame playlist before going out with friends tonight";
  assert.ok(isPartyPregamePrompt(vibe, { activity: "party" }));
  const profile = resolveActivityProfile(vibe, { activity: "party" });
  assert.ok(profile);
  const mainstream = scoreActivityCandidateFit(
    { energy: 0.82, valence: 0.72, danceability: 0.8, tempo: 118, popularity: 78 },
    { genreFamily: "pop", genrePrimary: "pop" },
    profile!,
    vibe,
  );
  const niche = scoreActivityCandidateFit(
    { energy: 0.88, valence: 0.4, danceability: 0.7, tempo: 150 },
    { genreFamily: "electronic", primarySubgenre: "hard_techno", subGenres: ["hard techno", "tekno"] },
    profile!,
    vibe,
  );
  assert.ok(mainstream > niche);
  assert.ok(trackFailsActivityHardGate(
    { energy: 0.88, speechiness: 0.05 },
    { genreFamily: "electronic", primarySubgenre: "hard_techno", subGenres: ["tekno"] },
    profile!,
    vibe,
  ));
});

test("gym requires high energy floor", () => {
  const profile = resolveActivityProfile("gym confidence boost high energy workout", { activity: "gym" });
  assert.ok(profile);
  assert.ok(trackFailsActivityHardGate({ energy: 0.55 }, null, profile!, "gym workout"));
  assert.equal(trackFailsActivityHardGate({ energy: 0.78, tempo: 124, danceability: 0.7 }, null, profile!, "gym workout"), false);
});
