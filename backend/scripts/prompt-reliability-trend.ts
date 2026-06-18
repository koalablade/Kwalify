/**
 * Prompt reliability trend rollup for ops dashboards (#59, #94).
 *
 * Usage:
 *   npm run report:prompt-reliability-trend -- --dir reports/prompt-reliability
 */

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

type TrendPoint = {
  file: string;
  generatedAt: string | null;
  promptReliabilityScore: number | null;
  averageSurvivalPercent: number | null;
  averageConfidenceScore: number | null;
  failureCount: number | null;
  promptCount: number | null;
};

async function collectReports(rootDir: string): Promise<TrendPoint[]> {
  const points: TrendPoint[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      if (entry === "prompt-reliability-report.json") {
        try {
          const raw = await readFile(full, "utf8");
          const report = JSON.parse(raw) as {
            generatedAt?: string;
            summary?: {
              promptReliabilityScore?: number;
              averageSurvivalPercent?: number;
              averageConfidenceScore?: number;
              failureCount?: number;
            };
            run?: { promptCount?: number };
          };
          points.push({
            file: full,
            generatedAt: report.generatedAt ?? null,
            promptReliabilityScore: report.summary?.promptReliabilityScore ?? null,
            averageSurvivalPercent: report.summary?.averageSurvivalPercent ?? null,
            averageConfidenceScore: report.summary?.averageConfidenceScore ?? null,
            failureCount: report.summary?.failureCount ?? null,
            promptCount: report.run?.promptCount ?? null,
          });
        } catch {
          // skip malformed
        }
      } else {
        await walk(full);
      }
    }
  }

  await walk(rootDir);
  return points.sort((a, b) => String(a.generatedAt).localeCompare(String(b.generatedAt)));
}

function rollingAverage(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dirIdx = args.indexOf("--dir");
  const rootDir = path.resolve(dirIdx >= 0 ? args[dirIdx + 1] ?? "reports/prompt-reliability" : "reports/prompt-reliability");
  const outIdx = args.indexOf("--out");
  const outDir = path.resolve(outIdx >= 0 ? args[outIdx + 1] ?? path.join(rootDir, "trends") : path.join(rootDir, "trends"));

  const points = await collectReports(rootDir);
  const reliabilityScores = points.map((p) => p.promptReliabilityScore).filter((v): v is number => typeof v === "number");
  const survivalScores = points.map((p) => p.averageSurvivalPercent).filter((v): v is number => typeof v === "number");

  const trend = {
    generatedAt: new Date().toISOString(),
    rootDir,
    sampleCount: points.length,
    latest: points.at(-1) ?? null,
    rolling: {
      promptReliabilityScore: rollingAverage(reliabilityScores.slice(-8)),
      averageSurvivalPercent: rollingAverage(survivalScores.slice(-8)),
    },
    points,
  };

  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "prompt-reliability-trend.json");
  await writeFile(outPath, JSON.stringify(trend, null, 2));
  process.stdout.write(`${JSON.stringify({ outPath, sampleCount: points.length, rolling: trend.rolling }, null, 2)}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
