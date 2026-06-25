/**
 * Local-only .env loader for benchmark credential resolution.
 * CI must inject secrets via GITHUB_ENV — never rely on .env in Actions.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { normalizeEvalToken } from "./eval-token-normalize";

let cached: Record<string, string> | null = null;

function projectRoot(): string {
  // backend/dist/lib → repo root (three levels up from compiled output)
  return path.resolve(__dirname, "..", "..", "..");
}

export function readLocalDotEnv(): Record<string, string> {
  if (cached) return cached;
  const envPath = path.join(projectRoot(), ".env");
  const out: Record<string, string> = {};
  if (!existsSync(envPath)) {
    cached = out;
    return out;
  }
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = normalizeEvalToken(value);
  }
  cached = out;
  return out;
}

export function readLocalDotEnvValue(key: string): string | null {
  const value = readLocalDotEnv()[key];
  return value || null;
}
