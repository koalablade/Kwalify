import { readFileSync } from "fs";
import { join } from "path";
import { UX_EMOTIONAL_RENDER_ORDER } from "../lib/ux-render-contract";

const REQUIRED_ORDER = [...UX_EMOTIONAL_RENDER_ORDER];

function readSource(relativePath: string): string {
  return readFileSync(join(__dirname, "../../../", relativePath), "utf8");
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
