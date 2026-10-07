import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveActivityProfile,
  scoreActivityCandidateFit,
  trackFailsActivityHardGate,
  activityGenreMultiplier,
  isPartyPregamePrompt,
} from "../lib/activity-profiles";
import { buildLockedIntent, isGarageHangoutContext } from "../core/v3/intent";

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

// ── Phase 3: garage hangout is social, not focus/coding ─────────────────────

test("garage day with friends is a social hangout, not focus/coding", () => {
  const prompt = "garage day with friends";
  const intent = buildLockedIntent(prompt);
  assert.notEqual(intent.activity, "focus");
  const profile = resolveActivityProfile(prompt, intent);
  assert.ok(profile?.id !== "focus_coding" && profile?.id !== "study", String(profile?.id));
  // Upbeat-social (energy >= 0.48) still applies via the shared hangout helper,
  // and the focus ceiling (energy <= 0.40) no longer does — no empty window.
  assert.equal(isGarageHangoutContext(prompt), true);
  for (const p of ["fixing cars in the garage with mates", "saturday in the garage hanging out"]) {
    assert.notEqual(buildLockedIntent(p).activity, "focus", p);
    assert.notEqual(resolveActivityProfile(p, buildLockedIntent(p))?.id, "focus_coding", p);
  }
});

test("genuine focus/coding/study prompts keep focus behaviour", () => {
  for (const p of ["deep focus coding session late evening", "coding sprint", "deep work no distractions"]) {
    const intent = buildLockedIntent(p);
    assert.equal(resolveActivityProfile(p, intent)?.id, "focus_coding", p);
  }
  assert.equal(resolveActivityProfile("study for exams with calm background music", buildLockedIntent("study for exams with calm background music"))?.id, "study");
  // Bare garage with no social/workshop context keeps its previous focus reading.
  assert.equal(buildLockedIntent("in the garage").activity, "focus");
  assert.equal(isGarageHangoutContext("in the garage"), false);
});

test("genuine social/upbeat prompts still resolve as social", () => {
  assert.equal(isPartyPregamePrompt("pre drinks before a night out with friends", buildLockedIntent("pre drinks before a night out with friends")), true);
  assert.equal(resolveActivityProfile("pre drinks before a night out with friends", buildLockedIntent("pre drinks before a night out with friends"))?.id, "party_pregame");
  assert.equal(isGarageHangoutContext("garage with mates working on the car"), true);
});
