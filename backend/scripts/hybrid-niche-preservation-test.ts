/**
 * Test: "Hybrid ranking preserves niche genres"
 */
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { buildLockedIntent } from "../core/v3/intent";
import { PLAYLIST_BENCHMARK_PROMPTS } from "../lib/playlist-evaluation/benchmark-prompts";

const PROMPTS = [
  "party-latin-summer",
  "drive-late-garage",
  "gym-2000s-pop-punk",
  "chill-acoustic",
  "party-70s-disco",
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
const OUT = path.join(ROOT, "reports", "playlist-evaluation", "hybrid-niche-preservation-test.json");

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function txt(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

type Snap = {
  total: number;
  intentRelevant: number;
  offTargetRockIndie: number;
  intentShare: number;
  raw: Record<string, number>;
};

function readSnap(s: Record<string, unknown> | null): Snap | null {
  if (!s) return null;
  const total = num(s.total) ?? 0;
  const intentRelevant = num(s.intentRelevantRaw) ?? 0;
  const offTarget = num(s.offTargetRockIndieRaw) ?? 0;
  const raw = asRecord(s.raw) ?? {};
  const rawNums: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) rawNums[k] = num(v) ?? 0;
  return {
    total,
    intentRelevant,
    offTargetRockIndie: offTarget,
    intentShare: total > 0 ? intentRelevant / total : 0,
    raw: rawNums,
  };
}

function intentFamiliesForPrompt(vibe: string): string[] {
  const intent = buildLockedIntent(vibe);
  return [...new Set([
    ...intent.genreFamilies,
    intent.primaryGenre,
    intent.primarySubgenre,
    ...intent.subgenreTerms,
  ].filter(Boolean).map((x) => String(x).toLowerCase()))];
}

function nicheShareInFinal(tracks: Array<Record<string, unknown>>, families: string[]): number {
  if (tracks.length === 0) return 0;
  let hit = 0;
  for (const t of tracks) {
    const fam = `${txt(t.genreFamily) ?? txt(t.genrePrimary) ?? ""}`.toLowerCase();
    const sub = `${txt(t.primarySubgenre) ?? ""}`.toLowerCase();
    const blob = `${fam} ${sub} ${txt(t.trackName) ?? ""}`.toLowerCase();
    if (families.some((f) => blob.includes(f.replace(/_/g, " ")) || blob.includes(f))) hit++;
  }
  return hit / tracks.length;
}

type Row = {
  promptId: string;
  intentFamilies: string[];
  final: number;
  library: Snap | null;
  scoringInput: Snap | null;
  pipelineScored: Snap | null;
  pipelineV3Selected: Snap | null;
  finalSnap: Snap | null;
  finalNicheShare: number;
  libraryToScoringDelta: number | null;
  scoringToFinalDelta: number | null;
  preserved: boolean;
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
    process.stderr.write(`[niche-test] ${id}\n`);
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
    const funnel = asRecord(gd.familyStageFunnel) ?? {};
    const pipeline = asRecord(funnel.pipeline) ?? {};
    const tracks = Array.isArray(d.tracks) ? d.tracks as Array<Record<string, unknown>> : [];

    const library = readSnap(asRecord(funnel.library));
    const scoringInput = readSnap(asRecord(funnel.scoringInput));
    const pipelineScored = readSnap(asRecord(pipeline.scored));
    const pipelineV3Selected = readSnap(asRecord(pipeline.v3Selected));
    const finalSnap = readSnap(asRecord(funnel.final));
    const intentFamilies = intentFamiliesForPrompt(p.prompt);
    const finalNicheShare = nicheShareInFinal(tracks, intentFamilies);

    const libToScore = library && scoringInput
      ? scoringInput.intentShare - library.intentShare
      : null;
    const scoreToFinal = scoringInput && finalSnap
      ? finalSnap.intentShare - scoringInput.intentShare
      : null;

    const notes: string[] = [];
    let preserved = true;

    if (library && scoringInput && libToScore != null && libToScore < -0.15) {
      preserved = false;
      notes.push(`Hybrid pool drops intent share ${(library.intentShare * 100).toFixed(0)}%→${(scoringInput.intentShare * 100).toFixed(0)}%`);
    }
    if (finalSnap && finalSnap.offTargetRockIndie > finalSnap.intentRelevant && id !== "gym-2000s-pop-punk") {
      preserved = false;
      notes.push(`Final off-target rock/indie (${finalSnap.offTargetRockIndie}) > intent-relevant (${finalSnap.intentRelevant})`);
    }
    if (finalNicheShare < 0.35 && (num(d.count) ?? 0) >= 10) {
      preserved = false;
      notes.push(`Final playlist niche share only ${(finalNicheShare * 100).toFixed(0)}%`);
    }
    if (id === "party-latin-summer" && (scoringInput?.total ?? 0) <= 2) {
      preserved = false;
      notes.push(`Niche genre never reaches hybrid pool (${scoringInput?.total ?? 0} scoring inputs) — failure is pre-ranking classification`);
    }
    if (id === "party-70s-disco" && finalSnap && finalSnap.intentShare >= 0.5) {
      notes.push("Disco niche preserved through to final");
    }
    if (id === "drive-late-garage" && finalNicheShare >= 0.4) {
      notes.push("Garage/electronic niche well represented in final playlist");
    }
    if (preserved && notes.length === 0) {
      notes.push("Intent-relevant share stable or improved through funnel");
    }

    rows.push({
      promptId: id,
      intentFamilies,
      final: num(d.count) ?? tracks.length,
      library,
      scoringInput,
      pipelineScored,
      pipelineV3Selected,
      finalSnap,
      finalNicheShare,
      libraryToScoringDelta: libToScore,
      scoringToFinalDelta: scoreToFinal,
      preserved,
      notes,
    });
  }

  const failed = rows.filter((r) => !r.preserved);
  const report = {
    generatedAt: new Date().toISOString(),
    assumption: "Hybrid ranking preserves niche genres",
    falsified: failed.length >= 2,
    preservedCount: rows.filter((r) => r.preserved).length,
    failedCount: failed.length,
    rows,
    interpretation: failed.length >= 2
      ? "FALSIFIED — hybrid ranking dilutes or never admits niche intent on multiple prompts; reserves help compound prompts but classification starves thin niches first."
      : failed.length === 1
        ? "PARTIALLY FALSE — one thin-niche prompt fails before ranking; others preserve niche through hybrid pool."
        : "HOLDS on tested prompts — intent-relevant share survives library→scoring→final.",
  };

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(report, null, 2), "utf8");
  await writeFile(
    path.join(ROOT, "reports", "playlist-evaluation", "hybrid-niche-preservation-test.md"),
    buildMd(report),
    "utf8",
  );
  console.log(JSON.stringify({ falsified: report.falsified, preserved: report.preservedCount, failed: report.failedCount }, null, 2));
}

