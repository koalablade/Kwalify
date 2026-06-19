/**
 * CI/local preflight: verify benchmark secrets are present before live runs.
 * Usage: npm run validate:benchmark-env
 */
import {
  formatMissingBenchmarkEnv,
  isCiEnvironment,
  validateBenchmarkEnvForCi,
} from "../lib/benchmark-env";

function main(): void {
  const result = validateBenchmarkEnvForCi();
  const payload = {
    ok: result.ok,
    ci: isCiEnvironment(),
    present: result.present,
    missing: result.missing,
    githubSecretsRequired: ["PLAYLIST_EVAL_TOKEN", "SMOKE_SPOTIFY_USER_ID"],
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  if (!result.ok) {
    process.stderr.write(`\n${formatMissingBenchmarkEnv(result.missing)}\n`);
    process.exit(1);
  }
}

main();
