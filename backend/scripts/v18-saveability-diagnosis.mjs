/**
 * V18 saveability diagnosis — read-only counterfactual analysis.
 * Does NOT modify generator or evaluator production code.
 *
 * Usage: node backend/scripts/v18-saveability-diagnosis.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const OUT = resolve(ROOT, "reports/playlist-evaluation/v18-saveability-diagnosis.json");

/** Frozen V18 live benchmark deliveries (2026-08-11). */
const LIVE_PLAYLISTS = [
  {
    id: "country_cowboy",
    prompt: "country cowboy road trip",
    tracks: [
      { artistName: "Johnny Cash", trackName: "Jackson" },
      { artistName: "Luke Combs", trackName: "Beautiful Crazy" },
      { artistName: "Zach Bryan", trackName: "Oklahoma Smokeshow" },
      { artistName: "Johnny Cash", trackName: "Ring of Fire" },
      { artistName: "Zach Bryan", trackName: "Pink Skies" },
      { artistName: "Zach Bryan", trackName: "Condemned" },
      { artistName: "Morgan Wallen", trackName: "Livin' The Dream" },
      { artistName: "Waylon Jennings", trackName: "Mamas Don't Let Your Babies Grow up to Be Cowboys" },
    ],
  },
  {
    id: "dad_rock_bbq",
    prompt: "dad rock BBQ with beers",
    tracks: [
      { artistName: "AC/DC", trackName: "T.N.T." },
      { artistName: "AC/DC", trackName: "Back In Black" },
      { artistName: "Fleetwood Mac", trackName: "Silver Springs - 2004 Remaster" },
      { artistName: "AC/DC", trackName: "It's a Long Way to the Top (If You Wanna Rock 'N' Roll)" },
      { artistName: "Fleetwood Mac", trackName: "Hypnotized" },
      { artistName: "Tom Petty and the Heartbreakers", trackName: "Breakdown - Remastered" },
      { artistName: "Tom Petty and the Heartbreakers", trackName: "Into The Great Wide Open" },
      { artistName: "Led Zeppelin", trackName: "Stairway to Heaven - 1990 Remaster" },
      { artistName: "Led Zeppelin", trackName: "Tangerine - Remaster" },
    ],
  },
  {
    id: "motorway_rain",
    prompt: "empty motorway at midnight rain on the windscreen",
    tracks: [
      { artistName: "New Order", trackName: "Blue Monday '88" },
      { artistName: "The Cure", trackName: "The Lovecats" },
      { artistName: "The Cure", trackName: "Boys Don't Cry" },
      { artistName: "Tears For Fears", trackName: "Head Over Heels" },
    ],
  },
  {
    id: "gym",
    prompt: "heavy gym workout aggressive",
    tracks: [
      { artistName: "AC/DC", trackName: "Back In Black" },
      { artistName: "AC/DC", trackName: "T.N.T." },
      { artistName: "Guns N' Roses", trackName: "Welcome To The Jungle" },
    ],
  },
  {
    id: "no_rap_gym",
    prompt: "no rap gym workout",
    tracks: [
      { artistName: "Black Sabbath", trackName: "Rat Salad" },
      { artistName: "Black Sabbath", trackName: "Paranoid" },
      { artistName: "Iron Maiden", trackName: "Fear of the Dark" },
      { artistName: "Nirvana", trackName: "In Bloom" },
      { artistName: "Black Sabbath", trackName: "Iron Man" },
    ],
  },
  {
    id: "madchester",
    prompt: "madchester pub walk",
    tracks: [
      { artistName: "The Stone Roses", trackName: "Made of Stone - Remastered 2009" },
      { artistName: "Oasis", trackName: "Wonderwall" },
      { artistName: "Oasis", trackName: "Champagne Supernova" },
      { artistName: "Blur", trackName: "Song 2 - 2012 Remaster" },
    ],
  },
  {
    id: "disco",
    prompt: "disco rooftop party 1978",
    tracks: [
      { artistName: "Michael Jackson", trackName: "Rock with You - Single Version" },
      { artistName: "ABBA", trackName: "Gimme! Gimme! Gimme! (A Man After Midnight)" },
    ],
  },
  {
    id: "80s_night_drive",
    prompt: "80s night drive",
    tracks: [
      { artistName: "The Cure", trackName: "The Lovecats" },
      { artistName: "Tears For Fears", trackName: "Everybody Wants To Rule The World" },
      { artistName: "Tears For Fears", trackName: "Head Over Heels - Dave Bascombe 7\" N.Mix" },
      { artistName: "Gary Numan", trackName: "Cars" },
      { artistName: "The Human League", trackName: "Don't You Want Me" },
      { artistName: "Tears For Fears", trackName: "Head Over Heels" },
      { artistName: "Pet Shop Boys", trackName: "West End Girls - 2001 Remaster" },
    ],
  },
];