function buildMd(report: { falsified: boolean; preservedCount: number; failedCount: number; rows: Row[]; interpretation: string }): string {
  return [
    "# Hybrid Niche Preservation Test",
    "",
    `**Assumption:** Hybrid ranking preserves niche genres`,
    "",
    `**Falsified:** ${report.falsified ? "yes" : "no"} (${report.preservedCount} preserved, ${report.failedCount} failed)`,
    "",
    "| Prompt | lib intent% | scoring intent% | final intent% | final niche% | preserved? |",
    "|--------|------------:|----------------:|--------------:|-------------:|:----------:|",
    ...report.rows.map((r) =>
      `| ${r.promptId} | ${pct(r.library)} | ${pct(r.scoringInput)} | ${pct(r.finalSnap)} | ${(r.finalNicheShare * 100).toFixed(0)}% | ${r.preserved ? "yes" : "**no**"} |`,
    ),
    "",
    ...report.rows.flatMap((r) => [
      `### ${r.promptId}`,
      `- Intent families: \`${r.intentFamilies.join(", ")}\``,
      ...r.notes.map((n) => `- ${n}`),
      r.scoringInput ? `- Scoring pool raw top: ${topFamilies(r.scoringInput.raw)}` : "",
      r.finalSnap ? `- Final raw top: ${topFamilies(r.finalSnap.raw)}` : "",
      "",
    ]),
    "## Interpretation",
    "",
    report.interpretation,
  ].join("\n");
}

function pct(s: Snap | null): string {
  return s ? `${(s.intentShare * 100).toFixed(0)}%` : "—";
}

function topFamilies(raw: Record<string, number>): string {
  return Object.entries(raw)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ") || "none";
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
