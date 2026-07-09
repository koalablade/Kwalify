import fs from "node:fs";
import path from "node:path";
import type { OpeningCuratorV2Prompt } from "./types";

function resolveDir(): string {
  const candidates = [
    path.join(__dirname),
    path.join(__dirname, "..", "..", "..", "tests", "opening-curator-v2-benchmark"),
    path.join(process.cwd(), "backend", "tests", "opening-curator-v2-benchmark"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "prompts.json"))) return dir;
  }
  return candidates[1]!;
}

export function loadOpeningCuratorV2BenchmarkPrompts(): OpeningCuratorV2Prompt[] {
  const raw = fs.readFileSync(path.join(resolveDir(), "prompts.json"), "utf8");
  return JSON.parse(raw) as OpeningCuratorV2Prompt[];
}

export function loadPromptsByCategory(
  category: OpeningCuratorV2Prompt["category"],
): OpeningCuratorV2Prompt[] {
  return loadOpeningCuratorV2BenchmarkPrompts().filter((p) => p.category === category);
}
