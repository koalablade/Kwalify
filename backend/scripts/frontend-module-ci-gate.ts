/**
 * CI gate: frontend ES modules must not redeclare imported bindings.
 * Prevents blank homepage regressions (duplicate function + import names).
 *
 * Usage: npm run ci:frontend-modules
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const pagesDir = join("frontend", "public", "pages");
const failures: string[] = [];

function parseImportBindings(specifier: string): string[] {
  const bindings: string[] = [];
  for (const part of specifier.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("type ")) continue;
    const asMatch = trimmed.match(/^(\w+)\s+as\s+(\w+)$/);
    if (asMatch) {
      bindings.push(asMatch[2]!);
    } else {
      bindings.push(trimmed.replace(/^type\s+/, "").split(/\s+/)[0]!);
    }
  }
  return bindings;
}

for (const file of readdirSync(pagesDir).filter((name) => name.endsWith(".js"))) {
  const path = join(pagesDir, file);
  const content = readFileSync(path, "utf8");
  const importBlocks = content.matchAll(/import\s*\{([^}]+)\}\s*from\s*["'][^"']+["']/g);
  for (const block of importBlocks) {
    for (const binding of parseImportBindings(block[1] ?? "")) {
      const fnPattern = new RegExp(`function\\s+${binding}\\s*\\(`);
      const constPattern = new RegExp(`(?:const|let|var)\\s+${binding}\\s*=`);
      if (fnPattern.test(content)) {
        failures.push(`${file}: local function '${binding}' conflicts with import binding`);
      }
      if (constPattern.test(content) && binding !== "api") {
        failures.push(`${file}: local '${binding}' conflicts with import binding`);
      }
    }
  }
}

const result = { pass: failures.length === 0, checkedDir: pagesDir, failures };
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failures.length > 0) process.exit(1);
