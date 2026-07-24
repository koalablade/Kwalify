/**
 * Render HUMAN-CURATOR-REALITY-AUDIT.md from human-audit.json
 */
import { readFileSync, writeFileSync } from "fs";

const audits = JSON.parse(
  readFileSync("reports/live-spotify-verify/bench-100-test-2/human-audit.json", "utf8")
);

const ok = audits.filter((a) => a.ok);
const fails = audits.filter((a) => !a.ok);
const saves = {
  YES: ok.filter((a) => a.saveTest === "YES").length,
  MAYBE: ok.filter((a) => a.saveTest === "MAYBE").length,
  NO: ok.filter((a) => a.saveTest === "NO").length,
};
const levels = {
  1: ok.filter((a) => a.level === 1).length,
  2: ok.filter((a) => a.level === 2).length,
  3: ok.filter((a) => a.level === 3).length,
};
const feels = {};
for (const a of ok) feels[a.feels] = (feels[a.feels] || 0) + 1;
const worlds = { GOOD: 0, MIXED: 0, BAD: 0 };
for (const a of ok) worlds[a.musicalWorld.verdict] = (worlds[a.musicalWorld.verdict] || 0) + 1;

const savePct = Math.round((saves.YES / ok.length) * 100);
const maybePct = Math.round((saves.MAYBE / ok.length) * 100);
const replayYes = ok.filter((a) => a.replayTest === "YES").length;
const replayPct = Math.round((replayYes / ok.length) * 100);
const humanish = ok.filter((a) => a.feels === "human" || a.feels === "mostly_human").length;
const algo = ok.filter((a) => a.feels === "algorithmic" || a.feels === "broken").length;

const genuinelyHuman = ok.filter((a) => a.feels === "human").map((a) => a.id);
const algorithmic = ok.filter((a) => a.feels === "algorithmic" || a.feels === "broken").map((a) => `${a.id} (${a.prompt})`);
const libLimits = ok.filter((a) => a.underfill?.library).map((a) => a.id);
const retrieval = ok.filter((a) => a.underfill?.kind === "retrieval_failure").map((a) => a.id);

const lines = [];
const w = (s = "") => lines.push(s);

w("# Kwalify — Human Curator Reality Audit");
w("");
w("**Source:** bench-100-test-2 live Spotify creates (`test 2 · …`)  ");
w("**Method:** Listening-first. Tracks are the source of truth. Benchmark energy/genre-hit % ignored when music disagrees.  ");
w("**Standard:** Would I believe a real person made this — and keep listening?");
w("");
w("---");
w("");
w("## Final Verdict (brutal)");
w("");
w(`1. **vs average Spotify users:** Slightly above on a good day, below on many niche prompts. ~${levels[1]} of ${ok.length} delivered playlists land at Level 1 (messy favourites).`);
w(`2. **vs experienced curators:** Clearly below. Only ~${levels[2]} feel Level 2. **Zero** playlists feel Spotify Editorial (Level 3).`);
w("3. **vs Spotify Editorial:** Not competitive. Editorial has inevitable sequencing and zero random world-breaks. Kwalify still inserts Cash into gym, Marley into goth, Bon Iver into boss fights.");
w(`4. **Would people genuinely save:** ~**${savePct}%** solid YES (${saves.YES}/${ok.length}). Another ~**${maybePct}%** MAYBE. Roughly **${100 - savePct - maybePct}%** NO.`);
w(`5. **Would people replay:** ~**${replayPct}%** YES replay. Many YES-saves are still one-listen curiosities.`);
w(`6. **Genuinely human:** ${genuinelyHuman.join(", ") || "none"}`);
w(`7. **Still feel algorithmic/broken:** ${algo}/${ok.length} — including goth, lofi, boss fight, grunge, quiet rage, melancholy drive, introvert party.`);
w("8. **Prompts that consistently expose weakness:** niche genre identity (goth/lofi/grunge/ambient), contradictory tones, scene authenticity (boss fight, rave comedown when padded), \"quiet X\" prompts that become loud artist radio.");
w(`9. **Impossible without larger library:** ${libLimits.join(", ") || "—"} (honest thin metal/christmas/comedown/70s rock partial). Also HQG refuses on neon-tek / winter non-christmas / empty xmas pool.`);
w("10. **Launch today for music enthusiasts?** **Not yet as a save-first product.** Enthusiasts would use it as a noisy sketchpad, then rebuild. Average users might keep ~1 in 4. Power users would churn after goth→reggae and boss-fight→Bon Iver moments.");
w("");
w("---");
w("");
w("## Snapshot");
w("");
w(`| Metric | Value |`);
w(`|---|---:|`);
w(`| Playlists reviewed | ${audits.length} |`);
w(`| Created on Spotify | ${ok.length} |`);
w(`| Failed / no tracks | ${fails.length} |`);
w(`| Level 1 / 2 / 3 | ${levels[1]} / ${levels[2]} / ${levels[3]} |`);
w(`| World GOOD / MIXED / BAD | ${worlds.GOOD} / ${worlds.MIXED} / ${worlds.BAD} |`);
w(`| Save YES / MAYBE / NO | ${saves.YES} / ${saves.MAYBE} / ${saves.NO} |`);
w(`| Feels human / mostly / algo / broken | ${feels.human || 0} / ${feels.mostly_human || 0} / ${feels.algorithmic || 0} / ${feels.broken || 0} |`);
w("");
w("---");
w("");
w("## Highest ROI (listener satisfaction only)");
w("");
w("### Engineering (code/model)");
w("");
w("| Impact | Finding | Why listeners care |");
w("|---|---|---|");
w("| ★★★★★ | Musical world lock | Goth→reggae, lofi→Journey, quiet rage→disco are instant unfollow moments |");
w("| ★★★★★ | Scene prototypes (boss fight, comedown, neon tek) | Scene prompts are the product demo — currently embarrassing |");
w("| ★★★★★ | Stop keyword/title bait | \"Ruin\", \"Slow\", \"Goth\", \"Bedroom\" matching destroys identity |");
w("| ★★★★☆ | Ending curator | Soft playlists die on Def Leppard / Heart of Glass×3 endings |");
w("| ★★★★☆ | Artist-radio damping mid-playlist | Paramore×3, Amy×3, Sabbath×4 feel algorithmic |");
w("| ★★★☆☆ | Ops supersede cancellations | 8 playlists never existed — trust & coverage loss |");
w("| ★★☆☆☆ | Energy tuning alone | Secondary; world coherence matters more |");
w("");
w("### Library (not code)");
w("");
w("| Impact | Finding |");
w("|---|---|");
w("| ★★★★★ | Expand metal / christmas / true goth / ambient / 90s R&B coverage |");
w("| ★★★★☆ | Keep honest underfill — never pad to 30 |");
w("| ★★★☆☆ | Discovery Mode for niches user library cannot support |");
w("");
w(`**Retrieval failures (library likely has better songs):** ${retrieval.join(", ") || "—"}`);
w("");
w(`**Honest library limits (do not \"fix\" by padding):** ${libLimits.join(", ") || "—"}`);
w("");
w("---");
w("");
w("## Failures (no playlist)");
w("");
for (const f of fails) {
  w(`### ${f.id}`);
  w(`- **Prompt:** ${f.prompt}`);
  w(`- **Human expectation:** ${f.humanExpectation}`);
  w(`- **Failure kind:** ${f.failureKind}${f.libraryLimitation ? " (library/niche limitation)" : ""}`);
  w(`- **Notes:** ${f.failureNotes}`);
  w(`- **Save:** NO`);
  w("");
}