function classifyTrack(track, prompt, position, total) {
  const title = String(track.trackName ?? "").toLowerCase();
  const artist = String(track.artistName ?? "").toLowerCase();
  const p = prompt.toLowerCase();

  if (/\b(?:rat\s+salad|stairway)\b/.test(title)) return "D";
  if (p.includes("gym") && /\b(?:don'?t\s+cry|sweet\s+child)\b/.test(title)) return "D";
  if (p.includes("motorway") && /\bshout\b/.test(title)) return "D";
  if (p.includes("bbq") && /\bstairway\b/.test(title)) return "C";
  if (p.includes("madchester") && artist.includes("blur")) return "C";
  if (p.includes("80s") && artist.includes("tears for fears") && title.includes("head over heels") && position >= 2) {
    return "C";
  }
  if (p.includes("country") && title.includes("condemned")) return "C";
  if (p.includes("disco") && total <= 2) return "A";

  if (/\b(?:back in black|t\.?n\.?t|welcome to the jungle|iron man|paranoid|wonderwall|rock with you|gimme! gimme!)\b/.test(title)) {
    return "A";
  }
  if (/\b(?:johnny cash|waylon|stone roses|blue monday|lovecats|everybody wants)\b/.test(`${title} ${artist}`)) {
    return "A";
  }
  return "B";
}

async function main() {
  const { evaluateHumanCurationScore } = await import("../dist/core/editorial/human-curation-score.js");
  const { scoreTrackWorldIdentity, resolveCulturalProfileForCommitted } = await import(
    "../dist/core/editorial/world-identity-score.js",
  );
  const { resolveCommittedWorld } = await import("../dist/core/committed-world.js");
  const {
    isObscureDeepCutOpener,
    guardDeepCutOpener,
    inferHumanCurationActivity,
    scorePositionFit,
  } = await import("../dist/core/editorial/human-curation-sequencer.js");
  const { momentRejectSeverity } = await import("../dist/core/editorial/song-moment-fit.js");

  const results = [];

  for (const pl of LIVE_PLAYLISTS) {
    const base = evaluateHumanCurationScore(pl.prompt, pl.tracks);
    const committed = resolveCommittedWorld({ prompt: pl.prompt });
    const profile = resolveCulturalProfileForCommitted(committed);
    const activity = inferHumanCurationActivity(pl.prompt);
    const momentActivity =
      activity === "gym"
        ? "gym"
        : activity === "bbq"
          ? "bbq"
          : activity === "motorway"
            ? "motorway_rain"
            : activity === "disco"
              ? "disco"
              : activity === "madchester"
                ? "madchester"
                : activity === "country"
                  ? "country"
                  : activity === "night_drive"
                    ? "night_drive"
                    : null;

    const songAudit = pl.tracks.map((t, i) => {
      const world = profile ? scoreTrackWorldIdentity(t, profile) : null;
      return {
        position: i + 1,
        artist: t.artistName,
        title: t.trackName,
        grade: classifyTrack(t, pl.prompt, i, pl.tracks.length),
        worldIdentity: world != null ? Math.round(world * 1000) / 1000 : null,
        positionFit: Math.round(scorePositionFit(t, i, pl.tracks.length, activity) * 1000) / 1000,
        rejectSeverity: momentRejectSeverity(t, momentActivity, i, pl.tracks.length),
        obscureOpener: i === 0 ? isObscureDeepCutOpener(t, 0) : false,
      };
    });

    const counterfactuals = {};
    const weakestIdx = base.trackDiagnostics.reduce(
      (min, d, i) => (d.contribution < base.trackDiagnostics[min].contribution ? i : min),
      0,
    );
    counterfactuals.removeWeakest = {
      removed: `${pl.tracks[weakestIdx].artistName} — ${pl.tracks[weakestIdx].trackName}`,
      ...evaluateHumanCurationScore(pl.prompt, pl.tracks.filter((_, i) => i !== weakestIdx)),
    };

    const guarded = guardDeepCutOpener(pl.tracks, activity, false);
    counterfactuals.guardDeepCutOpener = {
      swapped: guarded.swapped,
      newOpener: guarded.tracks[0]
        ? `${guarded.tracks[0].artistName} — ${guarded.tracks[0].trackName}`
        : null,
      score: evaluateHumanCurationScore(pl.prompt, guarded.tracks),
    };

    if (pl.id === "no_rap_gym") {
      const reordered = pl.tracks.slice();
      const ironIdx = reordered.findIndex((t) => /iron man/i.test(t.trackName));
      if (ironIdx > 0) {
        const iron = reordered.splice(ironIdx, 1)[0];
        reordered.unshift(iron);
        counterfactuals.ironManOpener = evaluateHumanCurationScore(pl.prompt, reordered);
      }
    }

    if (pl.tracks.length > 1) {
      counterfactuals.removeFinal = evaluateHumanCurationScore(pl.prompt, pl.tracks.slice(0, -1));
    }

    const blockedByLength = base.totalScore >= 80 && pl.tracks.length < 8;
    const saveIfNoLengthGate =
      base.totalScore >= 80 ? "YES" : base.totalScore >= 60 ? "MAYBE" : "NO";

    results.push({
      id: pl.id,
      prompt: pl.prompt,
      trackCount: pl.tracks.length,
      hcs: base.totalScore,
      dimensions: base.dimensions,
      verdicts: {
        wouldPressPlay: base.wouldPressPlay,
        wouldSave: base.wouldSave,
        wouldShare: base.wouldShare,
      },
      saveGate: { blockedByLength, saveIfNoLengthGate },
      songAudit,
      gradeCounts: songAudit.reduce((acc, s) => {
        acc[s.grade] = (acc[s.grade] ?? 0) + 1;
        return acc;
      }, {}),
      counterfactuals,
    });
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  console.log(`Wrote ${OUT}`);
  for (const r of results) {
    console.log(
      `${r.id}: HCS=${r.hcs} Save=${r.verdicts.wouldSave} blockedByLength=${r.saveGate.blockedByLength} grades=${JSON.stringify(r.gradeCounts)}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
