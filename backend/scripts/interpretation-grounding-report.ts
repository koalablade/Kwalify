/**
 * Interpretation Grounding Report (offline, deterministic).
 *
 * Purpose: cheaply measure whether the Human Moment interpreter actually
 * *understands* lived-experience prompts ("hospital waiting room", "walking home
 * after failing an interview") versus only pattern-matching keywords.
 *
 * It runs each prompt straight through interpretMoment + deriveExpectationContract
 * with NO engine seed and NO server. That is the honest worst case: it isolates
 * what the interpretation layer knows on its own, before the rest of the pipeline
 * lends it any signal.
 *
 * This tool does not change behaviour and does not gate anything. It exists to
 * produce evidence about where interpretation falls short, so any future
 * expansion is justified by observed failures rather than guesses.
 *
 * Usage:
 *   node backend/dist/scripts/interpretation-grounding-report.js            # lived-experience set
 *   node backend/dist/scripts/interpretation-grounding-report.js --all      # whole benchmark suite
 *   node backend/dist/scripts/interpretation-grounding-report.js --out reports/foo --top 15
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  LIVED_EXPERIENCE_PROMPTS,
  PHASE3_HUMAN_PROMPTS,
  PLAYLIST_BENCHMARK_PROMPTS,
  type PlaylistBenchmarkPrompt,
} from "../lib/playlist-evaluation/benchmark-prompts";
import { deriveExpectationContract } from "../core/expectation/expectation-contract";
import { interpretMoment } from "../core/expectation/moment-space";
import type { DimensionGroup } from "../core/expectation/types";

type Direction = "low" | "medium" | "high";

interface PromptRow {
  id: string;
  category: string;
  prompt: string;
  note: string;
  novelPrompt: boolean;
  peakSalience: number;
  confidence: number;
  topLabel: string;
  openFallback: boolean;
  groundedDims: string[];
  groundedEmotionAtmos: number;
  embOnlyDims: string[];
  energyCenter: number;
  valenceCenter: number;
  expectedEnergy: Direction | null;
  expectedValence: Direction | null;
  energyMatch: boolean | null;
  valenceMatch: boolean | null;
  triagePenalty: number;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function mean(pair: readonly number[]): number {
  return pair.length ? pair.reduce((s, x) => s + x, 0) / pair.length : 0;
}

function bucket(x: number): Direction {
  if (x < 0.4) return "low";
  if (x > 0.6) return "high";
  return "medium";
}

const GROUPS: DimensionGroup[] = [
  "emotional",
  "social",
  "environment",
  "activity",
  "energyTrajectory",
  "atmosphere",
  "lyrical",
  "production",
  "era",
  "discovery",
];

function analyse(bp: PlaylistBenchmarkPrompt): PromptRow {
  // No seed on purpose: isolate what interpretation knows unaided.
  const interpretation = interpretMoment(bp.prompt);
  const contract = deriveExpectationContract(interpretation);

  const allDims = GROUPS.flatMap((g) => interpretation.dimensions.byGroup[g]);
  const grounded = allDims.filter((d) => d.grounded);
  const embOnly = allDims.filter((d) => !d.grounded);
  const groundedEmotionAtmos = grounded.filter(
    (d) => d.group === "emotional" || d.group === "atmosphere",
  ).length;

  const topLabel = interpretation.candidates[0]?.label ?? "(none)";
  const openFallback =
    topLabel === "Open interpretation" ||
    topLabel === "Broader open reading" ||
    interpretation.candidates.every(
      (c) => c.label === "Open interpretation" || c.label === "Broader open reading",
    );

  const energyCenter = mean(contract.sonicBands.energy);
  const valenceCenter = mean(contract.sonicBands.valence);

  const expectedEnergy = (bp.expectedEnergy ?? null) as Direction | null;
  const expectedValence = (bp.expectedValence ?? null) as Direction | null;
  const energyMatch = expectedEnergy ? bucket(energyCenter) === expectedEnergy : null;
  const valenceMatch = expectedValence ? bucket(valenceCenter) === expectedValence : null;

  // Triage penalty orders the "needs attention" list. It is NOT a quality score
  // and never affects generation — only which prompts a human should look at first.
  let triagePenalty = 0;
  if (interpretation.novelPrompt) triagePenalty += 2;
  if (groundedEmotionAtmos === 0) triagePenalty += 2;
  if (openFallback) triagePenalty += 2;
  if (energyMatch === false) triagePenalty += 1;
  if (valenceMatch === false) triagePenalty += 1;
  if (interpretation.peakSalience < 0.3) triagePenalty += 1;

  return {
    id: bp.id,
    category: bp.category,
    prompt: bp.prompt,
    note: bp.tags[1] ?? "",
    novelPrompt: interpretation.novelPrompt,
    peakSalience: round(interpretation.peakSalience),
    confidence: round(interpretation.candidates[0]?.confidence ?? 0),
    topLabel,
    openFallback,
    groundedDims: grounded.map((d) => `${d.key}(${round(d.weight)})`),
    groundedEmotionAtmos,
    embOnlyDims: embOnly.map((d) => d.key),
    energyCenter: round(energyCenter),
    valenceCenter: round(valenceCenter),
    expectedEnergy,
    expectedValence,
    energyMatch,
    valenceMatch,
    triagePenalty,
  };
}

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${Math.round((n / d) * 100)}%`;
}

function buildReport(title: string, rows: PromptRow[], topN: number): string {
  const n = rows.length;
  const grounded = rows.filter((r) => !r.novelPrompt).length;
  const emotionallyGrounded = rows.filter((r) => r.groundedEmotionAtmos > 0).length;
  const openFallback = rows.filter((r) => r.openFallback).length;
  const avgSalience = round(mean(rows.map((r) => r.peakSalience)));
  const avgConfidence = round(mean(rows.map((r) => r.confidence)));

  const withEnergy = rows.filter((r) => r.energyMatch !== null);
  const withValence = rows.filter((r) => r.valenceMatch !== null);
  const energyHits = withEnergy.filter((r) => r.energyMatch === true).length;
  const valenceHits = withValence.filter((r) => r.valenceMatch === true).length;

  const worst = [...rows].sort((a, b) => b.triagePenalty - a.triagePenalty).slice(0, topN);

  const lines: string[] = [];
  lines.push(`# Interpretation Grounding Report — ${title}`);
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push(
    "Prompts run through `interpretMoment` + `deriveExpectationContract` with **no engine seed** " +
      "(isolates the interpretation layer alone). This measures whether the system *understands the " +
      "lived experience*, not whether the final playlist is good.",
  );
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Prompts analysed: **${n}**`);
  lines.push(`- Lexically grounded (not flagged novel): **${grounded}/${n}** (${pct(grounded, n)})`);
  lines.push(
    `- Emotionally grounded (≥1 grounded emotion/atmosphere anchor): **${emotionallyGrounded}/${n}** (${pct(emotionallyGrounded, n)})`,
  );
  lines.push(`- Fell back to an "open"/ambiguous reading: **${openFallback}/${n}** (${pct(openFallback, n)})`);
  lines.push(`- Avg peak salience: **${avgSalience}**   ·   Avg top-candidate confidence: **${avgConfidence}**`);
  if (withEnergy.length) {
    lines.push(
      `- Energy direction correct: **${energyHits}/${withEnergy.length}** (${pct(energyHits, withEnergy.length)})`,
    );
  }
  if (withValence.length) {
    lines.push(
      `- Valence direction correct: **${valenceHits}/${withValence.length}** (${pct(valenceHits, withValence.length)})`,
    );
  }
  lines.push("");
  lines.push(
    "> **How to read this:** high grounding % means the interpreter recognises the words. " +
      "Low *emotional* grounding or wrong direction on prompts that ARE grounded is the real signal — " +
      "it means the system saw the words but misread the lived experience.",
  );
  lines.push("");

  lines.push(`## Needs attention first (top ${worst.length} by triage order)`);
  lines.push("");
  lines.push("Triage order highlights the prompts a human should review first; it is not a quality score.");
  lines.push("");
  lines.push("| Prompt | Novel | EmoGnd | Open | Energy (got→exp) | Valence (got→exp) | Salience | Top reading |");
  lines.push("|---|:--:|:--:|:--:|---|---|:--:|---|");
  for (const r of worst) {
    const energyCell = r.expectedEnergy
      ? `${bucket(r.energyCenter)}→${r.expectedEnergy}${r.energyMatch ? " ✓" : " ✗"}`
      : `${bucket(r.energyCenter)}`;
    const valenceCell = r.expectedValence
      ? `${bucket(r.valenceCenter)}→${r.expectedValence}${r.valenceMatch ? " ✓" : " ✗"}`
      : `${bucket(r.valenceCenter)}`;
    lines.push(
      `| ${r.prompt} | ${r.novelPrompt ? "yes" : "no"} | ${r.groundedEmotionAtmos} | ${r.openFallback ? "yes" : "no"} | ${energyCell} | ${valenceCell} | ${r.peakSalience} | ${r.topLabel} |`,
    );
  }
  lines.push("");

  lines.push("## Per-prompt detail");
  lines.push("");
  for (const r of rows) {
    lines.push(`### ${r.prompt}`);
    lines.push("");
    if (r.note) lines.push(`- Human expectation: _${r.note}_`);
    lines.push(`- Top reading: **${r.topLabel}** (confidence ${r.confidence})`);
    lines.push(
      `- novelPrompt: **${r.novelPrompt}** · peakSalience: **${r.peakSalience}** · openFallback: **${r.openFallback}**`,
    );
    lines.push(
      `- Energy center: **${r.energyCenter}** (${bucket(r.energyCenter)}${r.expectedEnergy ? `, expected ${r.expectedEnergy}${r.energyMatch ? " ✓" : " ✗"}` : ""})`,
    );
    lines.push(
      `- Valence center: **${r.valenceCenter}** (${bucket(r.valenceCenter)}${r.expectedValence ? `, expected ${r.expectedValence}${r.valenceMatch ? " ✓" : " ✗"}` : ""})`,
    );
    lines.push(`- Grounded dims: ${r.groundedDims.length ? r.groundedDims.join(", ") : "_none_"}`);
    if (r.embOnlyDims.length) lines.push(`- Embedding-only dims (weak): ${r.embOnlyDims.join(", ")}`);
    lines.push("");
  }

  return lines.join("\n");
}

function main(): void {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const phase3 = args.includes("--phase3");
  const hard = args.includes("--hard");
  const outIdx = args.indexOf("--out");
  const outDir = outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1]! : "reports/interpretation-grounding";
  const topIdx = args.indexOf("--top");
  const topN = topIdx >= 0 && args[topIdx + 1] ? Number.parseInt(args[topIdx + 1]!, 10) : 12;

  let target: PlaylistBenchmarkPrompt[];
  let title: string;
  if (all) {
    target = PLAYLIST_BENCHMARK_PROMPTS;
    title = `full suite (${target.length} prompts)`;
  } else if (phase3) {
    target = PHASE3_HUMAN_PROMPTS;
    title = `phase-3 hard human-language set (${target.length} prompts)`;
  } else if (hard) {
    target = [...LIVED_EXPERIENCE_PROMPTS, ...PHASE3_HUMAN_PROMPTS];
    title = `hard set: lived-experience + phase-3 (${target.length} prompts)`;
  } else {
    target = LIVED_EXPERIENCE_PROMPTS;
    title = `lived-experience set (${target.length} prompts)`;
  }

  const rows = target.map(analyse);
  const report = buildReport(title, rows, topN);

  mkdirSync(outDir, { recursive: true });
  const slug = all ? "full" : phase3 ? "phase3" : hard ? "hard" : "lived";
  const reportPath = join(outDir, `report-${slug}.md`);
  const jsonPath = join(outDir, `results-${slug}.json`);
  writeFileSync(reportPath, report, "utf8");
  writeFileSync(jsonPath, JSON.stringify(rows, null, 2), "utf8");

  // Console digest for immediate feedback.
  const n = rows.length;
  const grounded = rows.filter((r) => !r.novelPrompt).length;
  const emo = rows.filter((r) => r.groundedEmotionAtmos > 0).length;
  const open = rows.filter((r) => r.openFallback).length;
  const withE = rows.filter((r) => r.energyMatch !== null);
  const eHit = withE.filter((r) => r.energyMatch === true).length;
  const withV = rows.filter((r) => r.valenceMatch !== null);
  const vHit = withV.filter((r) => r.valenceMatch === true).length;

  process.stdout.write(`\n=== Interpretation Grounding — ${title} ===\n`);
  process.stdout.write(`  grounded (not novel):       ${grounded}/${n} (${pct(grounded, n)})\n`);
  process.stdout.write(`  emotionally grounded:       ${emo}/${n} (${pct(emo, n)})\n`);
  process.stdout.write(`  open/ambiguous fallback:    ${open}/${n} (${pct(open, n)})\n`);
  if (withE.length) process.stdout.write(`  energy direction correct:   ${eHit}/${withE.length} (${pct(eHit, withE.length)})\n`);
  if (withV.length) process.stdout.write(`  valence direction correct:  ${vHit}/${withV.length} (${pct(vHit, withV.length)})\n`);
  process.stdout.write(`\n  report:  ${reportPath}\n  results: ${jsonPath}\n\n`);
}

main();
