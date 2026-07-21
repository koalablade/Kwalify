/**
 * Human Curator Reality Audit generator (listening-first).
 * Judgments encoded from full tracklist review of bench-100-test-2.
 */
import { readFileSync, writeFileSync } from "fs";

const playlists = JSON.parse(
  readFileSync("reports/live-spotify-verify/bench-100-test-2/audit-compact.json", "utf8")
);

/** @type {Record<string, any>} */
const J = JSON.parse(readFileSync("reports/live-spotify-verify/bench-100-test-2/human-judgments.json", "utf8"));

function classSong(p, t, j) {
  const name = String(t.t || "").toLowerCase();
  const artist = String(t.a || "").toLowerCase();
  const both = `${name} ${artist}`;
  let cls = "BELONGS";
  let why = null;
  const remove = (w) => {
    cls = "REMOVE";
    why = w;
  };
  const quest = (w) => {
    cls = "QUESTIONABLE";
    why = w;
  };
  const perfect = () => {
    cls = "PERFECT";
    why = null;
  };

  const xmasOk = /xmas|christmas/i.test(p.prompt);
  if (!xmasOk && /(christmas|xmas|jingle|sleigh|santa|\bnoel\b|silent night)/i.test(both)) {
    remove("Seasonal Christmas leakage");
  }

  const rules = j.songRules || [];
  for (const rule of rules) {
    if (rule.match && new RegExp(rule.match, "i").test(both)) {
      if (rule.class === "PERFECT") perfect();
      else if (rule.class === "REMOVE") remove(rule.why || "Wrong for this playlist");
      else if (rule.class === "QUESTIONABLE") quest(rule.why || "Questionable fit");
      break;
    }
  }

  if (j.world === "BAD" && cls === "BELONGS") {
    quest("World already broken — song cannot restore identity alone");
  }
  if (j.world === "GOOD" && cls === "BELONGS" && t.i <= 3) perfect();

  return { index: t.i, track: t.t, artist: t.a, year: t.y, class: cls, why };
}

const audits = [];
for (const p of playlists) {
  if (!p.ok) {
    const f = J.fails[p.id] || {
      kind: "ops_bug",
      expect: "—",
      note: p.err,
      lib: false,
    };
    audits.push({
      id: p.id,
      prompt: p.prompt,
      ok: false,
      humanExpectation: f.expect,
      failureKind: f.kind,
      failureNotes: f.note,
      libraryLimitation: !!f.lib,
      saveTest: "NO",
      feels: "broken",
      songs: [],
      level: null,
      url: null,
    });
    continue;
  }
  const j = J.ok[p.id] || {
    level: 1,
    save: "NO",
    replay: "NO",
    feels: "algorithmic",
    world: "MIXED",
    worldName: "unclear",
    story: "shuffle",
    expect: "(see prompt)",
    scene: false,
    notes: "Default cautious judgment.",
    equiv: "—",
    vs: "Worse",
    under: "none",
    lib: false,
    songRules: [],
  };
  const songs = p.tracks.map((t) => classSong(p, t, j));
  const songCounts = { PERFECT: 0, BELONGS: 0, QUESTIONABLE: 0, REMOVE: 0 };
  for (const s of songs) songCounts[s.class] += 1;
  audits.push({
    id: p.id,
    prompt: p.prompt,
    cat: p.cat,
    ok: true,
    n: p.n,
    req: p.req,
    url: p.url,
    name: p.name,
    humanExpectation: j.expect,
    musicalWorld: { verdict: j.world, world: j.worldName, notes: j.notes },
    level: j.level,
    songs,
    songCounts,
    editorialFlow: { storyOrShuffle: j.story },
    sceneAuthenticity: !!j.scene,
    saveTest: j.save,
    replayTest: j.replay,
    feels: j.feels,
    spotifyComparison: { equivalent: j.equiv, vsKwalify: j.vs },
    underfill: { kind: j.under, library: !!j.lib },
    weaknesses: j.notes ? [j.notes] : [],
  });
}

writeFileSync(
  "reports/live-spotify-verify/bench-100-test-2/human-audit.json",
  JSON.stringify(audits, null, 2)
);

const okA = audits.filter((a) => a.ok);
const summary = {
  n: audits.length,
  ok: okA.length,
  fails: audits.length - okA.length,
  saves: {
    YES: okA.filter((a) => a.saveTest === "YES").length,
    MAYBE: okA.filter((a) => a.saveTest === "MAYBE").length,
    NO: okA.filter((a) => a.saveTest === "NO").length,
  },
  levels: {
    1: okA.filter((a) => a.level === 1).length,
    2: okA.filter((a) => a.level === 2).length,
    3: okA.filter((a) => a.level === 3).length,
  },
  feels: {},
};
for (const a of okA) summary.feels[a.feels] = (summary.feels[a.feels] || 0) + 1;
console.log(JSON.stringify(summary, null, 2));
