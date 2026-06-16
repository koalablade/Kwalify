# Security Review

Generated: 2026-06-16

Scope: backend request validation, payload limits, rate limiting, dependency vulnerabilities, unsafe input paths.

## Summary

Kwalify has reasonable baseline protections for the most sensitive generation path: Zod validation on `/api/generate`, a per-user generation rate limit, CORS origin controls, secure production cookies, eval-token gated audit mode, and structured error handling.

The main remaining risks are operational rather than playlist-specific: dependency vulnerabilities, no explicit JSON body size limit, no global IP-level rate limit before authentication/session lookup, and broad diagnostic responses in debug/audit modes.

## Findings

### High: Dependency Audit Has High-Severity Findings

`npm audit --json` reports 5 vulnerabilities:

- 3 high
- 2 moderate

Affected packages include `drizzle-kit`, `esbuild`, `@esbuild-kit/*`, and transitive `form-data`.

Impact: mostly development/build tooling for `drizzle-kit`/`esbuild`, but `form-data` is runtime-relevant if reachable through HTTP clients.

Recommended next step: run a controlled dependency update PR separately, with build/typecheck/smoke and deploy smoke validation.

### Medium: No Explicit JSON Body Size Limit

`express.json()` is used without an explicit `limit`.

Impact: Express defaults are safer than unlimited parsing, but production should make the intended limit explicit.

Recommended next step: set an explicit small JSON limit for API routes, e.g. `64kb` or `128kb`, after verifying all legitimate payloads fit.

### Medium: Rate Limiting Is Generation/User Focused

The strongest visible rate limit is on `/api/generate` and keyed by user id.

Impact: unauthenticated or pre-session endpoints rely more on platform protection and route-specific logic.

Recommended next step: add an IP-level/global lightweight limiter at the edge or app middleware, especially for auth and API routes.

### Medium: Debug/Audit Responses Can Be Large

Debug and audit modes can return rich diagnostics, traces, and candidate information.

Impact: useful for evaluation, but it increases payload size and may expose operational internals if tokens leak.

Recommended next step: keep audit token secret, rotate if exposed, and consider response-size caps for debug traces.

### Low: CORS Is Configured But Depends On Env Correctness

Production CORS uses `APP_URL`/`FRONTEND_URL`.

Impact: safe when configured correctly, risky if wildcard-like settings are introduced later.

Recommended next step: keep production CORS explicit and covered by deploy smoke.

## Strengths

- `/api/generate` validates payload shape with Zod.
- Playlist audit mode requires an eval token.
- Production cookies are secure/httpOnly.
- Canonical host redirect exists in production.
- Health/eval routes are kept independent of DB-backed sessions.
- Request IDs and structured errors are now available for incident triage.

## Recommended Next Steps

1. Fix or justify `npm audit` findings in a dedicated dependency PR.
2. Add explicit JSON/body size limits.
3. Add IP-level rate limiting or confirm the hosting edge provides equivalent protection.
4. Keep audit/debug endpoints token-gated and excluded from public UI flows.
5. Add dependency audit to CI once the current known findings are resolved or accepted.
