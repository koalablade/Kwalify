/**
 * Scene knowledge discovery — compare harvested unknown terms against KB coverage.
 *
 * Usage: npm run discover:scene-gaps
 * Requires DATABASE_URL for live harvest; use --prompts-file for offline review.
 */

import { readFileSync } from "node:fs";
import { SCENE_KNOWLEDGE_ENTRIES, uncoveredPromptTerms } from "../lib/scene-knowledge";

function loadPromptsFromFile(path: string): string[] {
  const raw = readFileSync(path, "utf8");
  return raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

function main(): void {
  const fileArg = process.argv.find((a) => a.startsWith("--prompts-file="))?.split("=")[1];
  const samplePrompts = fileArg
    ? loadPromptsFromFile(fileArg)
    : [
      "Reading Agatha Christie",
      "Tokyo at 3am",
      "Driving through rural France",
      "Berlin warehouse at sunrise",
      "Walking through London at midnight",
      "Blade Runner vibes",
      "late night coding session",
      "moving house playlist",
    ];

  const gaps = new Map<string, { count: number; samples: string[] }>();
  for (const prompt of samplePrompts) {
    for (const term of uncoveredPromptTerms(prompt)) {
      const row = gaps.get(term) ?? { count: 0, samples: [] };
      row.count += 1;
      if (row.samples.length < 3) row.samples.push(prompt.slice(0, 80));
      gaps.set(term, row);
    }
  }

  console.log(JSON.stringify({
    kbEntryCount: SCENE_KNOWLEDGE_ENTRIES.length,
    promptsReviewed: samplePrompts.length,
    uncoveredTerms: [...gaps.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 40)
      .map(([term, meta]) => ({ term, ...meta })),
  }, null, 2));
}

main();
