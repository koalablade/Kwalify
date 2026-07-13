import assert from "node:assert/strict";
import test from "node:test";

import { interpretMoment } from "../core/expectation/moment-space";
import { deriveExpectationContract } from "../core/expectation/expectation-contract";
import { evaluateTrackAdmissibility } from "../core/expectation/track-admissibility";
import type { ExpectationTrack } from "../core/expectation/types";

function contractFor(vibe: string) {
  return deriveExpectationContract(interpretMoment(vibe));
}
const center = (b: [number, number]) => (b[0] + b[1]) / 2;
const energyCenter = (vibe: string) => center(contractFor(vibe).sonicBands.energy);

const probe = (o: Partial<ExpectationTrack>): ExpectationTrack => ({
  trackId: "probe",
  trackName: "Probe",
  artistName: "Probe",
  releaseYear: 2019,
  energy: 0.5,
  valence: 0.5,
  tempo: 110,
  acousticness: 0.5,
  instrumentalness: 0.2,
  ...o,
});
const aggressive = probe({ energy: 0.97, valence: 0.15, tempo: 160, acousticness: 0.02 });
const energeticClean = probe({ energy: 0.95, valence: 0.6, tempo: 150 });
const sleepy = probe({ energy: 0.12, valence: 0.35, tempo: 62, acousticness: 0.85 });

// ---- Activity / energy direction -------------------------------------------

test("calm moments read low-energy; effort moments read high-energy", () => {
  const calmPrompts = [
    "ambient music for falling asleep",
    "quiet rainy evening reading a book",
    "standing outside a hospital at 3am",
    "walking home slowly after a really bad day",
  ];
  const energeticPrompts = [
    "gym pr max effort heavy lifting session",
    "high energy running workout at the track",
  ];
  for (const p of calmPrompts) assert.ok(energyCenter(p) < 0.48, `${p} -> ${energyCenter(p).toFixed(2)} should be calm`);
  for (const p of energeticPrompts) assert.ok(energyCenter(p) > 0.55, `${p} -> ${energyCenter(p).toFixed(2)} should be energetic`);
  assert.ok(energyCenter("ambient music for falling asleep") < energyCenter("gym pr max effort heavy lifting session"));
});

// ---- The four canonical trust-breaking failures ----------------------------

test("sleep rejects rave; first date rejects aggressive; dream-pop nostalgia and golden-hour comedown reject aggression", () => {
  const cases: Array<[string, ExpectationTrack]> = [
    ["ambient music for falling asleep on a rainy night", aggressive],
    ["nervous excited first date at a cosy restaurant", aggressive],
    ["dreamy dream pop nostalgia from my teenage years", aggressive],
    ["golden hour comedown after an all night party", aggressive],
  ];
  for (const [vibe, track] of cases) {
    const a = evaluateTrackAdmissibility(track, contractFor(vibe));
    assert.equal(a.admissible, false, `${vibe} should reject an aggressive track (got ${a.severity})`);
  }
});

test("gym welcomes high energy but rejects sleepy tracks (hostility gate is contextual)", () => {
  const gym = contractFor("gym pr max effort heavy lifting session");
  assert.equal(evaluateTrackAdmissibility(energeticClean, gym).admissible, true, "energetic track fits the gym");
  assert.equal(evaluateTrackAdmissibility(sleepy, gym).admissible, false, "sleepy track does not fit the gym");
});

// ---- Lyrical / production expectations -------------------------------------

test("focus/study leans instrumental, storytelling moment does not", () => {
  const study = contractFor("deep focus instrumental study session");
  assert.ok(["instrumental", "minimal"].includes(study.lyrical), `study lyrical=${study.lyrical}`);
});

// ---- Generalisation: unusual human moments must not throw & stay coherent ---

test("generalises to unusual human moments without predefined categories", () => {
  const unusual = [
    "driving across Norway alone",
    "cleaning my childhood bedroom",
    "finally moving out of my parents house",
    "reading fantasy beside a fireplace",
    "winning after years of failure",
    "watching the sunrise after an all night conversation",
  ];
  for (const vibe of unusual) {
    const interp = interpretMoment(vibe);
    const c = deriveExpectationContract(interp);
    assert.ok(interp.candidates.length >= 1, `${vibe} produced no interpretation`);
    for (const band of [c.sonicBands.energy, c.sonicBands.valence, c.sonicBands.tempo]) {
      assert.ok(band[0] >= 0 && band[1] <= 1 && band[0] <= band[1], `${vibe} invalid band ${JSON.stringify(band)}`);
    }
    assert.ok(Array.isArray(c.atmosphere) && Array.isArray(c.avoid));
    assert.ok(["comfort", "mixed", "exploration"].includes(c.discovery));
  }
});

test("reflective late-night moment is calmer than a triumphant one", () => {
  const hospital = energyCenter("standing outside a hospital at 3am");
  const gym = energyCenter("gym pr max effort heavy lifting session");
  assert.ok(hospital < gym, `hospital(${hospital.toFixed(2)}) should be calmer than gym(${gym.toFixed(2)})`);
});

// ---- Quiet-positive concepts (Phase 3, Priority 2) --------------------------
// These lived-experience prompts previously fell to an "Open" reading with
// neutral valence. They must now ground on a reusable emotional concept and
// read positive-but-understated (valence up without high arousal).

const valenceCenter = (vibe: string) => center(contractFor(vibe).sonicBands.valence);

test("relief / pride / renewal ground and lift valence without becoming hype", () => {
  const cases: Array<[string, string]> = [
    ["I finally handed my notice in", "relief"],
    ["I'm proud of myself but nobody else noticed", "pride"],
    ["I've just moved into my first apartment", "renewal"],
  ];
  for (const [vibe, key] of cases) {
    const interp = interpretMoment(vibe);
    assert.ok(!interp.novelPrompt, `${vibe} should ground (not novel)`);
    assert.ok((interp.dimensions.scores[key] ?? 0) > 0.12, `${vibe} should activate '${key}'`);
    assert.ok(valenceCenter(vibe) >= 0.5, `${vibe} should read non-negative valence`);
    assert.ok(energyCenter(vibe) < 0.72, `${vibe} should not read as high-arousal hype`);
  }
});

test("'quietly optimistic' reads positive but low-arousal", () => {
  const vibe = "I want to feel quietly optimistic";
  assert.ok(valenceCenter(vibe) >= 0.5, "optimism should read positive valence");
  assert.ok(energyCenter(vibe) < 0.6, "quiet optimism should not read energetic");
});
