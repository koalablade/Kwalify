/**
 * Scene World Layer proof — real library before/after ranking report.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npm run proof:scene-world
 */

import { runSceneWorldProofSuite } from "../lib/scene-world-proof-runner";

function formatRemoval(row: {
  title: string;
  artist: string;
  previousRank: number;
  worldMembershipScore: number;
  removalReason: string;
}): string {
  return [
    `${row.title} — ${row.artist}`,
    `Rank before: ${row.previousRank}`,
    `World score: ${row.worldMembershipScore.toFixed(2)}`,
    `Removed: ${row.removalReason}`,
  ].join("\n");
}

async function main(): Promise<void> {
  const payload = await runSceneWorldProofSuite();
  for (const report of payload.prompts) {
    process.stdout.write(`\n=== ${report.prompt} ===\n`);
    process.stdout.write(`Archetype: ${report.archetype?.label ?? "none"}\n`);
    process.stdout.write(`Candidate replacement: ${report.candidateReplacementPct}% ` +
      `(material influence: ${report.passMaterialInfluence ? "YES" : "NO"})\n`);
    process.stdout.write(`First-10 cohesion: ${report.firstTenCohesion}\n`);
    process.stdout.write(`World membership distribution: ${JSON.stringify(report.worldMembershipDistribution)}\n`);

    process.stdout.write("\nTop 10 BEFORE Scene World:\n");
    for (const row of report.top50Before.slice(0, 10)) {
      process.stdout.write(`${row.rank}. ${row.title} — ${row.artist} | ${row.genreFamily} | score=${row.score}\n`);
    }
    process.stdout.write("\nTop 10 AFTER Scene World:\n");
    for (const row of report.top50After.slice(0, 10)) {
      process.stdout.write(`${row.rank}. ${row.title} — ${row.artist} | ${row.genreFamily} | score=${row.score} | world=${row.worldMembership}\n`);
    }

    if (report.membershipFiltered.length > 0) {
      process.stdout.write("\nRemoved by world membership filtering:\n");
      for (const row of report.membershipFiltered.slice(0, 12)) {
        process.stdout.write(`${formatRemoval(row)}\n\n`);
      }
    }
    if (report.editorialRemoved.length > 0) {
      process.stdout.write("\nRemoved by editorial audit:\n");
      for (const row of report.editorialRemoved) {
        process.stdout.write(`${formatRemoval(row)}\n\n`);
      }
    }

    process.stdout.write("\nFinal playlist (first 10):\n");
    for (const row of report.finalPlaylist.slice(0, 10)) {
      process.stdout.write(`${row.rank}. ${row.title} — ${row.artist} | ${row.genreFamily} | world=${row.worldMembership}\n`);
    }
  }

  process.stdout.write(`\nSummary: ${payload.summary.materialInfluenceCount}/${payload.summary.promptsRun} prompts ` +
    `with >=25% candidate replacement (avg ${payload.summary.avgReplacementPct}%)\n`);
  process.stdout.write(`Full report: reports/scene-world-proof.json\n`);

  if (payload.summary.materialInfluenceCount < payload.summary.promptsRun) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
