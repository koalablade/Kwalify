# Evaluation Layer Audit

Date: 2026-06-15

Scope:
- `backend/scripts/prompt-reliability-benchmark.ts`
- `backend/scripts/prompt-reliability-regression.ts`
- `backend/lib/playlist-evaluation/golden-prompt-regression.json`
- Sample outputs from `reports/prompt-reliability/rca-latest` and `reports/prompt-reliability/regression-rca-latest`

Constraint: no playlist generation behavior was reviewed for changes and no generation behavior was modified.

## Executive Summary

The benchmark and regression framework is useful as a research and debugging tool, but it is not yet trustworthy enough for production-critical regression gating.

The highest-risk issue is that the benchmark blends raw diagnostics with inferred fallback values and optimistic defaults. Missing fields can become `0`, `100`, `false`, or `null` depending on the metric, and some of those defaults make failed or incomplete diagnostics look cleaner than they are. The regression layer is stricter, but it inherits the benchmark's extracted values, so it can only be as trustworthy as the benchmark JSON.

The current maturity classification is **BETA (usable but unstable)**.

It is not production-ready because repeated runs are not guaranteed deterministic, missing diagnostics do not consistently fail closed, trend comparison is shape-fragile, and scoring can remain high for prompts that fail required assertions.

## 1. Benchmark Integrity

### Reproducibility

The benchmark is not guaranteed reproducible from input alone.

Sources of nondeterminism:
- The runner calls a live deployed API (`/api/generate`) rather than a pinned offline fixture or local deterministic generation path.
- It does not pass a benchmark seed.
- `varietyBoost: true` is always sent, which is likely to intentionally alter selection behavior.
- It relies on mutable state outside the report: synced Spotify library contents, user profile caches, deployment version, model/cache state, and server-side rate/time behavior.
- It uses a request timeout (`120000ms` by default). A slow but otherwise successful prompt can become a synthetic generation failure.
- It records local git HEAD in the report, but the benchmark may run against a remote `baseUrl`; the local commit can differ from the deployed commit.

Production risk:
- A future benchmark delta may reflect API latency, deployment mismatch, library drift, cache state, or stochastic selection rather than a code regression.

### Retrieval Counts

Retrieval count extraction is not raw-only:

```ts
const retrievalCount =
  numberValue(promptSurvivability["preFilterPoolSize"]) ??
  numberValue(generationDiagnostics["candidatesSampled"]) ??
  numberValue(intentContractGuard["candidateCountPerStage"] && record(intentContractGuard["candidateCountPerStage"])["retrieval"]);
```

This is an unsafe inference chain. `preFilterPoolSize`, `candidatesSampled`, and `candidateCountPerStage.retrieval` are not guaranteed to mean the same thing. A report consumer cannot tell which source was used.

Impact:
- Same prompt can appear to have changed retrieval behavior when only the source field changed.
- Missing primary diagnostics may be silently replaced by a less precise fallback.

### Structured Retrieval Counts

Structured retrieval count is also source-ambiguous:

```ts
const structuredRetrievalCount =
  numberValue(promptSurvivability["postStructuredRetrievalSize"]) ??
  numberValue(intentContractGuard["subgenreEvidencePoolCount"]) ??
  numberValue(intentContractGuard["subgenreRelatedCount"]) ??
  numberValue(intentContractGuard["subgenrePrimaryCount"]);
```

These fields are not equivalent:
- `postStructuredRetrievalSize` is a stage count.
- `subgenreEvidencePoolCount` is a selected evidence pool count.
- `subgenreRelatedCount` and `subgenrePrimaryCount` are match counters.

Impact:
- The benchmark can report a "structured retrieval count" even when no actual post-stage count was emitted.
- Subgenre starvation attribution may be wrong if the fallback counter is not the same stage.

### Fallback Level Detection

Fallback level is source-ambiguous:

```ts
const fallbackLevelUsed =
  stringValue(intentContractGuard["fallbackLevelUsed"]) ??
  stringValue(generationDiagnostics["fallbackLevel"]);
```

The RCA sample showed values such as `"hardSafe"` appearing as fallback level. That is not the same taxonomy as retrieval fallback levels like `none`, `family`, `adjacent`, or `global`.

Impact:
- Retrieval fallback and finalization fallback are conflated.
- Rankings such as "Most likely to fail" and "Most likely to drift" can attribute finalization behavior to retrieval.

### Missing Raw Data

