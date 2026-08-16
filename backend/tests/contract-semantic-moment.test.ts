/**
 * V46 — semantic moment axis scoring tests.
 * Run: npm run build && node --test backend/dist/tests/contract-semantic-moment.test.js
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildPlaylistContract } from "../core/playlist-contract/build-playlist-contract";
import { scoreContractDimension, buildContractCompositionMeta } from "../core/playlist-contract/contract-axis-scoring";
import { computeCompoundIntentScore } from "../core/playlist-contract/contract-composition-select";
import { passesCompoundRetrievalEligibility } from "../core/playlist-contract/contract-compound-eligibility";
import {
  compoundIntersectionStrength,
  harmonicAxisIntersection,
  isEmotionalBangerAudioProfile,
} from "../core/playlist-contract/contract-semantic-moment";

test("V46 harmonic intersection penalizes single-axis dominance", () => {
  const balanced = harmonicAxisIntersection(0.7, 0.68);
  const dominant = harmonicAxisIntersection(0.9, 0.15);
  assert.ok(balanced > dominant, `balanced ${balanced} > dominant ${dominant}`);
  assert.ok(
    compoundIntersectionStrength(0.7, 0.68) > compoundIntersectionStrength(0.9, 0.15),
  );
});

test("V46 sad party bangers prefers emotional banger over techno spam", () => {
  const contract = buildPlaylistContract({ prompt: "sad party bangers" });
  const technoSpam = {
    trackId: "1",
    trackName: "TECHNO - VIP",
    artistName: "ZAPRAVKA",
    energy: 0.92,
    valence: 0.38,
    danceability: 0.82,
    genreFamily: "electronic",
  };
  const sadBanger = {
    trackId: "2",
    trackName: "Someone New",
    artistName: "Hozier",
    energy: 0.72,
    valence: 0.35,
    danceability: 0.58,
    genreFamily: "indie",
  };
  const spamMeta = buildContractCompositionMeta(
    technoSpam,
    contract,
    { genreFamily: "electronic", genrePrimary: "electronic" },
  );
  const fitMeta = buildContractCompositionMeta(
    sadBanger,
    contract,
    { genreFamily: "indie", genrePrimary: "indie" },
  );
  assert.ok(
    computeCompoundIntentScore(fitMeta, contract) > computeCompoundIntentScore(spamMeta, contract),
  );
  assert.equal(passesCompoundRetrievalEligibility(spamMeta, contract), false);
  assert.equal(passesCompoundRetrievalEligibility(fitMeta, contract), true);
});

test("V46 energetic but not cheesy ranks credible indie over spam", () => {
  const technoSpam = {
    trackId: "1",
    trackName: "Stutter Techno VIP Mix",
    artistName: "DJ Spam",
    energy: 0.9,
    valence: 0.55,
    danceability: 0.8,
    genreFamily: "electronic",
  };
  const credible = {
    trackId: "2",
    trackName: "Feel It Still",
    artistName: "Portugal. The Man",
    energy: 0.72,
    valence: 0.62,
    danceability: 0.68,
    genreFamily: "indie",
  };
  const spamNotCheesy = scoreContractDimension(technoSpam, "not_cheesy", { genreFamily: "electronic" });
  const credibleNotCheesy = scoreContractDimension(credible, "not_cheesy", { genreFamily: "indie" });
  assert.ok(credibleNotCheesy > spamNotCheesy);
});

test("V46 chilled but not boring prefers interesting low-energy over flat ambient", () => {
  const flat = {
    trackId: "1",
    trackName: "Ambient Drone",
    artistName: "Sleep",
    energy: 0.18,
    valence: 0.22,
    danceability: 0.12,
    genreFamily: "ambient",
  };
  const interesting = {
    trackId: "2",
    trackName: "Slow Hands",
    artistName: "Interpol",
    energy: 0.48,
    valence: 0.44,
    danceability: 0.52,
    genreFamily: "indie",
  };
  assert.ok(
    scoreContractDimension(interesting, "not_boring", { genreFamily: "indie" }) >
      scoreContractDimension(flat, "not_boring", { genreFamily: "ambient" }),
  );
});

test("V47 emotional banger profile activates both melancholy and party_energy", () => {
  const contract = buildPlaylistContract({ prompt: "sad party bangers" });
  const kidCudi = {
    trackId: "1",
    trackName: "Pursuit Of Happiness",
    artistName: "Kid Cudi",
    energy: 0.68,
    valence: 0.32,
    danceability: 0.55,
    genreFamily: "hip_hop",
  };
  const meta = buildContractCompositionMeta(kidCudi, contract, {
    genreFamily: "hip_hop",
    genrePrimary: "hip_hop",
  });
  assert.ok(
    (meta.axisScores.party_energy ?? 0) >= 0.42,
    `party_energy ${meta.axisScores.party_energy} should activate`,
  );
  assert.ok(
    passesCompoundRetrievalEligibility(meta, contract),
    "emotional banger should pass compound eligibility",
  );
});

test("V47 techno spam still fails compound eligibility for sad party bangers", () => {
  const contract = buildPlaylistContract({ prompt: "sad party bangers" });
  const spamMeta = buildContractCompositionMeta(
    {
      trackId: "1",
      trackName: "TECHNO - VIP",
      artistName: "ZAPRAVKA",
      energy: 0.92,
      valence: 0.38,
      danceability: 0.82,
      genreFamily: "electronic",
    },
    contract,
    { genreFamily: "electronic", genrePrimary: "electronic" },
  );
  assert.equal(passesCompoundRetrievalEligibility(spamMeta, contract), false);
});
