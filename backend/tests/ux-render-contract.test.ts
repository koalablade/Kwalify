import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { UX_EMOTIONAL_RENDER_ORDER } from "../lib/ux-render-contract";

const REQUIRED_ORDER = [...UX_EMOTIONAL_RENDER_ORDER];

// This contract enforced consistency between the backend render order and a
// former split frontend (`ui-new/public/pages/ux-view.js` + `ux-schema.js`).
// That frontend was replaced by a single-file `frontend/public/pages/app.js`
// which has no render-order split, so the contract no longer applies. Rather
// than crash with ENOENT (dead test) or assert against files that don't exist,
// we skip cleanly when the legacy frontend is absent.
const LEGACY_FRONTEND_FILES = [
  "ui-new/public/pages/ux-view.js",
  "ui-new/public/pages/ux-schema.js",
];

function resolveSource(relativePath: string): string {
  return join(__dirname, "../../../", relativePath);
}

function readSource(relativePath: string): string {
  return readFileSync(resolveSource(relativePath), "utf8");
}

function legacyFrontendPresent(): boolean {
  return LEGACY_FRONTEND_FILES.every((p) => existsSync(resolveSource(p)));
}

function parseRenderOrderFromSchema(source: string): string[] {
  const match = source.match(
    /export const UX_EMOTIONAL_RENDER_ORDER = (\[[\s\S]*?\]);/
  );
  if (!match) return [];

  return match[1]!
    .replace(/\/\/.*$/gm, "")
    .replace(/['"]/g, "")
    .replace(/[\[\]\s]/g, "")
    .split(",")
    .filter(Boolean);
}

export function runUxRenderContractTests(): {
  passed: number;
  failed: number;
  failures: string[];
} {
  const failures: string[] = [];
  let passed = 0;

  if (!legacyFrontendPresent()) {
    // Legacy split frontend retired — contract not applicable. Skip, don't fail.
    return { passed: 0, failed: 0, failures: [] };
  }

  const uxView = readSource("ui-new/public/pages/ux-view.js");
  const uxSchema = readSource("ui-new/public/pages/ux-schema.js");
  const frontendOrder = parseRenderOrderFromSchema(uxSchema);

  if (frontendOrder.join("→") !== REQUIRED_ORDER.join("→")) {
    failures.push(
      `[ux-contract] ux-schema.js order mismatch: expected ${REQUIRED_ORDER.join(" → ")}, got ${frontendOrder.join(" → ")}`
    );
  } else {
    passed++;
  }

  if (!uxView.includes("const EMOTIONAL_RENDER_ORDER = UX_EMOTIONAL_RENDER_ORDER")) {
    failures.push("[ux-contract] ux-view.js must assign EMOTIONAL_RENDER_ORDER from ux-schema.js");
  } else {
    passed++;
  }

  if (!uxView.includes("EMOTIONAL_RENDER_ORDER.map((key) => slots[key])")) {
    failures.push("[ux-contract] renderEmotionalLayer must map slots in EMOTIONAL_RENDER_ORDER");
  } else {
    passed++;
  }

  if (!uxView.includes("export function getEmotionalRenderOrder()")) {
    failures.push("[ux-contract] getEmotionalRenderOrder export missing");
  } else {
    passed++;
  }

  return { passed, failed: failures.length, failures };
}

if (require.main === module) {
  const result = runUxRenderContractTests();
  if (result.failures.length) {
    console.error(result.failures.join("\n"));
    process.exit(1);
  }
  console.log(`ux-render-contract tests: ${result.passed} passed`);
}
