/**
 * Experiment persistence — append-only experiment history.
 */

import fs from "node:fs";
import path from "node:path";
import type { ExperimentRecord } from "./types";

function resolveExperimentsDir(): string {
  const candidates = [
    path.join(__dirname, "experiments"),
    path.join(__dirname, "..", "..", "..", "tests", "playlist-quality-benchmark", "experiments"),
    path.join(process.cwd(), "backend", "tests", "playlist-quality-benchmark", "experiments"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return candidates[1]!;
}

function resolveReportsDir(): string {
  const root = path.resolve(__dirname, "..", "..", "..", "..");
  return path.join(root, "reports", "playlist-quality-experiments");
}

export type ExperimentIndexEntry = {
  id: string;
  name: string;
  runAt: string;
  gitCommit: string | null;
  mode: "offline" | "live";
  overallRecommendation: ExperimentRecord["overallRecommendation"];
  promptSuiteVersion: string;
  file: string;
};

export function saveExperimentRecord(record: ExperimentRecord): {
  recordPath: string;
  reportPath: string;
  indexPath: string;
} {
  const experimentsDir = resolveExperimentsDir();
  const reportsDir = resolveReportsDir();
  fs.mkdirSync(experimentsDir, { recursive: true });
  fs.mkdirSync(reportsDir, { recursive: true });

  const recordPath = path.join(experimentsDir, `${record.metadata.id}.json`);
  const reportPath = path.join(reportsDir, `${record.metadata.id}.md`);
  const latestReportPath = path.join(reportsDir, "latest.md");
  const latestRecordPath = path.join(reportsDir, "latest.json");
  const indexPath = path.join(experimentsDir, "index.json");

  fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  fs.writeFileSync(reportPath, `${record.reportMarkdown}\n`);
  fs.writeFileSync(latestReportPath, `${record.reportMarkdown}\n`);
  fs.writeFileSync(latestRecordPath, `${JSON.stringify(record, null, 2)}\n`);

  const index = loadExperimentIndex();
  index.unshift({
    id: record.metadata.id,
    name: record.metadata.name,
    runAt: record.metadata.runAt,
    gitCommit: record.metadata.gitCommit,
    mode: record.metadata.mode,
    overallRecommendation: record.overallRecommendation,
    promptSuiteVersion: record.metadata.promptSuiteVersion,
    file: path.basename(recordPath),
  });
  fs.writeFileSync(indexPath, `${JSON.stringify(index.slice(0, 200), null, 2)}\n`);

  return { recordPath, reportPath, indexPath };
}

export function loadExperimentIndex(): ExperimentIndexEntry[] {
  const indexPath = path.join(resolveExperimentsDir(), "index.json");
  if (!fs.existsSync(indexPath)) return [];
  return JSON.parse(fs.readFileSync(indexPath, "utf8")) as ExperimentIndexEntry[];
}

export function loadExperimentRecord(id: string): ExperimentRecord | null {
  const file = path.join(resolveExperimentsDir(), `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as ExperimentRecord;
}

export function listRecentExperiments(limit = 10): ExperimentIndexEntry[] {
  return loadExperimentIndex().slice(0, limit);
}
