/**
 * Aggregate production evidence from remote proof, human-save regression, and E2E.
 *
 * Usage: node scripts/production-evidence-report.mjs
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const REPORTS = path.join(ROOT, "reports");

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

function obviousHumanReject(track, prompt) {
  const g = (track.genreFamily || track.genrePrimary || "unknown").toLowerCase();
  const name = `${track.trackName || track.title || ""} | ${track.artistName || track.artist || ""}`.toLowerCase();
  const lower = prompt.toLowerCase();
  if (g === "metal") return "metal outlier";
  if (g === "country" && (lower.includes("summer") || lower.includes("morning"))) return "country breaks indie-pop morning";
  if (name.includes("tchami") || name.includes("little big") || name.includes("techno n tequila")) return "rave/electronic sub-world leak";
  if (name.includes("destructo disk") || name.includes("queens of the stone")) return "aggressive rock tourist";
  if (name.includes("guns n") || name.includes("offspring") || name.includes("goldfinger")) return "punk/hair-metal breaks reflective walk";
  if (lower.includes("late") && (g === "electronic" && name.includes("dnb"))) return "DnB/rave breaks late-night thinking";
  return null;
}

function humanSaveVerdict(prompt, tracks, sceneWorld) {
  const firstTen = tracks.slice(0, 10);
  const offenders = [];
  for (const t of firstTen) {
    const reason = obviousHumanReject(t, prompt);
    const cluster = t.sceneClusterMembership ?? sceneWorld?.sceneClusters?.firstTenClusterConsistency ?? null;
    const clusterScore = typeof t.sceneClusterMembership === "number"
      ? t.sceneClusterMembership
      : sceneWorld?.sceneClusters?.firstTenClusterConsistency ?? null;
    if (reason) {
      offenders.push({ ...t, humanReason: reason });
    } else if (clusterScore != null && clusterScore < 0.72 && sceneWorld?.active) {
      offenders.push({ ...t, humanReason: `low cluster membership (${clusterScore})` });
    }
  }
  const clusterConsistency =
    sceneWorld?.sceneClusters?.firstTenClusterConsistency ??
    sceneWorld?.metrics?.firstTenClusterConsistency ??
    null;
  const worldConsistency = sceneWorld?.metrics?.worldConsistency ?? null;
  const pass = offenders.length === 0 && (clusterConsistency == null || clusterConsistency >= 0.8);
  return {
    humanSave: pass ? "YES" : "NO",
    offenders,
    clusterConsistency,
    worldConsistency,
    dominantSceneCluster: sceneWorld?.sceneClusters?.dominantCluster ?? sceneWorld?.archetype?.label ?? null,
    archetype: sceneWorld?.archetype?.label ?? null,
  };
}

async function main() {
  const readyz = await fetch("https://kwalify.net/api/readyz").then((r) => r.json()).catch(() => ({}));
  const remote = await readJson(path.join(REPORTS, "scene-world-proof-remote.json"));
  const regression = await readJson(path.join(REPORTS, "human-save-regression.json"));
  const e2e = await readJson(path.join(REPORTS, "live-e2e-phase", "results.json"));

  const hasRemote = remote?.results?.some((row) => row.firstTenTracks?.length > 0 || row.proof?.finalPlaylist?.length > 0);
  const hasRegression = regression?.results?.some((row) => row.firstTenTracks?.length > 0);
  const hasE2e = e2e?.playlists?.some((row) => row.tracks?.length > 0);

  if (!hasRemote || !hasRegression || !hasE2e) {
    const blocker = {
      error: "PRODUCTION_EVIDENCE_INCOMPLETE",
      generatedAt: new Date().toISOString(),
      deploymentCommit: readyz.commit ?? null,
      missing: {
        sceneWorldProof: !hasRemote,
        humanSaveRegression: !hasRegression,
        e2e: !hasE2e,
      },
      message: "Report requires real production playlists from all three proof runs. No fixture or inferred data.",
    };
    await mkdir(REPORTS, { recursive: true });
    await writeFile(path.join(REPORTS, "production-evidence-report.json"), JSON.stringify(blocker, null, 2));
    await writeFile(
      path.join(REPORTS, "production-evidence-report.md"),
      `# Production Evidence Report\n\n**Status:** BLOCKED — incomplete production data\n\n\`\`\`json\n${JSON.stringify(blocker, null, 2)}\n\`\`\`\n`,
    );
    console.error(JSON.stringify(blocker, null, 2));
    process.exit(1);
  }

  remote.results ??= [];
  regression.results ??= [];
  e2e.playlists ??= [];
  e2e.aggregateMetrics ??= {};

  const sceneWorldPrompts = (remote.results ?? []).map((row) => {
    const proof = row.proof ?? {};
    const finalTen = (proof.finalPlaylist ?? []).slice(0, 10).map((t) => ({
      rank: t.rank,
      title: t.title,
      artist: t.artist,
      genreFamily: t.genreFamily,
      worldMembership: t.worldMembership,
      sceneClusterMembership: t.sceneClusterMembership,
    }));
    const verdict = humanSaveVerdict(row.prompt, finalTen.map((t) => ({
      trackName: t.title,
      artistName: t.artist,
      genreFamily: t.genreFamily,
      sceneClusterMembership: t.sceneClusterMembership,
    })), {
      active: proof.sceneWorldActive,
      archetype: proof.archetype,
      metrics: proof.metrics,
      sceneClusters: {
        dominantCluster: proof.dominantSceneCluster,
        firstTenClusterConsistency: proof.firstTenClusterConsistency,
      },
    });
    return {
      prompt: row.prompt,
      pass: row.pass,
      candidateReplacementPct: proof.candidateReplacementPct,
      firstTenCohesion: proof.firstTenCohesion,
      ...verdict,
      beforeOpening: (proof.top50Before ?? []).slice(0, 10).map((t) => `${t.title} — ${t.artist} (${t.genreFamily})`),
      afterOpening: (proof.top50After ?? []).slice(0, 10).map((t) => `${t.title} — ${t.artist} (${t.genreFamily})`),
      finalOpening: finalTen.map((t) => `${t.title} — ${t.artist} (${t.genreFamily}) cluster=${t.sceneClusterMembership ?? "n/a"}`),
      removed: [
        ...(proof.membershipFiltered ?? []).slice(0, 12),
        ...(proof.editorialRemoved ?? []).slice(0, 8),
      ],
    };
  });

  const regressionPrompts = (regression.results ?? []).map((row) => ({
    id: row.id,
    prompt: row.id,
    humanSave: row.pass ? "YES" : "NO",
    firstTenClusterConsistency: row.firstTenClusterConsistency,
    sceneWorld: row.sceneWorld,
    opening5: row.opening5,
    outliers: row.outliers,
  }));

  const e2ePrompts = (e2e.playlists ?? []).map((row) => {
    const sceneWorld = row.rawDiagnostics?.v3Pipeline?.sceneWorldLayer
      ?? row.metadata?.sceneWorld
      ?? null;
    const verdict = humanSaveVerdict(row.prompt, row.tracks ?? [], sceneWorld);
    return {
      id: row.id,
      category: row.category,
      prompt: row.prompt,
      ok: row.ok,
      ...verdict,
      firstTen: (row.tracks ?? []).slice(0, 10).map((t) =>
        `${t.trackName} — ${t.artistName} (${t.genreFamily ?? "unknown"})`,
      ),
    };
  });

  const humanSaveNo = [
    ...sceneWorldPrompts.filter((p) => p.humanSave === "NO"),
    ...regressionPrompts.filter((p) => p.humanSave === "NO"),
    ...e2ePrompts.filter((p) => p.humanSave === "NO"),
  ];

  const report = {
    generatedAt: new Date().toISOString(),
    deploymentCommit: readyz.commit ?? null,
    deploymentStatus: readyz.status ?? null,
    summary: {
      sceneWorldProofPrompts: sceneWorldPrompts.length,
      sceneWorldHumanSaveYes: sceneWorldPrompts.filter((p) => p.humanSave === "YES").length,
      regressionPassed: regression.results?.filter((r) => r.pass).length ?? 0,
      regressionTotal: regression.results?.length ?? 0,
      e2eSuccess: e2e.aggregateMetrics?.successCount ?? 0,
      e2eTotal: e2e.aggregateMetrics?.totalPrompts ?? 0,
      topRepeatedTracks: e2e.aggregateMetrics?.trackRepetitionAcrossOutputs?.slice?.(0, 20)
        ?? e2e.aggregateMetrics?.trackRepetitionAcrossOutputs
        ?? [],
      topRepeatedArtists: e2e.aggregateMetrics?.topRepeatedArtists ?? [],
      remainingFailures: humanSaveNo.length,
    },
    sceneWorldProof: sceneWorldPrompts,
    humanSaveRegression: regressionPrompts,
    e2e: {
      aggregateMetrics: e2e.aggregateMetrics ?? {},
      prompts: e2ePrompts,
    },
    failures: humanSaveNo,
  };

  await mkdir(REPORTS, { recursive: true });
  const jsonPath = path.join(REPORTS, "production-evidence-report.json");
  await writeFile(jsonPath, JSON.stringify(report, null, 2));

  let md = `# Production Evidence Report\n\n`;
  md += `**Generated:** ${report.generatedAt}\n\n`;
  md += `**Deployment:** \`${report.deploymentCommit ?? "unknown"}\` (${report.deploymentStatus ?? "unknown"})\n\n`;
  md += `## Summary\n\n`;
  md += `- Scene world proof human-save YES: ${report.summary.sceneWorldHumanSaveYes}/${report.summary.sceneWorldProofPrompts}\n`;
  md += `- Human-save regression pass: ${report.summary.regressionPassed}/${report.summary.regressionTotal}\n`;
  md += `- E2E success: ${report.summary.e2eSuccess}/${report.summary.e2eTotal}\n`;
  md += `- Remaining human-save NO verdicts: ${report.summary.remainingFailures}\n\n`;

  md += `## Scene World Proof (production API)\n\n`;
  for (const p of sceneWorldPrompts) {
    md += `### ${p.prompt}\n\n`;
    md += `- **Human save:** ${p.humanSave}\n`;
    md += `- **Archetype:** ${p.archetype ?? "n/a"}\n`;
    md += `- **Dominant cluster:** ${p.dominantSceneCluster ?? "n/a"}\n`;
    md += `- **Cluster consistency:** ${p.clusterConsistency ?? "n/a"}\n`;
    md += `- **World consistency:** ${p.worldConsistency ?? "n/a"}\n\n`;
    md += `**Final opening 10:**\n\n`;
    for (const line of p.finalOpening) md += `- ${line}\n`;
    md += `\n`;
    if (p.offenders.length) {
      md += `**Offenders:**\n\n`;
      for (const o of p.offenders) {
        md += `- ${o.trackName ?? o.title} — ${o.artistName ?? o.artist}: ${o.humanReason}\n`;
      }
      md += `\n`;
    }
  }

  md += `## Remaining failures\n\n`;
  if (report.failures.length === 0) {
    md += `None.\n`;
  } else {
    for (const f of report.failures) {
      md += `- ${f.prompt ?? f.id}: ${f.humanReason ?? "see offenders"}\n`;
    }
  }

  const mdPath = path.join(REPORTS, "production-evidence-report.md");
  await writeFile(mdPath, md);
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
  console.log(JSON.stringify(report.summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
