/**
 * Load repo-root .env into process.env for local `npm start`.
 *
 * Windows launchers already inject .env via PowerShell. Manual/Linux `npm start`
 * previously read only the process environment, so a filled-in .env was ignored.
 *
 * Existing process.env keys win (CI secrets, shell exports). GitHub Actions is
 * skipped so workflows keep injecting secrets via GITHUB_ENV.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type LocalEnvLoadResult = {
  envPath: string;
  missing: boolean;
  appliedKeys: number;
};

function projectRoot(): string {
  const cwd = process.cwd();
  if (existsSync(path.join(cwd, "package.json"))) return cwd;

  const candidates = [
    path.resolve(__dirname, "..", "..", ".."),
    path.resolve(__dirname, "..", ".."),
  ];
  for (const dir of candidates) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
  }
  return cwd;
}

function parseEnvFile(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!;
    let value = m[2]!.trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadLocalEnvFile(): LocalEnvLoadResult {
  const envPath = path.join(projectRoot(), ".env");
  if (process.env["GITHUB_ACTIONS"] === "true" || process.env["CI"] === "true") {
    return { envPath, missing: !existsSync(envPath), appliedKeys: 0 };
  }
  if (!existsSync(envPath)) {
    return { envPath, missing: true, appliedKeys: 0 };
  }

  const parsed = parseEnvFile(readFileSync(envPath, "utf8"));
  let appliedKeys = 0;
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = value;
      appliedKeys += 1;
    }
  }
  return { envPath, missing: false, appliedKeys };
}
