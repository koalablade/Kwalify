/**
 * Diagnose PLAYLIST_EVAL_TOKEN mismatch (reads env only; no secrets printed).
 */
import {
  EXPECTED_EVAL_TOKEN_LENGTH,
  readEvalToken,
  resolveLiveBenchmarkCredentials,
} from "../lib/benchmark-env";
import { normalizeEvalToken } from "../lib/eval-token-normalize";

async function tryToken(base: string, label: string, token: string) {
  const res = await fetch(`${base}/api/eval/ping`, {
    method: "POST",
    headers: { "x-eval-token": normalizeEvalToken(token) },
  });
  const data = await res.json() as Record<string, unknown>;
  const hint = data["hint"] as Record<string, unknown> | undefined;
  return {
    label,
    len: token.length,
    fingerprint: `${token.slice(0, 4)}…${token.slice(-4)}`,
    status: res.status,
    tokenAccepted: data["tokenAccepted"] === true,
    commit: data["commit"] ?? null,
    expectedLength: hint?.["expectedLength"] ?? null,
    receivedLength: hint?.["receivedLength"] ?? null,
  };
}

async function main(): Promise<void> {
  const base = resolveLiveBenchmarkCredentials({ strict: false });
  const resolved = readEvalToken();
  const token = normalizeEvalToken(resolved.token);
  const readyz = await (await fetch(`${base.baseUrl}/api/readyz`)).json() as Record<string, unknown>;
  const getPing = await (await fetch(`${base.baseUrl}/api/eval/ping`)).json() as Record<string, unknown>;

  const attempts = token ? [await tryToken(base.baseUrl, resolved.source, token)] : [];

  process.stdout.write(`${JSON.stringify({
    base: base.baseUrl,
    readyz: { status: readyz["status"], commit: readyz["commit"], uptimeMs: readyz["uptimeMs"] },
    productionEvalTokenLength: getPing["evalTokenLength"] ?? null,
    expectedTokenLength: EXPECTED_EVAL_TOKEN_LENGTH,
    envTokenLen: token.length,
    envTokenSource: resolved.source,
    staleShellIgnored: resolved.staleShellIgnored,
    staleOverridesIgnored: resolved.tokenConflicts.length > 0 ? resolved.tokenConflicts : undefined,
    attempts,
    anyAccepted: attempts.some((row) => row.tokenAccepted),
  }, null, 2)}\n`);

  process.exit(attempts.some((row) => row.tokenAccepted) ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