Several metrics are best-effort inferred when raw data is missing:
- `contractSurvivalPercent` is set equal to `overallIntentSurvival`, not a separate contract survival metric.
- `emotionSurvivalPercent` defaults to `100` if missing.
- `subgenreSurvivalPercent` defaults to `100` if missing.
- `confidenceScore` defaults to `0` if missing.
- `majorGenreLeak` defaults to `false` if strict evidence diagnostics and leak detections are missing.
- `majorEraLeak` defaults to `false` if strict evidence diagnostics and leak detections are missing.
- `convergenceRisk` can be `null`, and the regression evaluator treats missing convergence risk as allowed.

This is the biggest trust issue in the benchmark layer.

Fail-open examples:
- Missing emotion survival becomes perfect emotion survival.
- Missing subgenre survival becomes perfect subgenre survival.
- Missing leak diagnostics become no major leak.
- Missing convergence risk passes the max convergence risk assertion.

Fail-closed example:
- Missing confidence becomes `0`.

The behavior is inconsistent. Some missing diagnostics produce hard failure, while others produce an optimistic pass.

## 2. Regression Correctness

### Strictness

The regression evaluator is strict for:
- generation failure
- major genre leak
- major era leak
- completion below 70%
- track count below `minTrackCount`
- confidence below spec
- survival below spec
- leak count above spec

This is directionally correct.

However, optional spec fields are not fully implemented:
- `maxGenreDrift` exists in the spec type, but is never evaluated.
- `maxEraDrift` exists in the spec type, but is never evaluated.

Production risk:
- The spec advertises drift protections that currently do nothing.
- A prompt can pass regression despite violating optional drift thresholds if those are the only failing dimensions.

### Missing Diagnostics Handling

The regression evaluator trusts the benchmark report shape. It does not validate that required benchmark fields are present and numeric before scoring.

Examples:
- If `row.intent.overallSurvivalPercent` is missing or malformed, arithmetic can produce `NaN`.
- If `row.quality.confidenceScore` is missing or malformed, comparisons can become unreliable.
- If a future benchmark report renames fields, the evaluator may crash or emit misleading results rather than producing a schema failure report.

The previous-run path has a similar problem:
- It expects a previous **regression report**, not a previous **benchmark report**.
- The CLI says `--previous FILE Previous benchmark JSON report for trend deltas`, but the code reads `RegressionReport`.
- If users pass a previous benchmark report, trend comparison will either fail or silently produce no useful deltas depending on shape.

### Severity Classification

Severity classification mostly matches the stated policy:
- generation failure -> critical
- major genre leak -> critical
- major era leak -> critical
- completion below 70% -> critical
- confidence below threshold -> high
- survival below threshold -> high
- underfill between 70% and 90% -> medium
- recovery count over threshold -> medium

But there are inconsistencies:
- `trackCount` below threshold is critical only when completion is below 70%; otherwise medium. This is reasonable, but it duplicates completion failure and inflates failure count.
- `leakCount > maxLeaks` is high only when leaks exceed max by at least 2; otherwise low. If a prompt has `maxLeaks: 2` and actual leaks are `3`, this is low even if the leak is semantically severe.
- `convergenceRisk > maxConvergenceRisk` is always low. A critical convergence risk should not be low impact for a prompt reliability gate.
- Optional emotion/subgenre survival failures are always low, even when the prompt is explicitly subgenre-driven.

Production risk:
- Failure counts and severity totals do not map cleanly to prompt-level risk.
- A prompt with many duplicated low/high failures can look worse than one critical single-point failure.

## 3. Evaluation-Layer Bugs

### Benchmark JSON vs Regression Expectations

Mismatch:
- Benchmark has `quality.majorGenreLeak` and `quality.majorEraLeak`, but these are derived from relaxed strict evidence and leak detections only.
- Regression treats these derived booleans as authoritative critical signals.

Risk:
- If upstream leak diagnostics are missing, benchmark reports `majorGenreLeak: false`, and regression will not catch missing leak evidence as a schema/data-quality failure.

### Missing/Null Diagnostics

Current missing-field behavior is unsafe:
- `emotionSurvivalPercent` missing -> `100`
- `subgenreSurvivalPercent` missing -> `100`
- `majorGenreLeak` missing evidence -> `false`
- `majorEraLeak` missing evidence -> `false`
- `convergenceRisk` missing -> allowed

