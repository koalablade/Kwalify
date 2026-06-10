import { mkdirSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

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

mkdirSync(outRoot, { recursive: true });
mirrorDirectories(sourceRoot);
