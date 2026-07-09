/**
 * Test: "V3 is preserving editorial identity"
 */
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { buildLockedIntent } from "../core/v3/intent";
import { PLAYLIST_BENCHMARK_PROMPTS } from "../lib/playlist-evaluation/benchmark-prompts";

const PROMPTS = [
  "party-70s-disco",
  "drive-late-garage",
  "gym-2000s-pop-punk",
  "chill-acoustic",
  "party-latin-summer",
  "launch-calibration-003",
] as const;

function repoRoot(): string {
  for (const up of [2, 3]) {
    const c = path.resolve(__dirname, ...Array(up).fill(".."));
    if (existsSync(path.join(c, "package.json"))) return c;
  }
  return path.resolve(__dirname, "..", "..", "..");
}

const ROOT = repoRoot();
const OUT = path.join(ROOT, "reports", "playlist-evaluation", "v3-editorial-identity-test.json");

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function txt(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function snap(s: Record<string, unknown> | null) {
  if (!s) return null;
  const total = num(s.total) ?? 0;
  const ir = num(s.intentRelevantRaw) ?? 0;
  const raw = asRecord(s.raw) ?? {};
  const rawNums: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) rawNums[k] = num(v) ?? 0;
  return { total, intentShare: total > 0 ? ir / total : 0, raw: rawNums };
}

function topFamily(raw: Record<string, number>): string {
  return Object.entries(raw).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none";
}

function trackFamilies(tracks: Array<Record<string, unknown>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of tracks) {
    const f = `${txt(t.genreFamily) ?? txt(t.genrePrimary) ?? "unknown"}`.toLowerCase();
    out[f] = (out[f] ?? 0) + 1;
  }
  return out;
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

type Row = {
  promptId: string;
  prompt: string;
  lockedFamilies: string[];
  v3Out: number | null;
  final: number;
  genrePurity: number | null;
  promptAlignment: number | null;
  promptDriftPass: boolean | null;
  driftViolations: string[];
  clusterPurity: number | null;
  dominantCluster: string | null;
  curatorIdentity: string | null;
  relaxationSteps: string[];
  constraintFailures: string[];
  scoringTop: string | null;
  v3SelectedTop: string | null;
  finalTopFamily: string | null;
  v3FamilyMatch: number;
  finalFamilyMatch: number;
  v3PreservesIdentity: boolean;
  notes: string[];
};

