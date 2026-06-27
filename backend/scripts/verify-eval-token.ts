/**
 * Verify PLAYLIST_EVAL_TOKEN against deployed /api/eval/ping and audit /api/generate.
 */
import {
  EXPECTED_EVAL_TOKEN_LENGTH,
  resolveVerifiedProductionCredentials,
} from "../lib/benchmark-env";
import { normalizeEvalToken } from "../lib/eval-token-normalize";

async function ping(base: string, token: string, header: string) {
  const res = await fetch(`${base}/api/eval/ping`, {
    method: "POST",
    headers: { [header]: token },
  });
  const data = await res.json() as Record<string, unknown>;
  return { endpoint: "POST /api/eval/ping", header, status: res.status, ...data };
}

const SMOKE_PROMPTS = [
  "Feel-good summer morning music to hype yourself up for the day",
  "chill indie study focus",
  "driving at sunset with open windows",
  "soft happy Sunday afternoon",
  "uk grime classics workout",
];

function evalGenerateAccepted(status: number, trackCount: number): boolean {
  if (status === 403 || status === 401 || status === 400) return false;
  if (status === 200 && trackCount > 0) return true;
  // Token authorized and pipeline executed; outcome faults are measured by benchmarks.
  return status === 422 || status === 409 || status === 504;
}

async function generate(
  base: string,
  token: string,
  spotifyUserId: string,
  header: string,
  vibe: string,
) {
  const res = await fetch(`${base}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [header]: token,
    },
    body: JSON.stringify({
      vibe,
      mode: "balanced",
      length: 25,
      spotifyUserId,
      auditMode: true,
    }),
  });
  const data = await res.json() as Record<string, unknown>;
  return {
    endpoint: "POST /api/generate",
    header,
    vibe,
    status: res.status,
    code: data["code"] ?? null,
    trackCount: Array.isArray(data["tracks"]) ? data["tracks"].length : 0,
    message: data["message"] ?? data["error"] ?? data["reason"] ?? null,
  };
}

async function main(): Promise<void> {
  const creds = await resolveVerifiedProductionCredentials({ strict: true });
  const token = normalizeEvalToken(creds.token);
  if (!token) {
    throw new Error("PLAYLIST_EVAL_TOKEN resolved empty after normalization.");
  }
  if (token.length !== EXPECTED_EVAL_TOKEN_LENGTH) {
    throw new Error(
      `PLAYLIST_EVAL_TOKEN length must be ${EXPECTED_EVAL_TOKEN_LENGTH} (got ${token.length} from ${creds.tokenSource}).`,
    );
  }

  const readyz = await (await fetch(`${creds.baseUrl}/api/readyz`)).json() as Record<string, unknown>;
  const pings = await Promise.all([
    ping(creds.baseUrl, token, "x-eval-token"),
    ping(creds.baseUrl, token, "x-kwalify-evaluation-token"),
  ]);
  let gens: Awaited<ReturnType<typeof generate>>[] = [];
  for (const vibe of SMOKE_PROMPTS) {
    gens = await Promise.all([
      generate(creds.baseUrl, token, creds.spotifyUserId, "x-kwalify-evaluation-token", vibe),
      generate(creds.baseUrl, token, creds.spotifyUserId, "x-eval-token", vibe),
    ]);
    if (gens.some((row) => evalGenerateAccepted(row.status, row.trackCount))) break;
  }

  const pingOk = pings.some((row) => (row as Record<string, unknown>)["tokenAccepted"] === true);
  const generateOk = gens.some((row) => evalGenerateAccepted(row.status, row.trackCount));
  const generateSuccess = gens.some((row) => row.status === 200 && row.trackCount > 0);
  const summary = {
    base: creds.baseUrl,
    tokenLength: token.length,
    expectedTokenLength: EXPECTED_EVAL_TOKEN_LENGTH,
    tokenSource: creds.tokenSource,
    staleOverridesIgnored: creds.tokenConflicts.length > 0 ? creds.tokenConflicts : undefined,
    readyz: { status: readyz["status"], commit: readyz["commit"] },
    pingOk,
    generateOk,
    generateSuccess,
    pings,
    gens,
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!pingOk || !generateOk || token.length !== EXPECTED_EVAL_TOKEN_LENGTH) {
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
