/** Diagnose PLAYLIST_EVAL_TOKEN mismatch (reads .env only; no secrets printed). */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = (process.env.SMOKE_BASE_URL ?? "https://kwalify.net").replace(/\/+$/, "");

function readEnvToken() {
  const envPath = path.join(root, ".env");
  if (!existsSync(envPath)) return null;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    if (!line.startsWith("PLAYLIST_EVAL_TOKEN=")) continue;
    return line.slice("PLAYLIST_EVAL_TOKEN=".length);
  }
  return null;
}

function variants(raw) {
  const out = new Set();
  if (!raw) return [];
  out.add(raw);
  out.add(raw.trim());
  out.add(raw.trim().replace(/^["']+|["']+$/g, ""));
  out.add(raw.trim().replace(/\r?\n/g, ""));
  return [...out].filter(Boolean);
}

async function tryToken(label, token) {
  const res = await fetch(`${base}/api/eval/ping`, {
    method: "POST",
    headers: { "x-eval-token": token },
  });
  const data = await res.json();
  return {
    label,
    len: token.length,
    fingerprint: `${token.slice(0, 4)}…${token.slice(-4)}`,
    status: res.status,
    tokenAccepted: data.tokenAccepted === true,
    commit: data.commit ?? null,
  };
}

const raw = readEnvToken();
if (!raw) {
  console.error("No PLAYLIST_EVAL_TOKEN in .env");
  process.exit(2);
}

const readyz = await (await fetch(`${base}/api/readyz`)).json();
const results = [];
for (const [index, token] of variants(raw).entries()) {
  results.push(await tryToken(`variant-${index}`, token));
}

console.log(JSON.stringify({
  base,
  readyz: { status: readyz.status, commit: readyz.commit, uptimeMs: readyz.uptimeMs },
  envTokenLen: raw.length,
  envTokenTrimLen: raw.trim().length,
  attempts: results,
  anyAccepted: results.some((row) => row.tokenAccepted),
}, null, 2));

process.exit(results.some((row) => row.tokenAccepted) ? 0 : 1);
