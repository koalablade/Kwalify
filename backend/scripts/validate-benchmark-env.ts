/**
 * CI/local preflight: verify benchmark secrets, token length 21, production acceptance.
 * Usage: npm run validate:benchmark-env
 */
import {
  EXPECTED_EVAL_TOKEN_LENGTH,
  formatMissingBenchmarkEnv,
  isCiEnvironment,
  validateBenchmarkEnvForCi,
  resolveVerifiedProductionCredentials,
} from "../lib/benchmark-env";

async function main(): Promise<void> {
  const result = validateBenchmarkEnvForCi();
  const payload: Record<string, unknown> = {
    ok: result.ok,
    ci: isCiEnvironment(),
    present: result.present,
    missing: result.missing,
    tokenLength: result.tokenLength,
    expectedTokenLength: EXPECTED_EVAL_TOKEN_LENGTH,
    githubSecretsRequired: ["PLAYLIST_EVAL_TOKEN", "SMOKE_SPOTIFY_USER_ID"],
  };

  if (!result.ok) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.stderr.write(`\n${formatMissingBenchmarkEnv(result.missing)}\n`);
    process.exit(1);
  }

  const creds = await resolveVerifiedProductionCredentials({ strict: true });
  const pingRes = await fetch(`${creds.baseUrl}/api/eval/ping`, {
    method: "POST",
    headers: { "x-kwalify-evaluation-token": creds.token },
  });
  const ping = await pingRes.json() as Record<string, unknown>;

  if (pingRes.status === 403) {
    process.stderr.write("Production rejected eval token (403).\n");
    process.exit(1);
  }

  payload.productionAuth = {
    tokenSource: creds.tokenSource,
    tokenLength: creds.token.length,
    expectedTokenLength: EXPECTED_EVAL_TOKEN_LENGTH,
    tokenAccepted: ping["tokenAccepted"] === true,
    status: pingRes.status,
    staleOverridesIgnored: creds.tokenConflicts.length > 0 ? creds.tokenConflicts : undefined,
  };
  payload.ok = ping["tokenAccepted"] === true && creds.token.length === EXPECTED_EVAL_TOKEN_LENGTH;

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  if (!payload.ok) {
    process.stderr.write("\nProduction auth failed — sync PLAYLIST_EVAL_TOKEN with Render.\n");
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
