/**
 * Unit tests for V40 contract-authoritative retrieval.
 * Run: npm run build && node --test backend/dist/tests/contract-authoritative-retrieval.test.js
 */

import assert from "node:assert/strict";
import test from "node:test";

import { resolveCommittedWorld } from "../core/committed-world";
import { buildPlaylistContract } from "../core/playlist-contract/build-playlist-contract";
import { compareContractWithWorld } from "../core/playlist-contract/compare-with-world";
import { retrieveContractAuthoritativePool } from "../core/playlist-contract/contract-authoritative-retrieval";
import {
  setPlaylistContractV40Enabled,
} from "../core/playlist-contract/feature-flag";
import { resolveWorldGateContext } from "../core/playlist-contract/world-gate-context";
import { evaluateWorldGate } from "../core/playlist-contract/world-gate";

test("sad party bangers contract pool prefers party-energy over acoustic indie", () => {
  const prompt = "sad party bangers";
  const world = resolveCommittedWorld({ prompt });
  const contract = buildPlaylistContract({ prompt, committedWorld: world });
  const tracks = [
    { trackId: "1", trackName: "Glue Song", artistName: "beabadoobee", energy: 0.4, valence: 0.35, genreFamily: "indie" },
    { trackId: "2", trackName: "Levels", artistName: "Avicii", energy: 0.88, valence: 0.55, genreFamily: "electronic", danceability: 0.75 },
    { trackId: "3", trackName: "Someone Like You", artistName: "Adele", energy: 0.35, valence: 0.2, genreFamily: "pop" },
    { trackId: "4", trackName: "Titanium", artistName: "David Guetta", energy: 0.78, valence: 0.6, genreFamily: "electronic", danceability: 0.72 },
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
    emotionProfile: { energy: 0.65, valence: 0.4, tension: 0.5, nostalgia: 0.3, calm: 0.2, environment: null, timeOfDay: null, motionState: null },
    vibe: prompt,
    broadCap: 4,
  });
  assert.equal(result.diagnostics.worldAuthorityUsed, false);
  assert.equal(result.diagnostics.contractAuthorityUsed, true);
  assert.ok(result.diagnostics.tensionPreservation.length > 0);
  const ids = result.tracks.map((t) => t.trackId);
  assert.notDeepEqual(ids, ["1"]);
  assert.ok(ids.some((id) => id === "2" || id === "4"));
  const partyMeta = (result.tracks.find((t) => t.trackId === "2") as { contractCompositionMeta?: { axisScores: Record<string, number> } })?.contractCompositionMeta;
  assert.ok((partyMeta?.axisScores.party_energy ?? 0) >= 0.42);
});

test("V40 gate evaluation defers without V39 flag", () => {
  setPlaylistContractV40Enabled(true);
  const ctx = resolveWorldGateContext({ prompt: "sad party bangers" });
  assert.equal(ctx.gateDecision?.deferHardLock, true);
  assert.equal(ctx.effectiveWorld?.hardLock, true);
  setPlaylistContractV40Enabled(null);
});

test("explicit genre does not defer under V40 evaluation", () => {
  setPlaylistContractV40Enabled(true);
  const ctx = resolveWorldGateContext({ prompt: "sunset beach reggae" });
  assert.equal(ctx.gateDecision?.deferHardLock, false);
  setPlaylistContractV40Enabled(null);
});

test("sad party bangers world gate defer", () => {
  const prompt = "sad party bangers";
  const world = resolveCommittedWorld({ prompt });
  const contract = buildPlaylistContract({ prompt, committedWorld: world });
  const disagreements = compareContractWithWorld(contract, world);
  const gate = evaluateWorldGate({ contract, world, disagreements });
  assert.equal(gate.deferHardLock, true);
  assert.equal(gate.effectiveWorld?.hardLock, false);
});
