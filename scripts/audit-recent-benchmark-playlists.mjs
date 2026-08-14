#!/usr/bin/env node
/**
 * One-off audit: recent human-keep-live runs + kwalify-api generate_complete logs.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const ROOT = path.resolve(import.meta.dirname, "..");

const EXPECTED_BY_FAMILY = {
  chill: "Soft Sunday / coffee — acoustic, folk, gentle indie, low energy",
  social: "Dinner with friends — warm pop, soul, funk, singalong, not solo acoustic",
  walk: "Morning walk upbeat — daylight pop, indie, light dance, not bedroom slowcore",
  gym: "Gym pump — high energy rock/rap/EDM, no ballads or folk",
  drive: "Night drive — cinematic indie, synth, post-rock, motorway mood",
  rain_drive: "Rain on glass night drive — melancholic indie, no arena rock",
  rain_chill: "Cozy rainy night — soft indie/folk, intimate",
  focus: "Study focus — instrumental, lo-fi, ambient, minimal lyrics",
  disco: "70s disco party — Bee Gees, Chic, Donna Summer, dance funk",
  pop_punk: "2000s pop punk gym — Paramore, FOB, Jimmy Eat World",
  metal: "Metal gym — heavy, no ballads or folk",
  goth: "Goth/post-punk darkwave — The Cure, not classic rock",
  grunge: "90s grunge — Nirvana-adjacent, not disco",
  neon: "90s neon night — synthwave, synth-pop, retrowave",
  classic_rock: "Classic/dad rock — 70s-80s rock staples",
  country: "Country/Americana — outlaw, red dirt",
  uk: "UKG grime garage — UK bass culture",
  dnb: "Drum and bass gym — high BPM bass",
  britpop: "Britpop sunny — Oasis, Blur, 90s UK guitar",
  soul: "Soul/gospel Sunday — soul, R&B warmth",
  jazz: "Jazz reading — instrumental jazz, not dinner cliché",
  hyperpop: "Hyperpop chaos — glitchy pop energy",
  emo: "Grown-up emo — indie emo, not cringe",
  latin: "Latin summer rooftop — reggaeton/latin pop",
  ambient: "Ambient floaty — Boards of Canada style",
  lofi: "Lofi study — beats, chillhop",
  vague: "Match the emotional sentence literally",
  mood: "Match the feeling in the sentence",
  scene: "Cinematic scene match",
  party: "Party energy appropriate to prompt",
  contradiction: "Hold both sides of the contradiction honestly",
  negation: "Respect hard negations (e.g. no christmas)",
  nostalgia: "Era-specific nostalgia world",
  comedown: "Post-rave soft electronic comedown",
  chore: "Task-appropriate energy (IKEA, cleaning)",
  cinematic: "Film-score cinematic arc",
  indie: "Indie reference world (e.g. Phoebe Bridgers)",
};

const LANDFILL_ARTISTS =
  /\b(bon\s+iver|clairo|phoebe\s+bridgers|sufjan|mitski|beach\s+house|tame\s+impala|arctic\s+monkeys|dayglow|noah\s+kahan|sam\s+fender|gregory\s+alan\s+isakov|slow\s+pulp|badbadnotgood)\b/i;

const ACOUSTIC_HEAVY = /\b(acoustic|unplugged|live\s+acoustic|stripped)\b/i;

function loadJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function topGenreFamilies(tracks) {
  const counts = new Map();
  for (const t of tracks) {
    const f = (t.genreFamily || "unknown").toLowerCase();
    counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
}

function acousticShare(tracks) {
  if (!tracks.length) return 0;
  let n = 0;
  for (const t of tracks) {
    if (ACOUSTIC_HEAVY.test(`${t.title} ${t.artist}`)) n++;
  }
  return n / tracks.length;
}

function landfillHits(tracks) {
  const hits = [];
  for (const t of tracks) {
    if (LANDFILL_ARTISTS.test(t.artist)) hits.push(`${t.artist} — ${t.title}`);
  }
  return hits;
}

function humanRealityVerdict(row) {
  const issues = [];
  const fill = row.length > 0 ? row.tracks.length / row.length : 0;
  const families = topGenreFamilies(row.tracks);
  const acoustic = acousticShare(row.tracks);
  const landfill = landfillHits(row.tracks);
  const expected = EXPECTED_BY_FAMILY[row.family] || `Scene family: ${row.family}`;

  if (fill < 0.6) issues.push(`severe underfill (${row.tracks.length}/${row.length})`);
  else if (fill < 0.9) issues.push(`underfilled (${row.tracks.length}/${row.length})`);

  if (acoustic >= 0.45 && !/chill|acoustic|folk|sunday/i.test(row.prompt)) {
    issues.push(`acoustic overload (${Math.round(acoustic * 100)}% acoustic-titled tracks)`);
  }

  if (landfill.length >= 3 && !/indie|shoegaze|rain|chill|bridgers|dream/i.test(row.prompt)) {
    issues.push(`landfill indie cluster (${landfill.length} usual-suspect artists)`);
  }

  const dominant = families[0]?.[0];
  if (row.family === "gym" && dominant === "folk") issues.push("gym prompt dominated by folk");
  if (row.family === "disco" && dominant === "rock") issues.push("disco prompt dominated by rock");
  if (row.family === "pop_punk" && fill < 0.5) issues.push("pop punk barely delivered");
  if (row.family === "classic_rock" && dominant === "indie") issues.push("rock prompt delivered as indie");
  if (row.family === "drive" && acoustic >= 0.35) issues.push("drive prompt too acoustic/slow");
  if (row.family === "neon" && dominant === "folk") issues.push("neon/synth prompt got folk");
  if (row.family === "metal" && dominant === "indie") issues.push("metal prompt got indie");
  if (row.family === "latin" && row.tracks.length === 0) issues.push("honest empty (good UX)");

  // Genre tag lies: everything tagged indie
  const indieTagged = row.tracks.filter((t) => t.genreFamily === "indie").length;
  if (row.tracks.length >= 10 && indieTagged / row.tracks.length > 0.85) {
    issues.push(`metadata collapse (${indieTagged}/${row.tracks.length} tagged indie)`);
  }

  let humanVerdict = "SAVE";
  if (row.tracks.length === 0 && row.httpStatus === 422) humanVerdict = "REFUSE_OK";
  else if (issues.some((i) => i.startsWith("severe"))) humanVerdict = "SKIP";
  else if (issues.length >= 2 || issues.some((i) => i.includes("dominated") || i.includes("delivered as"))) {
    humanVerdict = "SKIP";
  } else if (issues.length === 1) humanVerdict = "MAYBE";
  else if (fill < 0.9) humanVerdict = "PARTIAL_OK";

  if (row.judgment?.verdict === "SAVE" && (humanVerdict === "SKIP" || humanVerdict === "MAYBE")) {
    issues.push(`BENCHMARK LIE: auto-judge said SAVE`);
  }

  return { expected, issues, humanVerdict, families, acoustic, landfill: landfill.slice(0, 5) };
}

async function parseApiLog(logPath) {
  const stats = {
    generateComplete: 0,
    auditGenerates: 0,
    humanSaveableTrue: 0,
    humanSaveableFalse: 0,
    gateFailure: 0,
    partial: 0,
    failure: 0,
    samples: [],
  };
  if (!fs.existsSync(logPath)) return stats;

  const rl = readline.createInterface({
    input: fs.createReadStream(logPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.includes('"event":"generate_complete"')) continue;
    stats.generateComplete++;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row.outcome === "partial") stats.partial++;
    if (row.outcome === "failure") stats.failure++;
    if (row.executionPath === "gate_failure") stats.gateFailure++;
    if (row.humanSaveable === true) stats.humanSaveableTrue++;
    if (row.humanSaveable === false) stats.humanSaveableFalse++;

  }

  return stats;
}

function analyzeRun(runId, rows) {
  const byHuman = { SAVE: 0, PARTIAL_OK: 0, MAYBE: 0, SKIP: 0, REFUSE_OK: 0 };
  const byAuto = { SAVE: 0, PARTIAL_OK: 0, MAYBE: 0, SKIP: 0, REFUSE_OK: 0, EMPTY_BAD: 0 };
  const lies = [];
  const worst = [];
  const issueCounts = new Map();

  for (const row of rows) {
    const auto = row.judgment?.verdict || "EMPTY_BAD";
    byAuto[auto] = (byAuto[auto] || 0) + 1;
    const hr = humanRealityVerdict(row);
    byHuman[hr.humanVerdict] = (byHuman[hr.humanVerdict] || 0) + 1;

    for (const iss of hr.issues) {
      const key = iss.split(" (")[0];
      issueCounts.set(key, (issueCounts.get(key) ?? 0) + 1);
    }

    if (hr.issues.some((i) => i.includes("BENCHMARK LIE"))) {
      lies.push({ id: row.id, prompt: row.prompt, auto, human: hr.humanVerdict, issues: hr.issues });
    }
    if (hr.humanVerdict === "SKIP" || hr.humanVerdict === "MAYBE") {
      worst.push({
        id: row.id,
        prompt: row.prompt,
        family: row.family,
        difficulty: row.difficulty,
        auto,
        human: hr.humanVerdict,
        fill: `${row.tracks.length}/${row.length}`,
        expected: hr.expected,
        issues: hr.issues,
        topTracks: row.tracks.slice(0, 8).map((t) => `${t.artist} — ${t.title}`),
        opener: row.tracks.slice(0, 3).map((t) => `${t.artist} — ${t.title}`),
        hqg: row.humanQualityGate?.action,
        confidence: row.playlistConfidence?.percent,
      });
    }
  }

  return {
    runId,
    count: rows.length,
    byAuto,
    byHuman,
    lies: lies.length,
    lieSamples: lies.slice(0, 15),
    worst: worst.sort((a, b) => (a.human === "SKIP" ? -1 : 1)).slice(0, 25),
    topIssues: [...issueCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
  };
}

const runs = [
  "human-keep-3h-20260728-1320",
  "2026-07-27_1305Z",
];

const allRows = [];
const runReports = [];

for (const runId of runs) {
  const file = path.join(ROOT, "reports/playlist-evaluation/human-keep-live", runId, "generations.jsonl");
  const rows = loadJsonl(file);
  allRows.push(...rows.map((r) => ({ ...r, _run: runId })));
  runReports.push(analyzeRun(runId, rows));
}

const apiStats = await parseApiLog(path.join(ROOT, "kwalify-api.log"));

const outDir = path.join(ROOT, "reports/playlist-evaluation");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "recent-benchmark-human-audit.json");
const mdPath = path.join(outDir, "recent-benchmark-human-audit.md");

const combined = analyzeRun("ALL-RUNS", allRows);
const report = { generatedAt: new Date().toISOString(), runs: runReports, combined, apiStats };
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

let md = `# Recent benchmark human audit\n\nGenerated: ${report.generatedAt}\n\n`;
md += `## Runs analyzed\n\n`;
for (const r of runReports) {
  md += `### ${r.runId} (${r.count} playlists)\n\n`;
  md += `| Verdict | Auto judge | Human reality (re-audit) |\n|---|---|---|\n`;
  for (const v of ["SAVE", "PARTIAL_OK", "MAYBE", "SKIP", "REFUSE_OK"]) {
    md += `| ${v} | ${r.byAuto[v] ?? 0} | ${r.byHuman[v] ?? 0} |\n`;
  }
  md += `\n**Benchmark lies (auto SAVE, human SKIP/MAYBE):** ${r.lies}\n\n`;
  md += `**Top issue patterns:** ${r.topIssues.map(([k, n]) => `${k} (${n})`).join(", ")}\n\n`;
}

md += `## Combined (${combined.count} playlists)\n\n`;
md += `- Auto SAVE: ${combined.byAuto.SAVE} → Human SAVE: ${combined.byHuman.SAVE}\n`;
md += `- Auto would-save rate: ${((combined.byAuto.SAVE || 0) / combined.count * 100).toFixed(0)}%\n`;
md += `- **Human reality save rate: ${((combined.byHuman.SAVE || 0) / combined.count * 100).toFixed(0)}%**\n`;
md += `- Human SKIP/MAYBE: ${(combined.byHuman.SKIP || 0) + (combined.byHuman.MAYBE || 0)}\n`;
md += `- Benchmark lies: ${combined.lies}\n\n`;

md += `## API log (kwalify-api.log generate_complete)\n\n`;
md += `- Total generate_complete events: ${apiStats.generateComplete}\n`;
md += `- humanSaveable=true: ${apiStats.humanSaveableTrue}\n`;
md += `- humanSaveable=false: ${apiStats.humanSaveableFalse}\n`;
md += `- executionPath=gate_failure: ${apiStats.gateFailure}\n`;
md += `- outcome partial: ${apiStats.partial}\n`;
md += `- outcome failure: ${apiStats.failure}\n\n`;

md += `## Worst deliveries (human SKIP/MAYBE) — sample\n\n`;
for (const w of combined.worst) {
  md += `### ${w.id} — "${w.prompt}"\n\n`;
  md += `- **Auto:** ${w.auto} · **Human:** ${w.human} · **Fill:** ${w.fill} · **Family:** ${w.family}\n`;
  md += `- **Expected:** ${w.expected}\n`;
  md += `- **Issues:** ${w.issues.join("; ")}\n`;
  md += `- **HQ gate:** ${w.hqg ?? "?"} · **Confidence:** ${w.confidence ?? "?"}%\n`;
  md += `- **Openers:** ${w.opener.join(" | ")}\n`;
  md += `- **More tracks:** ${w.topTracks.slice(3).join(" | ")}\n\n`;
}

fs.writeFileSync(mdPath, md);
console.log(`Wrote ${outPath}`);
console.log(`Wrote ${mdPath}`);
console.log(JSON.stringify({ combined: combined.byHuman, lies: combined.lies, apiStats }, null, 2));
