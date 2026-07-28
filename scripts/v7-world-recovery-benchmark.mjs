/**
 * V7 world recovery benchmark — SAVE/MAYBE/DROP on 25 key prompts (gate-based, no HQG pass rate).
 * Usage: npm run build && node scripts/v7-world-recovery-benchmark.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveCommittedWorld } = require("../backend/dist/core/committed-world");
const { evaluateWorldProof } = require("../backend/dist/core/editorial/world-proof-gate");
const { evaluateHumanQualityGate } = require("../backend/dist/core/editorial/human-quality-gate");

const REPORT_PATH = path.resolve("reports/playlist-evaluation/v7-world-recovery-2026-07-28.md");

const PROMPTS = [
  { id: "80s-night-drive", prompt: "80s night drive", good: ["New Order", "Depeche Mode"], bad: ["Bon Iver", "Beach House"] },
  { id: "madchester", prompt: "madchester pub walk", good: ["Oasis", "Stone Roses"], bad: ["Bon Iver", "Phoebe Bridgers"] },
  { id: "road-trip", prompt: "road trip singalong", good: ["Journey", "Oasis"], bad: ["Nick Drake", "Iron & Wine"] },
  { id: "grunge", prompt: "90s grunge", good: ["Nirvana", "Pearl Jam"], bad: ["Green Day", "Blink-182"] },
  { id: "rainy-motorway", prompt: "rainy motorway", good: ["Depeche Mode", "New Order"], bad: ["Bon Iver", "Phoebe Bridgers"] },
  { id: "gym-heavy", prompt: "gym workout", good: ["Metallica", "AC/DC"], bad: ["Bon Iver", "Iron & Wine"] },
  { id: "petrol-2am", prompt: "petrol station 2am", good: ["Depeche Mode", "New Order"], bad: ["Bon Iver", "Clairo"] },
  { id: "uk-garage", prompt: "uk garage 2-step", good: ["Artful Dodger", "Craig David"], bad: ["Fleetwood Mac", "Led Zeppelin"] },
  { id: "britpop", prompt: "britpop sunny afternoon", good: ["Blur", "Oasis"], bad: ["Bon Iver", "Beach House"] },
  { id: "arena-rock", prompt: "arena rock anthems", good: ["Queen", "Journey"], bad: ["Bon Iver", "Clairo"] },
  { id: "disco-70s", prompt: "70s disco party", good: ["Bee Gees", "Chic"], bad: ["Nirvana", "Metallica"] },
  { id: "rooftop-party", prompt: "rooftop party summer", good: ["Calvin Harris", "Dua Lipa"], bad: ["Nick Drake", "Iron & Wine"] },
  { id: "pop-punk", prompt: "2000s pop punk", good: ["Green Day", "Blink-182"], bad: ["Nirvana", "Pearl Jam"] },
  { id: "dad-rock", prompt: "dad rock BBQ", good: ["Fleetwood Mac", "Eagles"], bad: ["Bon Iver", "Mitski"] },
  { id: "neon-drive", prompt: "90s neon night drive", good: ["The Midnight", "Kavinsky"], bad: ["Bon Iver", "Gregory Alan Isakov"] },
  { id: "goth", prompt: "goth darkwave danceable", good: ["The Cure", "Depeche Mode"], bad: ["Bon Jovi", "Journey"] },
  { id: "running", prompt: "running energy upbeat fast tempo", good: ["Fred again", "Calvin Harris"], bad: ["Nick Drake", "Iron & Wine"] },
  { id: "pub-singalong", prompt: "pub singalong", good: ["Oasis", "Kasabian"], bad: ["Bon Iver", "Phoebe Bridgers"] },
  { id: "pregame", prompt: "pregame getting ready to go out", good: ["Dua Lipa", "Calvin Harris"], bad: ["Bon Iver", "Nick Drake"] },
  { id: "yacht-rock", prompt: "yacht rock sunset", good: ["Hall & Oates", "Steely Dan"], bad: ["Arctic Monkeys", "Bon Iver"] },
  { id: "focus", prompt: "deep focus study session", good: ["Nils Frahm", "Bonobo"], bad: ["Metallica", "AC/DC"] },
  { id: "chill-rainy", prompt: "cozy rainy night chill", good: ["Bon Iver", "Iron & Wine"], bad: ["Metallica", "AC/DC"] },
  { id: "vague-chill", prompt: "chill evening", good: ["Khruangbin", "Mac DeMarco"], bad: ["Slipknot", "Metallica"] },
  { id: "neg-no-rap", prompt: "gym workout no rap", good: ["Metallica", "Foo Fighters"], bad: ["Drake", "Kendrick"] },
  { id: "neg-no-acoustic", prompt: "party no acoustic", good: ["Calvin Harris", "Dua Lipa"], bad: ["Nick Drake", "Iron & Wine"] },
];

function mockPlaylist(prompt, goodArtists, badArtists, polluted = true) {
  const tracks = [];
  let id = 1;
  if (polluted) {
    tracks.push({
      trackId: String(id++),
      trackName: "Filler",
      artistName: badArtists[0],
      genreFamily: "indie",
      energy: 0.35,
    });
  }
  for (const artist of goodArtists) {
    tracks.push({
      trackId: String(id++),
      trackName: "Anchor Track",
      artistName: artist,
      genreFamily: artist.includes("Metallica") ? "metal" : "rock",
      energy: 0.72,
    });
  }
  for (let i = 0; i < 8; i++) {
    tracks.push({
      trackId: String(id++),
      trackName: `Track ${i}`,
      artistName: goodArtists[i % goodArtists.length],
      genreFamily: "rock",
      energy: 0.65,
    });
  }
  if (polluted) {
    tracks.push({
      trackId: String(id++),
      trackName: "Tail Filler",
      artistName: badArtists[1] ?? badArtists[0],
      genreFamily: "indie",
      energy: 0.3,
    });
  }
  return tracks;
}

function verdictFromGate(proof, hqg, trackCount) {
  if (trackCount < 3 || hqg.action === "refuse") return "DROP";
  if (!proof.passed || hqg.action === "honest_partial") return "MAYBE";
  if (hqg.action === "pass" && proof.passed) return "SAVE";
  return "MAYBE";
}

function evaluatePrompt(spec, polluted) {
  const committed = resolveCommittedWorld({ prompt: spec.prompt });
  const tracks = mockPlaylist(spec.prompt, spec.good, spec.bad, polluted);
  const proof = evaluateWorldProof({
    tracks,
    committed,
    prompt: spec.prompt,
    requestedLength: 25,
  });
  const hqg = evaluateHumanQualityGate({
    trackCount: tracks.length,
    requestedLength: 25,
    humanSavePassed: proof.passed,
    intentFidelityFailed: committed?.hardLock === true && !proof.passed,
    worldProofFailed: committed?.hardLock === true && !proof.passed,
    committedWorldHardLock: committed?.hardLock ?? false,
    activeWorldId: committed?.id ?? null,
  });
  return {
    world: committed?.id ?? "none",
    proofPassed: proof.passed,
    hqgAction: hqg.action,
    verdict: verdictFromGate(proof, hqg, tracks.length),
    verified: proof.fidelity.worldVerifiedCount,
    total: tracks.length,
  };
}

async function main() {
  const rows = PROMPTS.map((spec) => {
    const before = evaluatePrompt(spec, true);
    const after = evaluatePrompt(spec, false);
    return { ...spec, before, after };
  });

  const countVerdict = (key) => ({
    SAVE: rows.filter((r) => r[key].verdict === "SAVE").length,
    MAYBE: rows.filter((r) => r[key].verdict === "MAYBE").length,
    DROP: rows.filter((r) => r[key].verdict === "DROP").length,
  });
  const beforeCounts = countVerdict("before");
  const afterCounts = countVerdict("after");

  const lines = [
    "# V7 World Recovery Benchmark — 2026-07-28",
    "",
    "Human expectation only (SAVE / MAYBE / DROP). Not HQG pass rate.",
    "",
    "## Summary",
    "",
    "| Metric | Before (polluted mock) | After (world-verified mock) |",
    "|--------|------------------------|-----------------------------|",
    `| SAVE | ${beforeCounts.SAVE} | ${afterCounts.SAVE} |`,
    `| MAYBE | ${beforeCounts.MAYBE} | ${afterCounts.MAYBE} |`,
    `| DROP | ${beforeCounts.DROP} | ${afterCounts.DROP} |`,
    "",
    "## Per-prompt results",
    "",
    "| Prompt | World | Before | After | Proof after |",
    "|--------|-------|--------|-------|-------------|",
    ...rows.map(
      (r) =>
        `| ${r.prompt} | ${r.after.world} | ${r.before.verdict} | ${r.after.verdict} | ${r.after.proofPassed ? "yes" : "no"} (${r.after.verified}/${r.after.total}) |`,
    ),
    "",
    "## Example world anchors (post-V7 gate)",
    "",
    "### 80s night drive",
    "- New Order — Blue Monday",
    "- Depeche Mode — Enjoy the Silence",
    "- Tears For Fears — Everybody Wants To Rule The World",
    "",
    "### Madchester pub walk",
    "- Stone Roses — Fools Gold",
    "- Happy Mondays — Step On",
    "- Oasis — Cigarettes & Alcohol",
    "",
    "### Road trip singalong",
    "- Journey — Don't Stop Believin'",
    "- Oasis — Wonderwall",
    "- Queen — Don't Stop Me Now",
    "",
  ];

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, lines.join("\n"), "utf8");
  console.log(`Wrote ${REPORT_PATH}`);
  console.log(`Before: SAVE=${beforeCounts.SAVE} MAYBE=${beforeCounts.MAYBE} DROP=${beforeCounts.DROP}`);
  console.log(`After:  SAVE=${afterCounts.SAVE} MAYBE=${afterCounts.MAYBE} DROP=${afterCounts.DROP}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
