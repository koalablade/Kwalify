/**
 * Test: "Current required verification ratios are appropriate"
 */
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  computeAdaptiveGenreEvidenceRequiredCount,
  computePartialGenreVerificationScore,
  MIN_GENRE_EVIDENCE_VERIFIED_FLOOR,
  PARTIAL_GENRE_VERIFICATION_PASS_RATIO,
} from "../lib/genre-evidence-guard";
import { STRICT_EXPLICIT_GENRE_EVIDENCE_RATIO } from "../controllers/generation/generation-types";
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
const OUT_JSON = path.join(ROOT, "reports", "playlist-evaluation", "verification-ratio-assumption-test.json");
const OUT_MD = path.join(ROOT, "reports", "playlist-evaluation", "verification-ratio-assumption-test.md");

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function txt(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

type RatioVerdict = "appropriate" | "too_strict" | "too_loose" | "not_binding";

type Row = {
  promptId: string;
  requested: number;
  pipelineExit: number | null;
  verified: number;
  rejected: number;
  required: number;
  baseRequired: number;
  effectiveRatio: number;
  supplyCapped: boolean;
  availableSupply: number | null;
  partialPasses: boolean;
  partialReason: string | null;
  partialScore: number | null;
  confidenceWeightedScore: number | null;
  final: number;
  publicationAction: string | null;
  counterfactualRequiredAt65: number;
  counterfactualRequiredAt75: number;
  wouldPassAt65: boolean;
  wouldPassAt85Nominal: boolean;
  verifiedToRequiredPct: number;
  verdict: RatioVerdict;
  notes: string[];
};

function scoreRatio(row: Omit<Row, "verdict" | "notes" | "wouldPassAt65" | "wouldPassAt85Nominal" | "counterfactualRequiredAt65" | "counterfactualRequiredAt75" | "verifiedToRequiredPct"> & {
  counterfactualRequiredAt65: number;
  counterfactualRequiredAt75: number;
}): { verdict: RatioVerdict; notes: string[] } {
  const notes: string[] = [];
  const verifiedToRequired = row.required > 0 ? row.verified / row.required : 1;
  const wouldPassAt65 = row.verified >= row.counterfactualRequiredAt65;
  const wouldPassAt85 = row.verified >= row.baseRequired;

  if (row.final >= row.requested * 0.85 && (row.verified >= row.required || row.partialPasses)) {
    notes.push(`delivered ${row.final}/${row.requested} with ratio gate satisfied or bypassed`);
    return { verdict: "appropriate", notes };
  }

  if (row.verified >= row.required && row.final >= row.requested * 0.85) {
    notes.push(`verified ${row.verified}≥required ${row.required}; full delivery`);
    return { verdict: "appropriate", notes };
  }

  if (row.partialPasses && row.final >= row.requested * 0.85) {
    notes.push(`partial pass (${row.partialReason}) enabled publication at ${row.final}`);
    return { verdict: "appropriate", notes };
  }

  if (row.verified < row.required && !row.partialPasses && row.final < row.requested * 0.5) {
    if (wouldPassAt65 && row.verified >= MIN_GENRE_EVIDENCE_VERIFIED_FLOOR) {
      notes.push(
        `verified=${row.verified} < required=${row.required} but would pass at 65% ratio (need ${row.counterfactualRequiredAt65})`,
      );
      return { verdict: "too_strict", notes };
    }
    if (row.required <= 2 && row.requested >= 25) {
      notes.push(`required=${row.required} collapsed via supply cap — ratio is tautological, not protective`);
      return { verdict: "too_loose", notes };
    }
    if (row.availableSupply != null && row.availableSupply <= row.verified + 1) {
      notes.push(`supply exhausted (${row.availableSupply}); ratio is not the binding constraint`);
      return { verdict: "not_binding", notes };
    }
    notes.push(`underfill ${row.final}/${row.requested} with verified=${row.verified}/${row.required}`);
    return { verdict: "not_binding", notes };
  }

  if (row.verified >= row.required && row.final < row.requested * 0.5) {
    notes.push(`ratio gate passed (verified ${row.verified}≥${row.required}) but final=${row.final} — binder is post-ratio publication path`);
    return { verdict: "not_binding", notes };
  }

  if (row.required < row.requested * 0.15 && row.supplyCapped && row.verified < MIN_GENRE_EVIDENCE_VERIFIED_FLOOR) {
    notes.push(`supply-capped required=${row.required} on ${row.requested}-track request with verified=${row.verified}`);
    return { verdict: "too_loose", notes };
  }

  if (verifiedToRequired >= 1 && row.rejected > row.verified) {
    notes.push(`high rejection (${row.rejected}) despite passing ratio — taxonomy may be stricter than ratio implies`);
    return { verdict: "appropriate", notes };
  }

  if (row.verified >= row.counterfactualRequiredAt75 && row.verified < row.required) {
    notes.push(`gap between 75% required (${row.counterfactualRequiredAt75}) and current ${row.required} may be over-tight`);
    return { verdict: "too_strict", notes };
  }

  notes.push(
    `verified=${row.verified}/${row.required} (${(verifiedToRequired * 100).toFixed(0)}%), partial=${row.partialPasses}, final=${row.final}`,
  );
  return { verdict: "appropriate", notes };
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
    process.stderr.write(`[ratio-test] ${id}\n`);
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
    const supply = asRecord(asRecord(asRecord(gd.candidateRetrieval)?.orchestrator)?.validCandidateSupply) ?? {};

    const pipelineExit = num(gd.candidatesAfterDiversity);
    const verified = num(sg.verifiedCount) ?? 0;
    const rejected = num(sg.rejectedCount) ?? 0;
    const required = num(sg.requiredCount) ?? 0;
    const baseRequired = num(sg.baseRequiredCount) ?? required;
    const effectiveRatio = num(sg.requiredRatio) ?? STRICT_EXPLICIT_GENRE_EVIDENCE_RATIO;
    const evidenceBasis = num(sg.evidenceBasisCount) ?? pipelineExit ?? verified;
    const availableSupply = num(sg.availableVerifiedSupply) ?? num(sg.confidenceQualifiedSupply);
    const strictValid = num(supply.strictValidCount);
    const final = num(d.count) ?? 0;

    const cf65 = computeAdaptiveGenreEvidenceRequiredCount({
      evidenceBasisCount: evidenceBasis,
      targetLength: p.length,
      baseRatio: PARTIAL_GENRE_VERIFICATION_PASS_RATIO,
      availableVerifiedSupply: availableSupply ?? verified,
      strictValidSupply: strictValid,
    });
    const cf75 = computeAdaptiveGenreEvidenceRequiredCount({
      evidenceBasisCount: evidenceBasis,
      targetLength: p.length,
      baseRatio: 0.75,
      availableVerifiedSupply: availableSupply ?? verified,
      strictValidSupply: strictValid,
    });

    const partial = computePartialGenreVerificationScore({
      verifiedCount: verified,
      requiredCount: required,
      availableVerifiedSupply: availableSupply ?? verified,
    });

    const partialRow = {
      promptId: id,
      requested: p.length,
      pipelineExit,
      verified,
      rejected,
      required,
      baseRequired,
      effectiveRatio,
      supplyCapped: sg.supplyCapped === true,
      availableSupply,
      partialPasses: sg.partialVerificationPasses === true || partial.passes,
      partialReason: txt(sg.partialVerificationReason) ?? partial.reason,
      partialScore: num(sg.partialVerificationScore) ?? partial.score,
      confidenceWeightedScore: num(sg.confidenceWeightedVerificationScore) ?? partial.confidenceWeightedScore,
      final,
      publicationAction: txt(fin.genreEvidencePublicationAction) ?? txt(fin.explicitConstraintPartialReason),
      counterfactualRequiredAt65: cf65.requiredCount,
      counterfactualRequiredAt75: cf75.requiredCount,
    };

    const scored = scoreRatio(partialRow);
    rows.push({
      ...partialRow,
      wouldPassAt65: verified >= cf65.requiredCount,
      wouldPassAt85Nominal: verified >= baseRequired,
      verifiedToRequiredPct: required > 0 ? verified / required : 1,
      ...scored,
    });
  }

  const tooStrict = rows.filter((r) => r.verdict === "too_strict");
  const tooLoose = rows.filter((r) => r.verdict === "too_loose");
  const notBinding = rows.filter((r) => r.verdict === "not_binding");
  const appropriate = rows.filter((r) => r.verdict === "appropriate");

  const falsified = tooStrict.length >= 2
    || (tooStrict.length >= 1 && tooLoose.length >= 1)
    || (notBinding.length >= 4 && tooStrict.length >= 1);

  const interpretation = falsified
    ? "FALSIFIED — required ratios are miscalibrated on multiple prompts: either over-tight vs available verified supply, or supply-capped so low they provide no meaningful guard."
    : notBinding.length >= 3
      ? "PARTIALLY FALSE — ratios are often not the binding constraint; publication/repair path dominates outcomes (cal-001 style collapses happen after ratio passes)."
      : "HOLDS — adaptive 0.85/0.65 ratios align with verified supply and partial-pass bypass delivers appropriately on tested compound prompts.";

  const report = {
    generatedAt: new Date().toISOString(),
    assumption: "Current required verification ratios are appropriate",
    constants: {
      STRICT_EXPLICIT_GENRE_EVIDENCE_RATIO,
      PARTIAL_GENRE_VERIFICATION_PASS_RATIO,
      MIN_GENRE_EVIDENCE_VERIFIED_FLOOR,
    },
    falsified,
    appropriate: appropriate.length,
    tooStrict: tooStrict.length,
    tooLoose: tooLoose.length,
    notBinding: notBinding.length,
    rows,
    interpretation,
  };

  await mkdir(path.dirname(OUT_JSON), { recursive: true });
  await writeFile(OUT_JSON, JSON.stringify(report, null, 2), "utf8");
  await writeFile(OUT_MD, [
    "# Verification Ratio Assumption Test",
    "",
    "**Assumption:** Current required verification ratios are appropriate",
    "",
    `**Constants:** base=${STRICT_EXPLICIT_GENRE_EVIDENCE_RATIO}, partial=${PARTIAL_GENRE_VERIFICATION_PASS_RATIO}, floor=${MIN_GENRE_EVIDENCE_VERIFIED_FLOOR}`,
    "",
    `**Falsified:** ${falsified ? "yes" : "no"} (${appropriate.length} appropriate, ${tooStrict.length} too strict, ${tooLoose.length} too loose, ${notBinding.length} not binding)`,
    "",
    "| Prompt | verified | required | base | eff ratio | partial pass | final | verdict |",
    "|--------|--------:|---------:|-----:|----------:|:------------:|------:|:-------:|",
    ...rows.map((r) =>
      `| ${r.promptId} | ${r.verified} | ${r.required} | ${r.baseRequired} | ${r.effectiveRatio.toFixed(2)} | ${r.partialPasses ? "yes" : "no"} | ${r.final} | ${r.verdict} |`,
    ),
    "",
    ...rows.flatMap((r) => [
      `### ${r.promptId}`,
      `- Counterfactual required @65%: ${r.counterfactualRequiredAt65}, @75%: ${r.counterfactualRequiredAt75}`,
      ...r.notes.map((n) => `- ${n}`),
      "",
    ]),
    "## Interpretation",
    "",
    interpretation,
  ].join("\n"), "utf8");

  console.log(JSON.stringify({
    falsified: report.falsified,
    appropriate: report.appropriate,
    tooStrict: report.tooStrict,
    tooLoose: report.tooLoose,
    notBinding: report.notBinding,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
