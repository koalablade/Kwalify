import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildLibraryTrackIdSet, enforceLibraryDeliveryPurity } from "../lib/library-delivery-guard";
import { buildLockedIntent } from "../core/v3/intent";
import { resolveCommittedWorld } from "../core/committed-world";
import { resolveCulturalProfileForCommitted } from "../core/editorial/world-identity-score";
import { enforceThesisOpener } from "../core/editorial/thesis-opener-gate";

const CONTROLLER = path.join(path.resolve(__dirname, "../../.."), "backend/controllers/generation.controller.ts");

type T = { trackId: string; trackName: string; artistName: string; albumName: string; releaseYear?: number | null; energy?: number | null; valence?: number | null; genreFamily?: string; genrePrimary?: string };

const library: T[] = ["Bon Iver", "Fleet Foxes", "Phoebe Bridgers", "Big Thief", "The National", "Novo Amor"].map((artistName, i) => ({
  trackId: `LIB_${i}`,
  trackName: `${artistName} song`,
  artistName,
  albumName: "Album",
  releaseYear: 2012,
  energy: 0.35,
  valence: 0.3,
  genreFamily: "indie",
  genrePrimary: "indie folk",
}));
const catalogue: T = { trackId: "CAT_m83", trackName: "Midnight City", artistName: "M83", albumName: "Hurry Up, We're Dreaming", releaseYear: 2011, energy: null, valence: null };
const libraryTrackIds = buildLibraryTrackIdSet(library);
const byTrackId = (t: T) => t.trackId;

test("library guard: all-library delivery is unchanged", () => {
  const out = enforceLibraryDeliveryPurity(library, { noLibraryMode: false, libraryTrackIds, getTrackId: byTrackId });
  assert.deepEqual(out.tracks.map(byTrackId), library.map(byTrackId));
  assert.equal(out.removed.length, 0);
  assert.equal(out.enforced, true);
});

test("library guard: catalogue track is removed in library mode", () => {
  const out = enforceLibraryDeliveryPurity([catalogue, ...library], { noLibraryMode: false, libraryTrackIds, getTrackId: byTrackId });
  assert.ok(!out.tracks.some((t) => t.trackId === catalogue.trackId));
  assert.deepEqual(out.removed.map(byTrackId), [catalogue.trackId]);
  assert.equal(out.tracks.length, library.length);
});

test("library guard: tracks without a verifiable id are rejected", () => {
  const out = enforceLibraryDeliveryPurity([{ ...library[0]!, trackId: "" }], { noLibraryMode: false, libraryTrackIds, getTrackId: byTrackId });
  assert.equal(out.tracks.length, 0);
});

test("library guard: discovery / no-library mode keeps catalogue tracks", () => {
  const out = enforceLibraryDeliveryPurity([catalogue, ...library], { noLibraryMode: true, libraryTrackIds, getTrackId: byTrackId });
  assert.equal(out.enforced, false);
  assert.equal(out.tracks.length, library.length + 1);
  assert.equal(out.tracks[0]!.trackId, catalogue.trackId);
});

test("library guard: catalogue track injected by the thesis-opener replacement path is removed", () => {
  // Real production path: a hard-locked world with a cultural profile lets
  // enforceThesisOpener promote an expansion (catalogue) track to position 1.
  const prompt = "night drive";
  const committed = resolveCommittedWorld({ prompt, lockedIntent: buildLockedIntent(prompt) });
  const profile = resolveCulturalProfileForCommitted(committed);
  assert.ok(committed?.hardLock && profile, "night drive should have a profiled hard-locked world");
  const thesis = enforceThesisOpener(library, profile, committed, [catalogue], 20, []);
  assert.ok(thesis.tracks.some((t) => t.trackId === catalogue.trackId), "precondition: catalogue track was injected");
  const out = enforceLibraryDeliveryPurity(thesis.tracks, { noLibraryMode: false, libraryTrackIds, getTrackId: byTrackId });
  assert.ok(out.tracks.every((t) => libraryTrackIds.has(t.trackId)));
  assert.ok(out.removed.some((t) => t.trackId === catalogue.trackId));
});

test("controller applies the library guard after all post-freeze mutations and before side effects", () => {
  const source = readFileSync(CONTROLLER, "utf8");
  const freeze = source.indexOf('pipelineAuthority.freezeTerminal("terminal_delivery")');
  const guard = source.indexOf("enforceLibraryDeliveryPurity(deliveredTracks");
  const apiGuard = source.indexOf("enforceLibraryDeliveryPurity(finalApiTracks");
  const sideEffects = source.indexOf("await runPostHygieneSideEffects();");
  const cacheWrite = source.indexOf("setCachedGenerateResult(resultCacheKey");
  assert.ok(freeze > 0 && guard > freeze && apiGuard > guard, "guard must follow freezeTerminal");
  assert.ok(sideEffects > apiGuard, "guard must precede Spotify/DB side effects");
  assert.ok(cacheWrite > sideEffects, "cache write must follow the guard");
  assert.equal(source.split("await runPostHygieneSideEffects();").length - 1, 1, "single side-effect call site");
  // No reassignment of the delivered payload between the guard and the side effects.
  const between = source.slice(apiGuard, sideEffects);
  const reassignments = between.match(/\b(?:deliveredTracks|finalApiTracks)\s*=(?!=)/g) ?? [];
  assert.deepEqual(reassignments.map((r) => r.replace(/\s+/g, "")), ["deliveredTracks=", "finalApiTracks="]);
});
