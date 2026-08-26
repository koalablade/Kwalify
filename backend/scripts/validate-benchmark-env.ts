/**
 * CI/local preflight: verify benchmark secrets, token length 21, production acceptance.
 * Usage: npm run validate:benchmark-env
 *
 * Set ALLOW_UNREACHABLE_PRODUCTION=1 to skip (exit 0) when the self-host
 * production URL is down or returns a non-API page. Use that on PR jobs so
 * a powered-off home PC does not fail clone-install-run CI. Scheduled
 * production smoke should leave this unset so a down host still fails.
 */
import {
  EXPECTED_EVAL_TOKEN_LENGTH,
  formatMissingBenchmarkEnv,
  isCiEnvironment,
  validateBenchmarkEnvForCi,
  resolveVerifiedProductionCredentials,
} from "../lib/benchmark-env";
import { appendFileSync } from "node:fs";

function writeGithubOutput(name: string, value: string): void {
  const out = process.env["GITHUB_OUTPUT"];
  if (!out) return;
  appendFileSync(out, `${name}=${value}\n`);
}

function allowUnreachableProduction(): boolean {
  const raw = process.env["ALLOW_UNREACHABLE_PRODUCTION"]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

async function pingProduction(baseUrl: string, token: string): Promise<{
  ok: boolean;
  status?: number;
  tokenAccepted?: boolean;
  error?: string;
  body?: Record<string, unknown>;
}> {
  let pingRes: Response;
  try {
    pingRes = await fetch(`${baseUrl}/api/eval/ping`, {
      method: "POST",
      headers: { "x-kwalify-evaluation-token": token },
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const raw = await pingRes.text();
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return {
      ok: false,
      status: pingRes.status,
      error: `Production did not return JSON from /api/eval/ping (status ${pingRes.status}). The host may be down or serving a placeholder page.`,
    };
  }

  let ping: Record<string, unknown>;
  try {
    ping = JSON.parse(trimmed) as Record<string, unknown>;
  } catch (err) {
    return {
      ok: false,
      status: pingRes.status,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (pingRes.status === 403) {
    return { ok: false, status: 403, body: ping, error: "Production rejected eval token (403)." };
  }

  return {
    ok: ping["tokenAccepted"] === true,
    status: pingRes.status,
    tokenAccepted: ping["tokenAccepted"] === true,
    body: ping,
  };
}

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
    writeGithubOutput("production_reachable", "false");
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.stderr.write(`\n${formatMissingBenchmarkEnv(result.missing)}\n`);
    process.exit(1);
  }

  const creds = await resolveVerifiedProductionCredentials({ strict: true });
  const ping = await pingProduction(creds.baseUrl, creds.token);

  if (!ping.ok) {
    payload.productionAuth = {
      tokenSource: creds.tokenSource,
      tokenLength: creds.token.length,
      expectedTokenLength: EXPECTED_EVAL_TOKEN_LENGTH,
      reachable: false,
      status: ping.status ?? null,
      error: ping.error,
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    // Skip only when the host is down / serving a placeholder page.
    // A real JSON 403 or tokenAccepted:false still fails — secrets are wrong.
    const unreachable = ping.body == null;
    if (allowUnreachableProduction() && unreachable) {
      writeGithubOutput("production_reachable", "false");
      process.stderr.write(
        `\nSkipping live production probe: ${ping.error}\nSet ALLOW_UNREACHABLE_PRODUCTION=0 to fail closed.\n`,
      );
      process.exit(0);
    }
    writeGithubOutput("production_reachable", "false");
    process.stderr.write(`\n${ping.error ?? "Production auth failed."}\n`);
    process.exit(1);
  }

  payload.productionAuth = {
    tokenSource: creds.tokenSource,
    tokenLength: creds.token.length,
    expectedTokenLength: EXPECTED_EVAL_TOKEN_LENGTH,
    tokenAccepted: ping.tokenAccepted === true,
    status: ping.status,
    staleOverridesIgnored: creds.tokenConflicts.length > 0 ? creds.tokenConflicts : undefined,
  };
  payload.ok = ping.tokenAccepted === true && creds.token.length === EXPECTED_EVAL_TOKEN_LENGTH;
  writeGithubOutput("production_reachable", payload.ok ? "true" : "false");

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  if (!payload.ok) {
    process.stderr.write("\nProduction auth failed — sync PLAYLIST_EVAL_TOKEN with production .env.\n");
    process.exit(1);
  }
}

main().catch((err) => {
  writeGithubOutput("production_reachable", "false");
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
