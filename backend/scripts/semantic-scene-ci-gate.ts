/**
 * CI gate for semantic scene benchmark thresholds.
 *
 * Usage: npm run ci:semantic-scenes
 */

import { execSync } from "node:child_process";

function main(): void {
  try {
    execSync("node backend/dist/scripts/semantic-scene-benchmark.js", { stdio: "inherit" });
    console.log("semantic scene CI gate passed");
  } catch {
    console.error("semantic scene CI gate failed");
    process.exit(1);
  }
}

main();
