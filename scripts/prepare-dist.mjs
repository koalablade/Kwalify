import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const sourceRoot = "backend";
const outRoot = join("backend", "dist");
const skipped = new Set(["dist", "src"]);

function mirrorDirectories(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || skipped.has(entry.name)) continue;

    const sourcePath = join(dir, entry.name);
    mkdirSync(join(outRoot, relative(sourceRoot, sourcePath)), { recursive: true });
    mirrorDirectories(sourcePath);
  }
}

function copyDataFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const sourcePath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skipped.has(entry.name)) continue;
      copyDataFiles(sourcePath);
      continue;
    }
    if (!entry.name.endsWith(".json")) continue;
    const rel = relative(sourceRoot, sourcePath);
    if (!rel.replace(/\\/g, "/").startsWith("data/")) continue;
    const dest = join(outRoot, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(sourcePath, dest);
  }
}

mkdirSync(outRoot, { recursive: true });
mirrorDirectories(sourceRoot);
copyDataFiles(sourceRoot);

// Copy benchmark JSON used at runtime by eval modules
const benchmarkSrc = join(sourceRoot, "tests", "human-experience-benchmark.json");
const benchmarkDest = join(outRoot, "tests", "human-experience-benchmark.json");
try {
  copyFileSync(benchmarkSrc, benchmarkDest);
} catch {
  // generated separately if missing
}
