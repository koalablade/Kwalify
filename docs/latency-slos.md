# Generation latency SLOs

Target service levels for library-mode playlist generation on Render (Frankfurt, free/starter tier).

| Library size | p95 target | p99 target | Notes |
|--------------|------------|------------|-------|
| ≤ 1,000 tracks | 35s | 55s | Cold start excluded |
| 1,001–5,000 | 45s | 70s | Primary beta cohort |
| 5,001–10,000 | 60s | 90s | Requires batched DB reads |
| > 10,000 | 75s | 120s | Degraded retrieval input may apply |

Client timeout is aligned at 135s. Measure with `npm run validation:production` and eval-admin stage duration aggregates.

Violations should trigger investigation of: liked-songs load time, genre profile cache miss, V3 pool health, recovery fill loops.
