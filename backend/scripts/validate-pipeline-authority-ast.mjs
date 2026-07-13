/**
 * AST guard: fail CI if delivery `finalTracks` is mutated outside pipeline-authority.
 *
 * Run: node backend/scripts/validate-pipeline-authority-ast.mjs
 */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const BACKEND = path.join(REPO_ROOT, "backend");

const ALLOWED_MUTATION_FILES = new Set([
  path.normalize("backend/lib/pipeline-authority/delivery-buffer.ts"),
  path.normalize("backend/lib/pipeline-authority/session.ts"),
]);

const FORBIDDEN_MEMBER_OPS = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
]);

const SCAN_FILES = [
  path.join(BACKEND, "controllers", "generation.controller.ts"),
];

/** Frozen baseline — new assignFT call sites require explicit authority review. */
const MAX_ASSIGN_FT_CALL_SITES = 39;

function rel(filePath) {
  return path.relative(REPO_ROOT, filePath).replace(/\\/g, "/");
}

function isAllowedFile(filePath) {
  return ALLOWED_MUTATION_FILES.has(rel(filePath));
}

function isPipelineFinalTracks(node) {
  if (!ts.isPropertyAccessExpression(node)) return false;
  return (
    ts.isIdentifier(node.expression)
    && node.expression.text === "pipeline"
    && node.name.text === "finalTracks"
  );
}

function isExcludedFinalTracksIdentifier(node) {
  const parent = node.parent;
  if (parent && isPipelineFinalTracks(parent)) return true;
  if (parent && ts.isPropertyAccessExpression(parent)) {
    const obj = parent.expression;
    if (ts.isIdentifier(obj)) {
      const host = obj.text;
      if (["pipeline", "cached", "cachedFast", "timeoutFinalTracks", "recovered", "relaxedRecovered"].includes(host)) {
        return true;
      }
      if (host === "finalization" || host === "genCtx") return true;
    }
  }
  if (parent && ts.isBindingElement(parent)) return true;
  if (parent && ts.isParameter(parent)) return true;
  if (parent && ts.isPropertyAssignment(parent) && parent.name === node) return true;
  return false;
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
}

function scanFile(filePath) {
  const violations = [];
  if (isAllowedFile(filePath)) return violations;

  const source = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);

  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text === "finalTracks" && !isExcludedFinalTracksIdentifier(node)) {
      const parent = node.parent;
      if (parent && ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && parent.left === node) {
        violations.push({
          line: lineOf(sourceFile, node),
          kind: "assignment",
          detail: "direct finalTracks assignment outside PipelineDeliveryBuffer",
        });
      }
      if (parent && ts.isPropertyAccessExpression(parent) && parent.expression === node) {
        const op = parent.name.text;
        if (FORBIDDEN_MEMBER_OPS.has(op)) {
          violations.push({
            line: lineOf(sourceFile, node),
            kind: "array_mutation",
            detail: `finalTracks.${op}() outside PipelineDeliveryBuffer`,
          });
        }
      }
      if (parent && ts.isVariableDeclaration(parent) && parent.name === node) {
        violations.push({
          line: lineOf(sourceFile, node),
          kind: "writable_binding",
          detail: "let/var finalTracks binding — use PipelineDeliveryBuffer",
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

function countAssignFtCallSites(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const start = source.indexOf("const delivery = createPipelineDeliveryBuffer");
  const end = source.indexOf("const deliveredTracks = [...delivery.tracks]");
  const block = start >= 0 && end >= 0 ? source.slice(start, end) : source;
  const matches = block.match(/\bassignFT\s*\(/g);
  return matches ? matches.length : 0;
}

function main() {
  const allViolations = [];
  for (const filePath of SCAN_FILES) {
    if (!fs.existsSync(filePath)) continue;
    for (const v of scanFile(filePath)) {
      allViolations.push({ file: rel(filePath), ...v });
    }
    const assignFtCount = countAssignFtCallSites(filePath);
    if (assignFtCount > MAX_ASSIGN_FT_CALL_SITES) {
      allViolations.push({
        file: rel(filePath),
        line: 0,
        kind: "assignFT_baseline",
        detail: `assignFT call sites ${assignFtCount} exceed frozen baseline ${MAX_ASSIGN_FT_CALL_SITES}`,
      });
    }
  }

  if (allViolations.length === 0) {
    console.log(JSON.stringify({ pass: true, violations: [] }));
    return;
  }

  console.error("Pipeline authority AST guard FAILED:");
  for (const v of allViolations) {
    console.error(`  ${v.file}:${v.line} [${v.kind}] ${v.detail}`);
  }
  console.log(JSON.stringify({ pass: false, violations: allViolations }));
  process.exitCode = 1;
}

main();
