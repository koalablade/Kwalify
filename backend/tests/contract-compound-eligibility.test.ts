/**
 * V45 — compound eligibility and feasibility tests.
 * Run: npm run build && node --test backend/dist/tests/contract-compound-eligibility.test.js
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildPlaylistContract } from "../core/playlist-contract/build-playlist-contract";
import { buildContractCompositionMeta, scoreContractDimension } from "../core/playlist-contract/contract-axis-scoring";
import {
  assessCompoundFeasibility,
  passesCompoundRetrievalEligibility,
} from "../core/playlist-contract/contract-compound-eligibility";
import { retrieveContractAuthoritativePool } from "../core/playlist-contract/contract-authoritative-retrieval";

test("buildPlaylistContract detects party but not cheesy tension", () => {
  const contract = buildPlaylistContract({ prompt: "party but not cheesy" });
  assert.ok(
    contract.tension.some(
      (t) => t.axes.includes("party_energy") && t.axes.includes("not_cheesy"),
    ),
    "party+not_cheesy tension required",
  );
});

test("buildPlaylistContract detects party but restrained tension", () => {
  const contract = buildPlaylistContract({ prompt: "party but restrained" });
  assert.ok(
    contract.tension.some(
      (t) =>
        t.axes.includes("party_energy") &&
        t.axes.includes("not_cheesy") &&
        t.resolution === "preserve_both",
    ),
    "party+restrained preserve_both tension required",
  );
});

test("melancholy dampens high-energy techno spam without blocking credible sad bangers", () => {
  const technoSpam = {
    trackId: "1",
    trackName: "TECHNO - VIP",
    artistName: "ZAPRAVKA",
    energy: 0.9,
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
  const spamMel = scoreContractDimension(technoSpam, "melancholy", { genreFamily: "electronic" });
  const realMel = scoreContractDimension(sadBanger, "melancholy", { genreFamily: "indie" });
  assert.ok(realMel > spamMel, `expected real melancholy ${realMel} > spam ${spamMel}`);
});

test("passesCompoundRetrievalEligibility rejects single-axis party spam", () => {
  const contract = buildPlaylistContract({ prompt: "sad party bangers" });
  const spamMeta = buildContractCompositionMeta(
    {
      trackId: "1",
      trackName: "Stutter Techno",
      artistName: "DJ",
      energy: 0.88,
      valence: 0.38,
      danceability: 0.8,
      genreFamily: "electronic",
    },
    contract,
    { genreFamily: "electronic", genrePrimary: "electronic" },
  );
  const compoundMeta = buildContractCompositionMeta(
    {
      trackId: "2",
      trackName: "Midnight City",
      artistName: "M83",
      energy: 0.75,
      valence: 0.35,
      danceability: 0.62,
      genreFamily: "electronic",
    },
    contract,
    { genreFamily: "electronic", genrePrimary: "electronic" },
  );
  assert.equal(passesCompoundRetrievalEligibility(spamMeta, contract), false);
  assert.equal(passesCompoundRetrievalEligibility(compoundMeta, contract), true);
});

test("retrieveContractAuthoritativePool deprioritizes techno VIP for sad party bangers", () => {
  const prompt = "sad party bangers";
  const contract = buildPlaylistContract({ prompt });
  const tracks = [
    {
      trackId: "spam",
      trackName: "TECHNO - VIP",
      artistName: "ZAPRAVKA",
      energy: 0.92,
      valence: 0.38,
      genreFamily: "electronic",
      danceability: 0.82,
    },
    {
      trackId: "fit",
      trackName: "Midnight City",
      artistName: "M83",
      energy: 0.75,
      valence: 0.35,
      genreFamily: "electronic",
      danceability: 0.62,
    },
    {
      trackId: "fit2",
      trackName: "Pursuit Of Happiness",
      artistName: "Kid Cudi",
      energy: 0.68,
      valence: 0.32,
      genreFamily: "hip_hop",
      danceability: 0.55,
    },
  ];
  const classMap = new Map(
    tracks.map((t) => [
      t.trackId,
      {
        genrePrimary: t.genreFamily,
        genreFamily: t.genreFamily,
        primarySubgenre: "",
        secondarySubgenre: null,
        subGenres: [] as string[],
      },
    ]),
  );
  const result = retrieveContractAuthoritativePool({
    tracks,
    contract,
    classMap,
    emotionProfile: {
      energy: 0.65,
      valence: 0.4,
      tension: 0.5,
      nostalgia: 0.3,
      calm: 0.2,
      environment: null,
      timeOfDay: null,
      motionState: null,
    },
    vibe: prompt,
    broadCap: 3,
  });
  assert.notEqual(result.tracks[0]?.trackId, "spam");
  assert.ok(result.tracks.some((t) => t.trackId === "fit" || t.trackId === "fit2"));
});

test("assessCompoundFeasibility allows graceful degradation with imperfect supply", () => {
  const contract = buildPlaylistContract({ prompt: "party but not cheesy" });
  const metas = [
    buildContractCompositionMeta(
      { trackId: "1", trackName: "Feel It Still", artistName: "Portugal. The Man", energy: 0.72, valence: 0.62, danceability: 0.68, genreFamily: "indie" },
      contract,
      { genreFamily: "indie", genrePrimary: "indie" },
    ),
    buildContractCompositionMeta(
      { trackId: "2", trackName: "Electric Feel", artistName: "MGMT", energy: 0.78, valence: 0.58, danceability: 0.7, genreFamily: "indie" },
      contract,
      { genreFamily: "indie", genrePrimary: "indie" },
    ),
    buildContractCompositionMeta(
      { trackId: "3", trackName: "Tongue Tied", artistName: "Grouplove", energy: 0.74, valence: 0.55, danceability: 0.66, genreFamily: "indie" },
      contract,
      { genreFamily: "indie", genrePrimary: "indie" },
    ),
  ];
  const feasibility = assessCompoundFeasibility(metas, contract, 25);
  assert.equal(feasibility.gracefulDegradation, true);
  assert.ok(feasibility.minHonestDelivery >= 3);
});
