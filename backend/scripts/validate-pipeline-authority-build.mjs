/**
 * Fail CI when dist build is stale relative to Pipeline Authority source.
 *
 * Run: node backend/scripts/validate-pipeline-authority-build.mjs
 */

import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const DIST_CONTROLLER = path.join(REPO_ROOT, "backend/dist/controllers/generation.controller.js");
const SRC_CONTROLLER = path.join(REPO_ROOT, "backend/controllers/generation.controller.ts");

const REQUIRED_DIST_MARKERS = [
  "pipelineAuthority",
  "createPipelineDeliveryBuffer",
  "runTerminalAuthorityValidation",
  "pipelineAuthorityValidation",
];

function main() {
  const violations = [];

  if (!fs.existsSync(DIST_CONTROLLER)) {
    violations.push("backend/dist/controllers/generation.controller.js missing — run npm run build");
  } else {
    const dist = fs.readFileSync(DIST_CONTROLLER, "utf8");
    for (const marker of REQUIRED_DIST_MARKERS) {
      if (!dist.includes(marker)) {
        violations.push(`stale dist: missing marker "${marker}" in generation.controller.js`);
      }
    }
  }

  if (fs.existsSync(SRC_CONTROLLER) && fs.existsSync(DIST_CONTROLLER)) {
    const srcMtime = fs.statSync(SRC_CONTROLLER).mtimeMs;
    const distMtime = fs.statSync(DIST_CONTROLLER).mtimeMs;
    const src = fs.readFileSync(SRC_CONTROLLER, "utf8");
    if (src.includes("pipelineAuthority") && distMtime < srcMtime - 1000) {
      violations.push(
        `stale dist: generation.controller.js is older than generation.controller.ts (dist=${distMtime}, src=${srcMtime})`,
      );
    }
  }

  if (violations.length === 0) {
    console.log(JSON.stringify({ pass: true, violations: [] }));
    return;
  }

  console.error("Pipeline authority build guard FAILED:");
  for (const v of violations) {
    console.error(`  ${v}`);
  }
  console.log(JSON.stringify({ pass: false, violations }));
  process.exitCode = 1;
}

main();
