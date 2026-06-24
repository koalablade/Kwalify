/**
 * Human-save audit — real library playlists judged for scene-world quality.
 *
 * Usage:
 *   DATABASE_URL=... npm run audit:human-save
 */

import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { runSceneWorldProofSuite } from "../lib/scene-world-proof-runner";
import type { SceneWorldProofReport } from "../core/scene-world-proof-capture";
import {
  computeSceneClusterMembershipScore,
} from "../core/scene-cohesion-clusters";

const PROMPTS = [
  "feel-good summer morning",
  "rainy city walk",
  "cozy Sunday morning",
  "late night thinking",
  "optimistic commute",
  "driving at sunset",
];

type Offender = {
  position: number;
  title: string;
  artist: string;
  genreFamily: string;
  worldMembership: number;
  clusterMembership: number;
  humanReason: string;
  survivalStage: string;
};

function obviousHumanReject(
  track: { title: string; artist: string; genreFamily: string },
  prompt: string,
): string | null {
  const g = track.genreFamily.toLowerCase();
  const name = `${track.title} | ${track.artist}`.toLowerCase();
  const lower = prompt.toLowerCase();

  if (g === "metal") return "Metal has no place in a soft scene prompt.";
  if (g === "country" && (lower.includes("summer") || lower.includes("morning"))) {
    return "Country bro-pop breaks a bright indie-pop morning world.";
  }
  if (name.includes("destructo disk") || name.includes("queens of the stone")) {
    return "Aggressive/novelty rock breaks a gentle scene playlist.";
  }
  if ((lower.includes("summer") || lower.includes("commute") || lower.includes("optimistic")) &&
    (name.includes("tchami") || name.includes("little big") || name.includes("techno"))) {
    return "Rave/electronic club music is a different sub-world from indie-pop sunshine.";
  }
  if ((lower.includes("rainy") || lower.includes("cozy") || lower.includes("late")) &&
    g === "hip_hop" && name.includes("stormzy")) {
    return "UK drill/grime energy breaks a reflective walking playlist.";
  }
  if (lower.includes("rainy") && g === "rock" && name.includes("destructo")) {
    return "Punk/noise rock spikes destroy rainy-walk cohesion.";
  }
  return null;
}

function analyzeReport(report: SceneWorldProofReport): {
  humanSave: boolean;
  confidence: "high" | "medium" | "low";
  offenders: Offender[];
  firstTenClusterConsistency: number;
  narrative: string;
} {
  const firstTen = report.finalPlaylist.slice(0, 10);
  const offenders: Offender[] = [];

  for (const row of firstTen) {
    const humanReason = obviousHumanReject(
      { title: row.title, artist: row.artist, genreFamily: row.genreFamily },
      report.prompt,
    );
    const clusterMembership = row.sceneClusterMembership ?? 0;
    const worldMembership = row.worldMembership ?? 0;
    if (humanReason || clusterMembership < 0.72) {
      offenders.push({
          position: row.rank,
          title: row.title,
          artist: row.artist,
          genreFamily: row.genreFamily,
          worldMembership,
          clusterMembership,
          humanReason: humanReason ?? `Low scene-cluster membership (${clusterMembership.toFixed(2)})`,
          survivalStage: clusterMembership < 0.55
            ? "survived interleaver/finalization — editorial opening repair missed"
            : "survived with partial cluster score — secondary genre or adjacent leak",
        });
    }
  }

  const clusterConsistency = report.firstTenClusterConsistency ?? 0;
  const humanSave = offenders.length === 0 && clusterConsistency >= 0.8;
  const confidence: "high" | "medium" | "low" =
    humanSave && clusterConsistency >= 0.9 ? "high" :
      humanSave ? "medium" : "low";

  const narrative = humanSave
    ? "First 10 tracks establish one scene world a human would save."
    : `${offenders.length} opening track(s) would make a human skip saving.`;

  return { humanSave, confidence, offenders, firstTenClusterConsistency: clusterConsistency, narrative };
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    const fallback = path.join("reports", "scene-world-proof.json");
    try {
      const raw = await readFile(fallback, "utf8");
      const payload = JSON.parse(raw) as { prompts: SceneWorldProofReport[] };
      process.stdout.write(`Using cached report: ${fallback}\n`);
      await writeAudit(payload.prompts.filter((row) => PROMPTS.some((p) => row.prompt.includes(p.split(" ")[0]!))));
      return;
    } catch {
      throw new Error("DATABASE_URL required (or place reports/scene-world-proof.json from a prior proof run)");
    }
  }

  const payload = await runSceneWorldProofSuite({ prompts: PROMPTS });
  await writeAudit(payload.prompts);
}

async function writeAudit(prompts: SceneWorldProofReport[]): Promise<void> {
  const audits = prompts.map((report) => {
    const analysis = analyzeReport(report);
    return {
      prompt: report.prompt,
      archetype: report.archetype?.label ?? null,
      dominantSceneCluster: report.dominantSceneCluster,
      clusterPurity: report.clusterPurity,
      sceneClusterViolationsRemoved: report.sceneClusterViolationsRemoved,
      firstTenClusterConsistency: analysis.firstTenClusterConsistency,
      beforeOpening: report.top50Before.slice(0, 10).map((row) => `${row.title} — ${row.artist} (${row.genreFamily})`),
      afterOpening: report.top50After.slice(0, 10).map((row) => `${row.title} — ${row.artist} (${row.genreFamily})`),
      finalOpening: report.finalPlaylist.slice(0, 10).map((row) =>
        `${row.title} — ${row.artist} (${row.genreFamily}) cluster=${row.sceneClusterMembership ?? "n/a"}`,
      ),
      offenders: analysis.offenders,
      removed: [
        ...report.membershipFiltered.slice(0, 15),
        ...report.editorialRemoved.slice(0, 10),
      ],
      humanSave: analysis.humanSave,
      confidence: analysis.confidence,
      narrative: analysis.narrative,
    };
  });

  const failed = audits.filter((row) => !row.humanSave).length;
  const out = {
    generatedAt: new Date().toISOString(),
    humanSaveVerdict: failed === 0 ? "YES" : "NO",
    promptsPassed: audits.length - failed,
    promptsTotal: audits.length,
    audits,
  };

  await mkdir(path.join("reports"), { recursive: true });
  const outFile = path.join("reports", "human-save-audit.json");
  await writeFile(outFile, JSON.stringify(out, null, 2));

  for (const row of audits) {
    process.stdout.write(`\n=== ${row.prompt} ===\n`);
    process.stdout.write(`Human save: ${row.humanSave ? "YES" : "NO"} (${row.confidence})\n`);
    process.stdout.write(`${row.narrative}\n`);
    process.stdout.write(`Dominant cluster: ${row.dominantSceneCluster ?? "n/a"}\n`);
    process.stdout.write(`First-10 cluster consistency: ${row.firstTenClusterConsistency}\n`);
    if (row.offenders.length) {
      process.stdout.write("Offenders:\n");
      for (const offender of row.offenders) {
        process.stdout.write(`  #${offender.position} ${offender.title} — ${offender.artist}\n`);
        process.stdout.write(`    ${offender.humanReason}\n`);
        process.stdout.write(`    ${offender.survivalStage}\n`);
      }
    }
    process.stdout.write("Final opening:\n");
    for (const line of row.finalOpening) process.stdout.write(`  ${line}\n`);
  }

  process.stdout.write(`\nReport: ${outFile}\n`);
  process.stdout.write(`Human-save verdict: ${out.humanSaveVerdict}\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