These should not silently pass in a production-critical evaluator. Missing required diagnostic fields should produce an explicit `diagnostic_missing` failure, with severity based on metric criticality.

### Contract Survival Is Not Contract Survival

The benchmark records:

```ts
const contractSurvivalPercent = overallSurvivalPercent;
```

This means the report's `contractSurvivalPercent` is not a direct contract survival metric. It is an alias of overall survival.

Risk:
- Consumers may think contract enforcement improved or regressed when only overall intent survival moved.
- Root-cause analysis can misattribute failures to contract behavior.

### Dry Run Produces Failure-Like Reports

Dry run calls `extractRow()` with `error: "dry_run"` and empty data, then writes normal reports.

Risk:
- Dry-run outputs look like failed benchmark outputs unless the consumer checks top-level `dryRun`.
- A dry-run report could be accidentally fed into regression and interpreted as catastrophic production failure.

### Report Path Defaults Are Not Composable

Benchmark default output:
- `reports/prompt-reliability/latest`

Regression default input:
- `reports/prompt-reliability/latest/prompt-reliability-report.json`

This is fine.

But the benchmark command exits `1` on failures. In CI, this can prevent the regression command from running unless explicitly chained with failure-tolerant shell logic.

Risk:
- The intended "runs after benchmark execution" flow can be interrupted by the benchmark's non-zero exit before regression reports are produced.

## 4. Scoring Realism

### Prompt Reliability Score

The benchmark score is bounded by `clampScore()`, so it cannot exceed 0-100.

But score realism is uneven:
- A prompt with 30/30 tracks and critical genre leak can still score in the 40s or 50s.
- `rainy night walk` scored 83 but failed because confidence was 66.
- `underground hip hop` scored 72 but failed because survival was 54.
- `deep focus coding` scored 73 in benchmark output and 68 in regression output despite failing required survival.

This means score is not a strict gate. It is a blended health indicator.

Production risk:
- A high score can coexist with a failed assertion.
- Users may focus on score and miss critical fail reasons unless reports clearly separate score from pass/fail.

### Regression Score

Regression score is bounded to 0-100 per prompt. The overall score is the average prompt score.

Good:
- Critical failures apply penalties.
- Completion, survival, confidence, and leak prevention are weighted.

Risks:
- Prompt-level score can remain high despite failed required assertions. Example from generated regression report: `rainy night walk` scored 78 while failing confidence.
- Score is averaged across prompts, so a small number of catastrophic failures can be softened by many decent prompts.
- Failure count and severity are more production-relevant than score, but the headline emphasizes score.

Recommended interpretation:
- Treat score as secondary.
- Treat any critical failure as a failed regression run.

## 5. Stability and Determinism

### Repeated Runs

Repeated benchmark runs can change results because:
- Live API state can change.
- Library/cache state can change.
- Request timeouts can turn slow prompts into failures.
- No seed is passed.
- `varietyBoost` is enabled.
- Remote deployment can differ from local commit.

Regression classification is deterministic for a fixed benchmark JSON and spec file. The benchmark data source is not deterministic.

### File Outputs

For a fixed benchmark report and spec:
- Regression JSON ordering is deterministic because it follows prompt order and deterministic sorting rules.
- Markdown report ordering is deterministic.

Non-deterministic fields:
- `generatedAt`
- paths supplied by CLI
- current benchmark report content

This is acceptable for human reports but weak for byte-for-byte reproducibility.

### Previous Run Comparison

Current trend support is shape-fragile:
- It expects previous input to be a regression report.
- It keys trends by prompt text, not prompt id.
- It does not validate previous report schema version.
- It does not handle prompt renames well.
- It does not compare raw benchmark metrics such as leak count or underfill unless they are represented in the previous regression prompt rows.

Production risk:
- Prompt text edits can break trends.
- Future report shape changes can silently remove deltas.
- Passing a previous benchmark report instead of previous regression report is likely to fail or produce no useful trend.

## 6. Broken Assumptions

1. Same input does not guarantee same metrics.
   The runner uses live API behavior, mutable user/library state, timeout-sensitive requests, and no seed.

2. `contractSurvivalPercent` is assumed to be distinct.
   It is currently an alias for overall survival.

3. Structured retrieval count is assumed to be a single raw stage metric.
   It is selected from multiple non-equivalent fallback fields.

4. Missing leak diagnostics are assumed to mean no leak.
   Missing evidence should be a diagnostic failure, not a clean pass.

