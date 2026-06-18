# Generation controller modules

`generation.controller.ts` remains the HTTP router and orchestration entry point. Extracted modules:

| Module | Responsibility |
|--------|----------------|
| `generation-types.ts` | Shared types, side-effect policies, constants |
| `generation-timing.ts` | Pre-V3 timing, production timeline, stage profiler |
| `generation-execution-health.ts` | Duplicate-stage detection and health baselines |
| `generation-session-hydration.ts` | Single-flight session snapshot loading |
| `generation-audit.ts` | Eval token auth for audit mode |
| `generation-recovery.ts` | Recovery guard evaluation |
| `generation-response.ts` | Trust payload for API responses |

Further splits (constraints, finalization, prompt guards) can follow the same pattern.
