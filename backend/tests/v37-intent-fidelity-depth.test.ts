import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCommittedWorld } from "../core/committed-world";
import {
  evaluateIntentFidelity,
  resolveFidelityDeliveryCap,
  selectIntentFidelityHonestPartialTracks,
} from "../core/editorial/intent-fidelity-gate";
import { filterTracksByWorldIdentity } from "../core/editorial/world-proof-gate";

describe("V37 intent fidelity depth cap", () => {
  it("resolveFidelityDeliveryCap delivers full verified depth when most tracks belong", () => {
    const cap = resolveFidelityDeliveryCap({
      requestedLength: 25,
      verifiedCount: 20,
      trackCount: 25,
      openerPassed: true,
      fidelityScore: 0.72,
      honestPartialCap: 10,
    });
    assert.equal(cap, 20);
  });

  it("resolveFidelityDeliveryCap keeps 40% stub when opener fails", () => {
    const cap = resolveFidelityDeliveryCap({
      requestedLength: 25,
      verifiedCount: 20,
      trackCount: 25,
      openerPassed: false,
      fidelityScore: 0.72,
      honestPartialCap: 10,
    });
    assert.equal(cap, 10);
  });

  it("filterTracksByWorldIdentity uses deliveryCap not 40% stub when depth validated", () => {
    const committed = resolveCommittedWorld({ prompt: "feel-good soul" })!;
    const tracks = Array.from({ length: 25 }, (_, i) => ({
      trackId: `t${i}`,
      trackName: `Track ${i}`,
      artistName: i % 5 === 0 ? "Marvin Gaye" : `Soul Artist ${i}`,
      genreFamily: "soul",
      genrePrimary: "soul",
      energy: 0.65,
      valence: 0.7,
    }));
    const result = evaluateIntentFidelity({
      committed,
      prompt: "feel-good soul",
      requestedLength: 25,
      tracks,
    });
    assert.ok(result.deliveryCap >= 13, `expected depth cap >=13, got ${result.deliveryCap}`);
    const filtered = filterTracksByWorldIdentity(tracks, result, committed);
    assert.ok(filtered.length >= 13, `expected >=13 tracks, got ${filtered.length}`);
  });

  it("honest partial still strips off-world opener on hard lock", () => {
    const committed = resolveCommittedWorld({ prompt: "dad rock" })!;
    const tracks = [
      { trackId: "1", trackName: "Holocene", artistName: "Bon Iver", genreFamily: "indie", energy: 0.3 },
      { trackId: "2", trackName: "Don't Stop Believin'", artistName: "Journey", genreFamily: "rock", energy: 0.7 },
      { trackId: "3", trackName: "Sweet Child O' Mine", artistName: "Guns N' Roses", genreFamily: "rock", energy: 0.75 },
      { trackId: "4", trackName: "Back in Black", artistName: "AC/DC", genreFamily: "rock", energy: 0.8 },
      { trackId: "5", trackName: "Livin' on a Prayer", artistName: "Bon Jovi", genreFamily: "rock", energy: 0.78 },
    ];
    const result = evaluateIntentFidelity({
      committed,
      prompt: "dad rock",
      requestedLength: 25,
      tracks,
    });
    const salvaged = selectIntentFidelityHonestPartialTracks(tracks, result, committed);
    assert.ok(!salvaged.some((t) => /bon iver/i.test(t.artistName ?? "")));
    assert.ok(salvaged.length <= result.deliveryCap);
  });
});
