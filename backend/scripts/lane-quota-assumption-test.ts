/**
 * Test assumption: "Lane quotas are optimal"
 */
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { PLAYLIST_BENCHMARK_PROMPTS } from "../lib/playlist-evaluation/benchmark-prompts";

function repoRoot(): string {
  for (const up of [2, 3]) {
    const candidate = path.resolve(__dirname, ...Array(up).fill(".."));
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
  }
  return path.resolve(__dirname, "..", "..", "..");
}

const ROOT = repoRoot();
const OUT = path.join(ROOT, "reports", "playlist-evaluation", "lane-quota-assumption-test.json");

const PROMPTS = [
  "party-latin-summer",
  "drive-late-garage",
  "gym-2000s-pop-punk",
  "chill-acoustic",
  "party-70s-disco",
] as const;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

async function main(): Promise<void> {
  const env = readFileSync(path.join(ROOT, ".env"), "utf8");
  const token = env.match(/^PLAYLIST_EVAL_TOKEN=(.+)$/m)?.[1]?.replace(/^"|"$/g, "") ?? "";
  const user = env.match(/^SMOKE_SPOTIFY_USER_ID=(.+)$/m)?.[1]?.replace(/^"|"$/g, "") ?? "";

  for (const healthPath of ["/api/healthz", "/healthz"]) {
    try {
      const h = await fetch(`http://localhost:5000${healthPath}`, { signal: AbortSignal.timeout(5000) });
      if (!h.ok) throw new Error("bad health");
      break;
    } catch {
      if (healthPath === "/healthz") throw new Error("API not running");
    }
  }

  const rows: Record<string, unknown>[] = [];

  for (const id of PROMPTS) {
    const p = PLAYLIST_BENCHMARK_PROMPTS.find((x) => x.id === id)!;
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
    const ret = asRecord(gd.candidateRetrieval) ?? {};
    const orch = asRecord(ret.orchestrator) ?? {};
    const supply = asRecord(orch.validCandidateSupply) ?? {};
    const blend = asRecord(orch.blendedIntentPool) ?? {};
    const lanes = asRecord(blend.lanes) ?? {};
    const ff = asRecord(blend.familyFunnel) ?? {};
    const retrieval = asRecord(ret.pipeline) ?? asRecord(gd.retrievalPipeline) ?? {};
    const sourceQuotas = asRecord(retrieval.sourceQuotaPct) ?? asRecord(retrieval.sourceQuotas);

    const strictValid = num(supply.strictValidCount);
    const genreMatch = num(lanes.genre_match);
    const genreEligible = num(ff.genreFitEligibleCount);
    const genreQuota = num(ff.genreLaneQuota);
    const blendedActive = Object.keys(blend).length > 0;

    rows.push({
      promptId: id,
      final: num(d.count),
      strictValid,
      blendedPoolActive: blendedActive,
      lanes: blend.lanes ?? null,
      genreFitEligible: genreEligible,
      genreLaneQuota: genreQuota,
      genreMatchLane: genreMatch,
      quotaUtilization: genreEligible != null && genreQuota != null && genreMatch != null
        ? genreMatch / Math.min(genreEligible, genreQuota)
        : null,
      quotaHeadroom: genreEligible != null && genreQuota != null && genreMatch != null
        ? Math.min(genreEligible, genreQuota) - genreMatch
        : null,
      sourceQuotas,
      orchestratorStrategy: orch.strategy,
      strictStarved: strictValid != null && strictValid < Math.max(5, Math.ceil((p.length ?? 30) * 0.45)),
    });
    process.stderr.write(`[lane-quota-test] ${id} blended=${blendedActive} genre_match=${genreMatch ?? "null"}\n`);
  }

  // Falsification checks
  const checks = {
    blendedSkippedDespiteStarvation: rows.filter((r) =>
      r.strictStarved === true && r.blendedPoolActive === false,
    ),
    quotaUnderfilledWithEligible: rows.filter((r) => {
      const headroom = num(r.quotaHeadroom);
      return headroom != null && headroom > 5;
    }),
    healthyStrictValidNoBlended: rows.filter((r) =>
      r.strictStarved === false && r.blendedPoolActive === false && (num(r.strictValid) ?? 0) > 20,
    ),
    genreLaneTinyDespiteHighStrict: rows.filter((r) =>
      (num(r.strictValid) ?? 0) > 40 && (num(r.genreMatchLane) ?? 999) < 5 && r.blendedPoolActive === true,
    ),
  };

  const falsified = [
    checks.blendedSkippedDespiteStarvation.length > 0,
    checks.quotaUnderfilledWithEligible.length > 0,
    checks.healthyStrictValidNoBlended.length >= 2,
  ].filter(Boolean).length;

  const out = {
    generatedAt: new Date().toISOString(),
    assumption: "Lane quotas are optimal",
    falsified: falsified >= 2,
    checks,
    rows,
    interpretation: falsified >= 2
      ? "FALSIFIED — fixed lane ratios and activation gates do not match per-prompt supply shapes."
      : "Inconclusive — insufficient counter-evidence from sampled prompts.",
  };

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify({ falsified: out.falsified, checks: Object.fromEntries(
    Object.entries(checks).map(([k, v]) => [k, Array.isArray(v) ? v.length : v]),
  ) }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
