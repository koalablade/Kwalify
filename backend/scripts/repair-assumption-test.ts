/**
 * Test: "Repair is helping more than hurting"
 */
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildLockedIntent } from "../core/v3/intent";
import { PLAYLIST_BENCHMARK_PROMPTS } from "../lib/playlist-evaluation/benchmark-prompts";

const PROMPTS = [
  "party-latin-summer",
  "drive-late-garage",
  "gym-2000s-pop-punk",
  "chill-acoustic",
  "launch-calibration-001",
  "launch-calibration-003",
  "launch-calibration-023",
] as const;

function repoRoot(): string {
  for (const up of [2, 3]) {
    const c = path.resolve(__dirname, ...Array(up).fill(".."));
    if (existsSync(path.join(c, "package.json"))) return c;
  }
  return path.resolve(__dirname, "..", "..", "..");
}

const ROOT = repoRoot();
const OUT_JSON = path.join(ROOT, "reports", "playlist-evaluation", "repair-assumption-test.json");
const OUT_MD = path.join(ROOT, "reports", "playlist-evaluation", "repair-assumption-test.md");

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function txt(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function intentShareFromFunnel(stage: Record<string, unknown> | null): number | null {
  if (!stage) return null;
  const total = num(stage.total) ?? 0;
  const ir = num(stage.intentRelevantRaw) ?? 0;
  return total > 0 ? ir / total : null;
}

function familyMatchScore(tracks: Array<Record<string, unknown>>, families: string[]): number {
  if (tracks.length === 0) return 0;
  let hit = 0;
  for (const t of tracks) {
    const blob = [
      t.genreFamily, t.genrePrimary, t.primarySubgenre, t.trackName, t.artistName,
    ].map((x) => `${x ?? ""}`.toLowerCase()).join(" ");
    if (families.some((f) => blob.includes(f.replace(/_/g, " ")) || blob.includes(f))) hit++;
  }
  return hit / tracks.length;
}

type StageRow = { stage: string; enter?: number; exit: number; lost: number; added: number };

function parseStages(forensics: Record<string, unknown> | null): StageRow[] {
  if (!forensics) return [];
  const stages = Array.isArray(forensics.stages) ? forensics.stages : [];
  return stages
    .map((s) => asRecord(s))
    .filter((s): s is Record<string, unknown> => !!s)
    .map((s) => ({
      stage: txt(s.stage) ?? "unknown",
      enter: num(s.enter) ?? undefined,
      exit: num(s.exit) ?? 0,
      lost: num(s.lost) ?? 0,
      added: num(s.added) ?? 0,
    }));
}

type Verdict = "helping" | "hurting" | "neutral";

type Row = {
  promptId: string;
  requested: number;
  pipelineExit: number | null;
  verified: number | null;
  required: number | null;
  afterGenreEvidence: number | null;
  final: number;
  counterfactualNoRepair: number;
  lengthGainFromRepair: number;
  v3RepairFill: number;
  recoveryFill: number;
  publishedFromVerifiedV3: boolean;
  publicationAction: string | null;
  evidenceRelaxations: string[];
  recoveryTriggered: boolean;
  recoveryTier: string | null;
  genreEvidenceLost: number | null;
  genreEvidenceAdded: number | null;
  pipelineIdentity: number;
  finalIdentity: number;
  identityDelta: number;
  verdict: Verdict;
  helpingSignals: string[];
  hurtingSignals: string[];
};

function scoreRepair(row: Omit<Row, "verdict" | "helpingSignals" | "hurtingSignals">): {
  verdict: Verdict;
  helpingSignals: string[];
  hurtingSignals: string[];
} {
  const helping: string[] = [];
  const hurting: string[] = [];

  if (row.lengthGainFromRepair >= 3) {
    helping.push(`repair raised published count +${row.lengthGainFromRepair} vs verified-only (${row.counterfactualNoRepair}→${row.final})`);
  }
  if (row.v3RepairFill > 0) {
    helping.push(`genre-aware V3 repair filled ${row.v3RepairFill} track(s)`);
  }
  if (row.publishedFromVerifiedV3 && row.final >= row.requested * 0.85) {
    helping.push(`verified-V3 publication delivered ${row.final}/${row.requested}`);
  }
  if (row.identityDelta > 0.15) {
    helping.push(`identity improved ${(row.pipelineIdentity * 100).toFixed(0)}%→${(row.finalIdentity * 100).toFixed(0)}%`);
  }
  if (row.recoveryFill > 0) {
    helping.push(`constrained recovery added ${row.recoveryFill} track(s)`);
  }

  if (row.lengthGainFromRepair <= -5) {
    hurting.push(`repair net shrink ${row.counterfactualNoRepair}→${row.final} (${row.lengthGainFromRepair})`);
  }
  if (row.pipelineExit != null && row.final < row.pipelineExit - 8 && row.v3RepairFill === 0 && row.recoveryFill === 0) {
    hurting.push(`large post-V3 shrink ${row.pipelineExit}→${row.final} without repair fill`);
  }
  if (row.genreEvidenceLost != null && row.genreEvidenceLost > row.genreEvidenceAdded! + 5) {
    hurting.push(`genre evidence stage lost ${row.genreEvidenceLost} vs added ${row.genreEvidenceAdded ?? 0}`);
  }
  if (row.verified != null && row.verified > row.final + 5 && row.lengthGainFromRepair < 0) {
    hurting.push(`verified=${row.verified} but final=${row.final} — repair stripped more than it restored`);
  }
  if (row.identityDelta < -0.2 && row.lengthGainFromRepair < 3) {
    hurting.push(`identity degraded ${(row.pipelineIdentity * 100).toFixed(0)}%→${(row.finalIdentity * 100).toFixed(0)}% without length gain`);
  }
  if (row.final < row.requested * 0.2 && row.pipelineExit != null && row.pipelineExit >= 3) {
    hurting.push(`severe underfill ${row.final}/${row.requested} despite pipeline exit=${row.pipelineExit}`);
  }

  let verdict: Verdict = "neutral";
  if (helping.length > hurting.length) verdict = "helping";
  else if (hurting.length > helping.length) verdict = "hurting";
  else if (helping.length > 0 && hurting.length === 0) verdict = "helping";
  else if (hurting.length > 0 && helping.length === 0) verdict = "hurting";
  else if (row.lengthGainFromRepair >= 1) verdict = "helping";
  else if (row.lengthGainFromRepair <= -3) verdict = "hurting";

  return { verdict, helpingSignals: helping, hurtingSignals: hurting };
}

async function main(): Promise<void> {
  const env = readFileSync(path.join(ROOT, ".env"), "utf8");
  const token = env.match(/^PLAYLIST_EVAL_TOKEN=(.+)$/m)?.[1]?.replace(/^"|"$/g, "") ?? "";
  const user = env.match(/^SMOKE_SPOTIFY_USER_ID=(.+)$/m)?.[1]?.replace(/^"|"$/g, "") ?? "";

  for (const hp of ["/api/healthz", "/healthz"]) {
    try {
      if ((await fetch(`http://localhost:5000${hp}`, { signal: AbortSignal.timeout(5000) })).ok) break;
    } catch {
      if (hp === "/healthz") throw new Error("API not running on :5000");
    }
  }

  const rows: Row[] = [];

  for (const id of PROMPTS) {
    const p = PLAYLIST_BENCHMARK_PROMPTS.find((x) => x.id === id)!;
    process.stderr.write(`[repair-test] ${id}\n`);
    const res = await fetch("http://localhost:5000/api/generate?audit=1", {
      method: "POST",
      headers: { "content-type": "application/json", "x-kwalify-evaluation-token": token },
      body: JSON.stringify({
        vibe: p.prompt,
        mode: p.mode,
        length: p.length,
        auditMode: true,
        debug: true,
        debugPipeline: true,
        spotifyUserId: user,
      }),
      signal: AbortSignal.timeout(180_000),
    });
    const d = asRecord(await res.json()) ?? {};
    const gd = asRecord(d.generationDiagnostics) ?? {};
    const fin = asRecord(d.finalization) ?? {};
    const sg = asRecord(d.strictGenreEvidence) ?? {};
    const rec = asRecord(gd.recoveryDiagnostics) ?? {};
    const forensics = asRecord(gd.deliveryUnderfillForensics) ?? null;
    const stages = parseStages(forensics);
    const tracks = Array.isArray(d.tracks) ? d.tracks as Array<Record<string, unknown>> : [];

    const intent = buildLockedIntent(p.prompt);
    const lockedFamilies = [...new Set([
      ...intent.genreFamilies,
      intent.primaryGenre,
      intent.primarySubgenre,
      ...intent.subgenreTerms,
    ].filter(Boolean).map((x) => String(x).toLowerCase()))];

    const pipelineExit = num(forensics?.pipelineExitCount)
      ?? stages.find((s) => s.stage === "pipeline_exit_afterDiversity")?.exit
      ?? num(gd.candidatesAfterDiversity);
    const verified = num(sg.verifiedCount);
    const required = num(sg.requiredCount);
    const afterGenreEvidence = num(forensics?.afterGenreEvidenceCount);
    const final = num(d.count) ?? tracks.length;
    const genreAudit = asRecord(forensics?.genreEvidenceAudit);
    const counterfactual = asRecord(genreAudit?.counterfactual);
    const v3RepairFill = num(fin.genreEvidenceV3RepairFillCount) ?? 0;
    const recoveryFill = (num(fin.genreEvidenceHonestConstrainedRecoveryFillCount) ?? 0)
      + (num(fin.genreEvidenceHonestConstrainedV3FillCount) ?? 0);
    const genreStage = stages.find((s) => s.stage === "genre_evidence_guard");
    const counterfactualNoRepair = num(counterfactual?.ifKeptVerifiedOnly) ?? verified ?? pipelineExit ?? final;

    const funnel = asRecord(gd.familyStageFunnel) ?? {};
    const pipelineFunnel = asRecord(funnel.pipeline) ?? asRecord(funnel.scoringInput);
    const finalFunnel = asRecord(funnel.final);
    const pipelineIntentShare = intentShareFromFunnel(pipelineFunnel) ?? intentShareFromFunnel(asRecord(funnel.scoringInput));
    const finalIntentShare = intentShareFromFunnel(finalFunnel);

    const partial: Omit<Row, "verdict" | "helpingSignals" | "hurtingSignals"> = {
      promptId: id,
      requested: p.length,
      pipelineExit,
      verified,
      required,
      afterGenreEvidence,
      final,
      counterfactualNoRepair,
      lengthGainFromRepair: final - counterfactualNoRepair,
      v3RepairFill,
      recoveryFill,
      publishedFromVerifiedV3: fin.publishedFromVerifiedV3Output === true,
      publicationAction: txt(fin.genreEvidencePublicationAction) ?? txt(fin.explicitConstraintPartialReason),
      evidenceRelaxations: Array.isArray(d.evidenceRelaxations) ? d.evidenceRelaxations.map(String) : [],
      recoveryTriggered: gd.recoveryTriggered === true || !!txt(rec.tier),
      recoveryTier: txt(rec.tier),
      genreEvidenceLost: genreStage?.lost ?? null,
      genreEvidenceAdded: genreStage?.added ?? null,
      pipelineIdentity: pipelineIntentShare ?? familyMatchScore(tracks, lockedFamilies),
      finalIdentity: finalIntentShare ?? familyMatchScore(tracks, lockedFamilies),
      identityDelta: 0,
    };
    partial.identityDelta = partial.finalIdentity - partial.pipelineIdentity;

    const scored = scoreRepair(partial);
    rows.push({ ...partial, ...scored });
  }

  const helping = rows.filter((r) => r.verdict === "helping");
  const hurting = rows.filter((r) => r.verdict === "hurting");
  const neutral = rows.filter((r) => r.verdict === "neutral");
  const netLengthGain = rows.reduce((s, r) => s + r.lengthGainFromRepair, 0);

  const falsified = hurting.length > helping.length
    || (hurting.length >= 2 && helping.length <= hurting.length + 1 && netLengthGain < 0);

  const interpretation = falsified
    ? "FALSIFIED — repair stages shrink or fail to restore length on multiple prompts; genre-evidence constrained prefix still dominates thin cases (latin)."
    : helping.length >= hurting.length + 2
      ? "HOLDS — repair stack (verified-V3 publication, confidence-aware fill, constrained recovery) net raises published length on compound prompts."
      : "PARTIALLY TRUE — repair helps on length for most compound prompts but still hurts on thin-supply / genre-guard edge cases.";

  const report = {
    generatedAt: new Date().toISOString(),
    assumption: "Repair is helping more than hurting",
    falsified,
    helping: helping.length,
    hurting: hurting.length,
    neutral: neutral.length,
    netLengthGainVsVerifiedOnly: netLengthGain,
    rows,
    interpretation,
  };

  await mkdir(path.dirname(OUT_JSON), { recursive: true });
  await writeFile(OUT_JSON, JSON.stringify(report, null, 2), "utf8");
  await writeFile(OUT_MD, [
    "# Repair Assumption Test",
    "",
    "**Assumption:** Repair is helping more than hurting",
    "",
    `**Falsified:** ${falsified ? "yes" : "no"} (${helping.length} helping, ${hurting.length} hurting, ${neutral.length} neutral)`,
    `**Net length gain vs verified-only:** ${netLengthGain >= 0 ? "+" : ""}${netLengthGain} tracks aggregate`,
    "",
    "| Prompt | pipeline | verified | final | Δ repair | v3 fill | verdict |",
    "|--------|--------:|--------:|------:|--------:|--------:|:-------:|",
    ...rows.map((r) =>
      `| ${r.promptId} | ${r.pipelineExit ?? "—"} | ${r.verified ?? "—"} | ${r.final} | ${r.lengthGainFromRepair >= 0 ? "+" : ""}${r.lengthGainFromRepair} | ${r.v3RepairFill} | ${r.verdict === "helping" ? "✓" : r.verdict === "hurting" ? "**✗**" : "~"} |`,
    ),
    "",
    ...rows.flatMap((r) => [
      `### ${r.promptId}`,
      ...(r.helpingSignals.length ? ["**Helping:**", ...r.helpingSignals.map((s) => `- ${s}`)] : []),
      ...(r.hurtingSignals.length ? ["**Hurting:**", ...r.hurtingSignals.map((s) => `- ${s}`)] : []),
      ...(r.publicationAction ? [`- publication: \`${r.publicationAction}\``] : []),
      "",
    ]),
    "## Interpretation",
    "",
    interpretation,
  ].join("\n"), "utf8");

  console.log(JSON.stringify({
    falsified: report.falsified,
    helping: report.helping,
    hurting: report.hurting,
    netLengthGain,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