w("---");
w("");
w("## Every playlist (listening audit)");
w("");

for (const a of ok) {
  w(`### ${a.id}`);
  w("");
  w(`**Prompt:** ${a.prompt}`);
  w("");
  w(`**Human expectation:** ${a.humanExpectation}`);
  w("");
  w(`**Musical world:** ${a.musicalWorld.verdict} — ${a.musicalWorld.world}`);
  w("");
  w(`${a.musicalWorld.notes}`);
  w("");
  w(`| | |`);
  w(`|---|---|`);
  w(`| Level | ${a.level} (${a.level === 1 ? "avg user" : a.level === 2 ? "experienced fan" : "Editorial"}) |`);
  w(`| Save | **${a.saveTest}** |`);
  w(`| Replay | ${a.replayTest} |`);
  w(`| Feels | ${a.feels} |`);
  w(`| Flow | ${a.editorialFlow.storyOrShuffle} |`);
  w(`| Scene authentic | ${a.sceneAuthenticity ? "yes" : "no"} |`);
  w(`| vs Spotify (${a.spotifyComparison.equivalent}) | ${a.spotifyComparison.vsKwalify} |`);
  w(`| Underfill | ${a.underfill.kind}${a.underfill.library ? " · library limit" : ""} |`);
  w(`| Spotify | ${a.url ? `[open](${a.url})` : "—"} |`);
  w(`| Song mix | P${a.songCounts.PERFECT} / B${a.songCounts.BELONGS} / Q${a.songCounts.QUESTIONABLE} / R${a.songCounts.REMOVE} |`);
  w("");
  w("| # | Track | Artist | Class | Why |");
  w("|---:|---|---|---|---|");
  for (const s of a.songs) {
    const why = s.why ? s.why.replace(/\|/g, "/") : "—";
    w(`| ${s.index} | ${s.track || "—"} | ${s.artist || "—"} | ${s.class} | ${why} |`);
  }
  w("");
}

w("---");
w("");
w("## Method notes");
w("");
w("- Song classes: PERFECT / BELONGS / QUESTIONABLE / REMOVE.");
w("- Metadata genre labels were ignored when listening disagreed (e.g. electronic that is actually ambient-capable).");
w("- Honest thin niche playlists were not punished for length when the songs fit.");
w("- Cancelled generations counted as ops failures, not curation failures.");
w("");

writeFileSync(
  "reports/live-spotify-verify/bench-100-test-2/HUMAN-CURATOR-REALITY-AUDIT.md",
  lines.join("\n")
);
console.log("wrote HUMAN-CURATOR-REALITY-AUDIT.md", lines.length, "lines");
console.log({ saves, levels, worlds, feels, savePct, replayPct });