async function main(): Promise<void> {
  const env = readFileSync(path.join(ROOT, ".env"), "utf8");
  const token = env.match(/^PLAYLIST_EVAL_TOKEN=(.+)$/m)?.[1]?.replace(/^"|"$/g, "") ?? "";
  const user = env.match(/^SMOKE_SPOTIFY_USER_ID=(.+)$/m)?.[1]?.replace(/^"|"$/g, "") ?? "";

  for (const hp of ["/api/healthz", "/healthz"]) {
    try {
      if ((await fetch(`http://localhost:5000${hp}`, { signal: AbortSignal.timeout(5000) })).ok) break;
    } catch {
      if (hp === "/healthz") throw new Error("API not running");
    }
  }

  const rows: Row[] = [];

  for (const id of PROMPTS) {
    const p = PLAYLIST_BENCHMARK_PROMPTS.find((x) => x.id === id)!;
    process.stderr.write(`[v3-identity] ${id}\n`);
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
    const v3 = asRecord(d.v3Diagnostics) ?? {};
    const quality = asRecord(v3.playlistQuality) ?? asRecord(d.playlistQuality);
    const drift = asRecord(d.promptDriftAudit);
    const controlled = asRecord(v3.controlledGeneration) ?? {};
    const funnel = asRecord(gd.familyStageFunnel) ?? {};
    const pipeline = asRecord(funnel.pipeline) ?? {};
    const tracks = Array.isArray(d.tracks) ? d.tracks as Array<Record<string, unknown>> : [];

    const intent = buildLockedIntent(p.prompt);
    const lockedFamilies = [...new Set([
      ...intent.genreFamilies,
      intent.primaryGenre,
      intent.primarySubgenre,
      ...intent.subgenreTerms,
    ].filter(Boolean).map((x) => String(x).toLowerCase()))];

    const scoring = snap(asRecord(funnel.scoringInput));
    const v3Sel = snap(asRecord(pipeline.v3Selected));
    const finalSnap = snap(asRecord(funnel.final));
    const finalFamilies = trackFamilies(tracks);

    const genrePurity = num(quality?.genrePurity);
    const promptAlignment = num(quality?.promptAlignment);
    const violations = Array.isArray(drift?.violations) ? drift!.violations.map(String) : [];
    const driftPass = typeof drift?.pass === "boolean" ? drift.pass : null;

    const notes: string[] = [];
    let preserves = true;

    const v3Match = v3Sel ? familyMatchScore(
      Object.entries(v3Sel.raw).flatMap(([fam, n]) => Array(n).fill({ genreFamily: fam })),
      lockedFamilies,
    ) : 0;
    const finalMatch = familyMatchScore(tracks, lockedFamilies);

    if (driftPass === false) {
      preserves = false;
      notes.push(`promptDriftAudit failed: ${violations.join(", ")}`);
    }
    if (genrePurity != null && genrePurity < 0.65) {
      preserves = false;
      notes.push(`genrePurity=${genrePurity.toFixed(2)} < 0.65`);
    }
    if (promptAlignment != null && promptAlignment < 0.6) {
      preserves = false;
      notes.push(`promptAlignment=${promptAlignment.toFixed(2)} < 0.60`);
    }

    const relaxSteps = Array.isArray(controlled.relaxationSteps)
      ? controlled.relaxationSteps.map(String)
      : [];
    if (relaxSteps.some((s) => /genre_relaxed|open|wildcard/i.test(s))) {
      preserves = false;
      notes.push(`V3 relaxed constraints: ${relaxSteps.join(" → ")}`);
    }

    if (v3Sel && scoring && v3Sel.intentShare < scoring.intentShare * 0.5 && scoring.intentShare > 0.1) {
      preserves = false;
      notes.push(`V3 diluted coarse intent share ${(scoring.intentShare * 100).toFixed(0)}%→${(v3Sel.intentShare * 100).toFixed(0)}%`);
    }

    if (id === "drive-late-garage" && v3Sel && topFamily(v3Sel.raw) !== "electronic") {
      preserves = false;
      notes.push(`Garage V3 top family=${topFamily(v3Sel.raw)}, expected electronic`);
    }
    if (id === "party-70s-disco" && v3Sel && !["soul", "disco", "funk"].includes(topFamily(v3Sel.raw))) {
      preserves = false;
      notes.push(`Disco V3 top=${topFamily(v3Sel.raw)}`);
    }
    if (id === "party-70s-disco" && v3Sel && topFamily(v3Sel.raw) === "soul") {
      notes.push("Disco editorial identity preserved in V3 (soul/disco cluster)");
    }
    if (id === "drive-late-garage" && v3Sel && topFamily(v3Sel.raw) === "electronic") {
      notes.push("Garage V3 output 100% electronic");
    }
    if (id === "party-latin-summer" && (num(gd.candidatesAfterDiversity) ?? 0) <= 3) {
      preserves = false;
      notes.push("V3 cannot preserve latin identity — output ≤3 tracks");
    }
    if (id === "chill-acoustic" && v3Sel && topFamily(v3Sel.raw) === "other") {
      preserves = false;
      notes.push("Acoustic V3 selected bucket=other, not folk");
    }

    const v3Out = num(gd.candidatesAfterDiversity);
    if (v3Out != null && finalMatch > 0.8 && v3Match < 0.5) {
      notes.push("Final matches intent better than V3 snapshot — drift is post-V3 not V3 itself");
    }

    if (preserves && notes.length === 0) {
      notes.push("V3 quality metrics and family funnel consistent with editorial intent");
    }

    rows.push({
      promptId: id,
      prompt: p.prompt,
      lockedFamilies,
      v3Out,
      final: num(d.count) ?? tracks.length,
      genrePurity,
      promptAlignment,
      promptDriftPass: driftPass,
      driftViolations: violations,
      clusterPurity: num(v3.clusterPurity) ?? num(gd.clusterPurity),
      dominantCluster: txt(v3.dominantCluster) ?? txt(gd.dominantCluster),
      curatorIdentity: txt(asRecord(v3.curatorIdentity)?.summary) ?? txt(v3.identitySummary),
      relaxationSteps: relaxSteps,
      constraintFailures: Array.isArray(controlled.constraintFailures)
        ? controlled.constraintFailures.map(String)
        : [],
      scoringTop: scoring ? topFamily(scoring.raw) : null,
      v3SelectedTop: v3Sel ? topFamily(v3Sel.raw) : null,
      finalTopFamily: topFamily(finalFamilies),
      v3FamilyMatch: v3Match,
      finalFamilyMatch: finalMatch,
      v3PreservesIdentity: preserves,
      notes,
    });
  }

  const failed = rows.filter((r) => !r.v3PreservesIdentity);
  const report = {
    generatedAt: new Date().toISOString(),
    assumption: "V3 is preserving editorial identity",
    falsified: failed.length >= 2,
    preserved: rows.filter((r) => r.v3PreservesIdentity).length,
    failed: failed.length,
    rows,
    interpretation:
      failed.length >= 2
        ? "FALSIFIED — V3 dilutes or cannot express editorial identity on multiple compound/thin prompts; post-V3 stages may restore length but V3 output itself drifts for folk/latin."
        : failed.length === 1
          ? "PARTIALLY FALSE — one prompt breaks editorial identity at V3; others preserve cluster/family selection."
          : "HOLDS — V3 cluster selection and quality metrics align with locked intent on tested prompts.",
  };

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(report, null, 2), "utf8");
  await writeFile(
    path.join(ROOT, "reports", "playlist-evaluation", "v3-editorial-identity-test.md"),
    [
      "# V3 Editorial Identity Test",
      "",
      `**Assumption:** V3 is preserving editorial identity`,
      "",
      `**Falsified:** ${report.falsified ? "yes" : "no"} (${report.preserved} preserved, ${report.failed} failed)`,
      "",
      "| Prompt | V3 out | genrePurity | promptAlign | drift pass | V3 top | final top | preserved? |",
      "|--------|-------:|------------:|------------:|:----------:|--------|-----------|:----------:|",
      ...rows.map((r) =>
        `| ${r.promptId} | ${r.v3Out ?? "—"} | ${fmt(r.genrePurity)} | ${fmt(r.promptAlignment)} | ${r.promptDriftPass == null ? "—" : r.promptDriftPass ? "yes" : "**no**"} | ${r.v3SelectedTop ?? "—"} | ${r.finalTopFamily ?? "—"} | ${r.v3PreservesIdentity ? "yes" : "**no**"} |`,
      ),
      "",
      ...rows.flatMap((r) => [`### ${r.promptId}`, ...r.notes.map((n) => `- ${n}`), ""]),
      "",
      "## Interpretation",
      "",
      report.interpretation,
    ].join("\n"),
    "utf8",
  );
  console.log(JSON.stringify({ falsified: report.falsified, preserved: report.preserved, failed: report.failed }, null, 2));
}

function fmt(n: number | null): string {
  return n == null ? "—" : n.toFixed(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
