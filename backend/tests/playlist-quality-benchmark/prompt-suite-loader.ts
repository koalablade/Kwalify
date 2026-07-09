/**
 * Prompt suite loader — training / validation / stress splits with anti-overfitting guardrails.
 */

import fs from "node:fs";
import path from "node:path";
import type {
  HallOfFameEntry,
  LibraryDependency,
  PromptSuiteEntry,
  PromptSuiteManifest,
  PromptSuiteSplit,
} from "./types";

const HOF_DIR = resolveDatasetDir("playlist-hall-of-fame");

function resolveDatasetDir(name: string): string {
  const candidates = [
    path.join(__dirname, "..", name),
    path.join(__dirname, "..", "..", "..", "tests", name),
    path.join(process.cwd(), "backend", "tests", name),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "prompt-suite-manifest.json"))) return dir;
    if (fs.existsSync(path.join(dir, "entries.json"))) return dir;
  }
  return candidates[1]!;
}

export function loadPromptSuiteManifest(): PromptSuiteManifest {
  const raw = fs.readFileSync(path.join(HOF_DIR, "prompt-suite-manifest.json"), "utf8");
  return JSON.parse(raw) as PromptSuiteManifest;
}

function inferLibraryDependency(entry: HallOfFameEntry): LibraryDependency {
  if (entry.category === "hard_activity" || entry.difficulty === "hard") return "high";
  if (entry.category === "functional" || entry.category === "emotional_specific") return "medium";
  return "low";
}

function enrichEntry(
  entry: HallOfFameEntry,
  suite: PromptSuiteSplit,
  manifest: PromptSuiteManifest,
): PromptSuiteEntry {
  return {
    ...entry,
    suite,
    libraryDependency:
      entry.libraryDependency ??
      manifest.libraryDependency[entry.id] ??
      inferLibraryDependency(entry),
  };
}

export function loadPromptSuiteEntries(suite: PromptSuiteSplit): PromptSuiteEntry[] {
  const manifest = loadPromptSuiteManifest();
  const file = manifest.splits[suite].file;
  const raw = fs.readFileSync(path.join(HOF_DIR, file), "utf8");
  const entries = JSON.parse(raw) as HallOfFameEntry[];
  return entries.map((entry) => enrichEntry(entry, suite, manifest));
}

export function loadAllPromptSuiteEntries(suites: PromptSuiteSplit[]): PromptSuiteEntry[] {
  return suites.flatMap((suite) => loadPromptSuiteEntries(suite));
}

export function listPromptSuiteSplits(): PromptSuiteSplit[] {
  return Object.keys(loadPromptSuiteManifest().splits) as PromptSuiteSplit[];
}

export function isTuningAllowed(suite: PromptSuiteSplit): boolean {
  return loadPromptSuiteManifest().splits[suite].tuningAllowed;
}

export function getSuiteVersions(): { promptSuiteVersion: string; datasetVersion: string } {
  const manifest = loadPromptSuiteManifest();
  return {
    promptSuiteVersion: manifest.promptSuiteVersion,
    datasetVersion: manifest.datasetVersion,
  };
}
