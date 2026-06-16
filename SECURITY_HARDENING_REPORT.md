# Security Hardening Report

Generated: 2026-06-16

## Resolved Vulnerabilities

- Resolved the production/runtime `form-data` advisory by pinning `form-data@4.0.6` through npm overrides and refreshing the lockfile.
- `npm audit --omit=dev` now reports 0 production vulnerabilities.

## Remaining Vulnerabilities

- Full `npm audit` still reports 4 dev-tooling findings:
  - `drizzle-kit` high
  - `esbuild` high
  - `@esbuild-kit/core-utils` moderate
  - `@esbuild-kit/esm-loader` moderate
- These remain because `drizzle-kit` is already at latest `0.31.10`, and npm suggests a risky `drizzle-kit@0.19.1` fix path.

See `reports/security/dependency-audit.md`.

## Mitigations Added

### Request Size Limits

- JSON body limit: `1mb` by default, configurable via `JSON_BODY_LIMIT`.
- URL-encoded body limit: `256kb` by default, configurable via `URLENCODED_BODY_LIMIT`.
- Oversized API payloads return structured `413 PAYLOAD_TOO_LARGE` responses with `requestId`.

### Global IP Rate Limiting

- Added global IP-based limiter.
- Defaults:
  - `GLOBAL_RATE_LIMIT_PER_MINUTE=60`
  - `GLOBAL_RATE_LIMIT_BURST=20`
  - `GLOBAL_RATE_LIMIT_BURST_WINDOW_MS=10000`
- Rejections return structured `429 RATE_LIMITED` with `requestId` and `Retry-After`.
- Health endpoints are exempt so liveness stays available during abuse conditions.

### Security Headers

Added:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- CSP with self defaults, blocked framing/object sources, and Spotify API/account connect allowances.

### Debug/Secret Sanitization

Expanded structured logger redaction for:

- Authorization and eval-token headers
- Spotify access/refresh tokens
- DB connection strings
- session secrets
- Spotify client secret
- eval token
- nested `password`, `clientSecret`, and token fields

No secret values are included in this report. Any secrets pasted into chat or logs should be rotated.

### Cache Safety

- Fallback cache already uses hashed request-pattern keys.
- TTL and max-size behavior are validated by the production validation harness.
- Added cache stats/clear helpers for validation only.

### DoS Resilience

- Large payloads are rejected before route logic.
- Global IP limiter rejects floods before session and generation work.
- Existing generation concurrency limiter handles queue flooding and concurrency exhaustion.
- Existing overload detection/fault isolation handles dependency degradation.

## Validation

Passed:

- `npm run typecheck`
- lints for changed files

Pending final validation after report generation:

- `npm run build`
- `npm run smoke:static`
- final `npm audit`
- `console.log` scan

## Recommended Future Work

1. Rotate any production secrets that were pasted into chat or logs.
2. Resolve remaining `drizzle-kit`/`esbuild` dev-tooling audit findings in a dedicated dependency PR.
3. Run live production validation against `https://kwalify.net` with realistic concurrency and abuse probes.
4. Consider moving global/IP rate limiting to the platform edge if Render or a CDN is added in front of the app.
5. Add security validation to the release checklist after the first clean live baseline.
