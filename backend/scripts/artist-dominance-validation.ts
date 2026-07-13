/**
 * Gated artist-dominance check for eval reports.
 * Usage: node backend/dist/scripts/artist-dominance-validation.js [evaluation-report.json]
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { analyzeArtistDominance, type ArtistDominanceRow } from "../lib/artist-dominance-gates";

const ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_REPORT = path.join(
  ROOT,
  "reports/playlist-evaluation/scoring-stage3-post-fix/evaluation-report.json",
);

function buildMarkdown(result: ReturnType<typeof analyzeArtistDominance>, reportLabel: string): string {
  const lines = [
    "# Artist Dominance Validation",
    "",
    `Report: \`${reportLabel}\``,
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Gates",
    "",
    "| Gate | Value | Max | Pass |",
    "|------|------:|----:|:----:|",
  ];
  for (const [name, g] of Object.entries(result.gates)) {
    const extra = g.prompt ? ` (${g.prompt})` : "";
    lines.push(`| ${name}${extra} | ${g.value} | ${g.max} | ${g.pass ? "yes" : "no"} |`);
  }
  lines.push(
    "",
    `**Overall:** ${result.pass ? "PASS" : "FAIL"}`,
    "",
    "## Session split",
    "",
    `| Artist | Early half | Late half |`,
    `|--------|----------:|----------:|`,
    `| Paramore | ${result.earlyHalf.paramore} | ${result.lateHalf.paramore} |`,
    `| Fred again.. | ${result.earlyHalf.fred} | ${result.lateHalf.fred} |`,
    `| GnR | ${result.earlyHalf.gnr} | ${result.lateHalf.gnr} |`,
    "",
  );
  return lines.join("\n");
}

async function main(): Promise<void> {
  const reportPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_REPORT;
  const raw = JSON.parse(await readFile(reportPath, "utf8")) as { rawResults?: ArtistDominanceRow[] };
  const result = analyzeArtistDominance(raw.rawResults ?? []);
  const outDir = path.dirname(reportPath);
  await mkdir(outDir, { recursive: true });
  const jsonOut = path.join(outDir, "artist-dominance-validation.json");
  const mdOut = path.join(outDir, "artist-dominance-validation.md");
  await writeFile(jsonOut, JSON.stringify({ generatedAt: new Date().toISOString(), ...result }, null, 2), "utf8");
  await writeFile(mdOut, buildMarkdown(result, path.basename(path.dirname(reportPath))), "utf8");
  console.log("Wrote", jsonOut);
  console.log("Wrote", mdOut);
  console.log(result.pass ? "PASS" : "FAIL", "— Paramore", result.totals.paramore ?? 0);
  if (!result.pass) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
