/**
 * Experiment metadata — git, version, flags for each benchmark run.
 */

import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { ExperimentMetadata, PromptSuiteSplit } from "./types";
import { getSuiteVersions } from "./prompt-suite-loader";

function tryGit(command: string): string | null {
  try {
    return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export function collectGitMetadata(): {
  gitCommit: string | null;
  gitBranch: string | null;
  gitDirty: boolean | null;
} {
  const gitCommit = process.env.GIT_COMMIT ?? tryGit("git rev-parse HEAD");
  const gitBranch = process.env.GIT_BRANCH ?? tryGit("git rev-parse --abbrev-ref HEAD");
  const status = tryGit("git status --porcelain");
  const gitDirty = status == null ? null : status.length > 0;
  return { gitCommit, gitBranch, gitDirty };
}

export function parseConfigurationFlags(argv: string[]): Record<string, string | boolean | number> {
  const flags: Record<string, string | boolean | number> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--flag")) continue;
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      const eq = next.indexOf("=");
      if (eq >= 0) {
        const key = next.slice(0, eq);
        const value = next.slice(eq + 1);
        flags[key] = value === "true" ? true : value === "false" ? false : Number.isFinite(Number(value)) ? Number(value) : value;
      } else {
        flags[next] = true;
      }
      i += 1;
    }
  }
  if (process.env.KWALIFY_EXPERIMENT_FLAGS) {
    try {
      Object.assign(flags, JSON.parse(process.env.KWALIFY_EXPERIMENT_FLAGS));
    } catch { /* ignore */ }
  }
  return flags;
}

export function buildExperimentMetadata(opts: {
  name: string;
  mode: "offline" | "live";
  suite: PromptSuiteSplit | "all";
  configurationFlags?: Record<string, string | boolean | number>;
}): ExperimentMetadata {
  const git = collectGitMetadata();
  const versions = getSuiteVersions();
  const slug = opts.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return {
    id: `${slug || "experiment"}-${stamp}-${randomBytes(3).toString("hex")}`,
    name: opts.name,
    gitCommit: git.gitCommit,
    gitBranch: git.gitBranch,
    gitDirty: git.gitDirty,
    appVersion: process.env.npm_package_version ?? null,
    runAt: new Date().toISOString(),
    mode: opts.mode,
    configurationFlags: opts.configurationFlags ?? {},
    promptSuiteVersion: versions.promptSuiteVersion,
    datasetVersion: versions.datasetVersion,
    suite: opts.suite,
  };
}
