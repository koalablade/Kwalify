/**
 * Lightweight self-test for opener hygiene — fully inlined (no dist imports).
 */

const OPENER_FILLER_PATTERN =
  /\b(?:kasabian|q\s+lazzarus|tame\s+impala|glenn\s+frey|arctic\s+monkeys|the\s+weeknd)\b/i;

const ZERO_PSYCH_OPENER_WORLDS = new Set([
  "film_ending_world",
  "dad_secret_world",
  "older_sibling_world",
  "classic_rock_world",
  "goth_world",
  "focus_study_world",
  "coffee_soft_focus_world",
  "feel_good_world",
  "party_prep_world",
  "latin_summer_rooftop_world",
  "britpop_world",
  "grunge_world",
]);

function trackArtistName(track) {
  return String(track.artistName ?? track.artist ?? "").trim();
}

function maxPsychIndieOpenersForWorlds(activeWorldIds) {
  if (activeWorldIds.length === 0) return 1;
  if (activeWorldIds.some((id) => ZERO_PSYCH_OPENER_WORLDS.has(id))) return 0;
  return 1;
}

function sanitizePsychIndieOpenerChain(tracks, openerSlots = 3, maxOpeners = 1) {
  if (tracks.length <= openerSlots) return { tracks, demoted: [] };
  const out = tracks.slice();
  const demoted = [];
  const limit = Math.min(openerSlots, out.length);
  let demoteAttempts = 0;
  const maxDemoteAttempts = out.length * openerSlots;

  while (demoteAttempts < maxDemoteAttempts) {
    let fillerCount = 0;
    for (let j = 0; j < limit; j++) {
      const artist = trackArtistName(out[j]);
      if (artist && OPENER_FILLER_PATTERN.test(artist)) fillerCount += 1;
    }
    if (fillerCount <= maxOpeners) break;

    let demotedThisPass = false;
    if (maxOpeners <= 0) {
      for (let i = 0; i < limit; i++) {
        const artist = trackArtistName(out[i]);
        if (!artist || !OPENER_FILLER_PATTERN.test(artist)) continue;
        const [track] = out.splice(i, 1);
        if (track) {
          out.push(track);
          demoted.push({ artist: trackArtistName(track), fromIndex: i, toIndex: out.length - 1 });
        }
        demoteAttempts += 1;
        demotedThisPass = true;
        break;
      }
    } else {
      let allowed = 0;
      for (let i = 0; i < limit; i++) {
        const artist = trackArtistName(out[i]);
        if (!artist || !OPENER_FILLER_PATTERN.test(artist)) continue;
        allowed += 1;
        if (allowed > maxOpeners) {
          const [track] = out.splice(i, 1);
          if (track) {
            out.push(track);
            demoted.push({ artist: trackArtistName(track), fromIndex: i, toIndex: out.length - 1 });
          }
          demoteAttempts += 1;
          demotedThisPass = true;
          break;
        }
      }
    }
    if (!demotedThisPass) break;
  }
  return { tracks: out, demoted };
}

function countOpenerFillerPatternMatches(tracks, openerSlots = 3) {
  return tracks
    .slice(0, openerSlots)
    .filter((track) => {
      const artist = trackArtistName(track);
      return artist && OPENER_FILLER_PATTERN.test(artist);
    }).length;
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

assert(maxPsychIndieOpenersForWorlds(["film_ending_world"]) === 0, "film ending max 0");
assert(maxPsychIndieOpenersForWorlds(["dad_secret_world"]) === 0, "dad secret max 0");
assert(maxPsychIndieOpenersForWorlds(["indie_dream_world"]) === 1, "indie dream max 1");

const capped = sanitizePsychIndieOpenerChain(
  [
    { artist: "Tame Impala" },
    { artist: "Kasabian" },
    { artist: "Q Lazzarus" },
    { artist: "The Killers" },
    { artist: "Franz Ferdinand" },
  ],
  3,
  1,
);
assert(countOpenerFillerPatternMatches(capped.tracks, 3) === 1, "cap to one opener filler");
assert(!/kasabian|q lazzarus/i.test(String(capped.tracks[0].artist)), "first opener not kasabian/q");

const cleared = sanitizePsychIndieOpenerChain(
  [
    { artist: "Tame Impala" },
    { artist: "Kasabian" },
    { artist: "Q Lazzarus" },
    { artist: "Sigur Ros" },
    { artist: "Radiohead" },
    { artist: "Bon Iver" },
  ],
  3,
  0,
);
assert(countOpenerFillerPatternMatches(cleared.tracks, 3) === 0, "zero openers when max 0");
assert(!OPENER_FILLER_PATTERN.test(String(cleared.tracks[0].artist)), "first track not filler");

console.log("opener-hygiene selftest ok");