5. Missing subgenre/emotion survival is assumed to be 100%.
   This is unsafe for production gating.

6. `fallbackLevelUsed` is assumed to represent one taxonomy.
   It can mix retrieval fallback and finalization hard-safe fallback.

7. Previous run is described as benchmark JSON.
   The evaluator expects previous regression JSON.

8. Optional drift assertions are assumed to work.
   `maxGenreDrift` and `maxEraDrift` are defined but not evaluated.

## 7. Unsafe Inference Points

Unsafe inference points in benchmark extraction:
- `retrievalCount`: `preFilterPoolSize` -> `candidatesSampled` -> `candidateCountPerStage.retrieval`
- `structuredRetrievalCount`: `postStructuredRetrievalSize` -> `subgenreEvidencePoolCount` -> `subgenreRelatedCount` -> `subgenrePrimaryCount`
- `contractSurvivalPercent`: copied from overall survival
- `emotionSurvivalPercent`: missing -> 100
- `subgenreSurvivalPercent`: missing -> 100
- `majorGenreLeak`: missing strict evidence/leak detections -> false
- `majorEraLeak`: missing strict evidence/leak detections -> false
- `convergenceRisk`: missing -> accepted by regression
- `repairCount`: inferred from several possible fields with different meanings
- `recoveryCount`: combines boolean recovery trigger and length of recovery relaxations, which can double-count one recovery event

## 8. Scoring Inconsistencies

1. Benchmark score and pass/fail can disagree strongly.
   A prompt can score above 70 and still fail hard assertions.

2. Regression score and pass/fail can also disagree.
   Failed prompts can still be listed among "most reliable" if their blended score is high.

3. Critical and high failures are counted per metric, not per prompt.
   This inflates failure counts for prompts that fail multiple related checks.

4. Leak count and major leak severity can diverge.
   `leakCount: 3` can be low severity for leak count, while a major genre leak is critical.

5. Convergence risk is underweighted.
   Exceeding max convergence risk is always low severity.

6. Optional subgenre survival is underweighted.
   For subgenre prompts, subgenre survival failure should often be high, not low.

## 9. Regression Logic Risks

This would break in production if left as-is:

- A backend diagnostic rename could silently convert missing leak/survival data into optimistic values.
- A deployment mismatch could produce benchmark regressions unrelated to the current code under review.
- A slow API response could be recorded as a generation failure and fail regression, even if generation would have succeeded.
- A dry-run report could be mistaken for a real benchmark report.
- A previous benchmark report could be supplied to `--previous`, even though the evaluator expects a previous regression report.
- Optional `maxGenreDrift` and `maxEraDrift` thresholds could be trusted by reviewers even though they are not enforced.
- CI could stop after benchmark failure and never generate regression reports unless the command chain explicitly allows benchmark failure.

## 10. Recommended Stabilisation Before Production Gate

No implementation was performed in this audit, but these are the required stabilisation items:

1. Add a benchmark report schema version and evaluator schema validation.
2. Fail closed on missing required diagnostics.
3. Record metric source for any fallback-derived field.
4. Remove optimistic defaults for missing emotion/subgenre/leak/convergence metrics.
5. Separate raw metrics from inferred metrics in JSON.
6. Add deterministic run controls: seed, cache policy, deployment commit verification, and library snapshot id.
7. Disable or explicitly label `varietyBoost` for regression runs.
8. Ensure regression runs even when benchmark exits non-zero.
9. Implement `maxGenreDrift` and `maxEraDrift`, or remove them from the spec.
10. Use prompt id, not prompt text, for trend comparison.
11. Accept previous benchmark reports only if explicitly supported, or change CLI copy to say previous regression report.
12. Make severity configurable per prompt dimension.

## Final Verdict

Classification: **BETA (usable but unstable)**

Why:
- The system is valuable for surfacing failure patterns and has useful reports.
- The regression evaluator is deterministic for a fixed input report.
- However, the benchmark data source is not deterministic, missing diagnostics can pass optimistically, metric extraction uses unsafe fallback chains, optional drift thresholds are not enforced, and trend comparison is shape-fragile.

It is not **PRODUCTION READY** because it cannot yet guarantee that a reported regression is caused by a code change, nor can it guarantee that missing diagnostics fail safely.

It is better than **RESEARCH TOOL ONLY** because it already provides a repeatable report shape, golden assertions, exit-code behavior, and actionable prompt-level failures. But it needs the stabilisation items above before it should block releases.
