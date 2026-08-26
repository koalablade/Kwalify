# V37 Autonomous Coverage-Cap Fix

**Baseline:** V36 `cc69adbc3a663c58acf25f8e1aca34aab108db45`
**Branch:** `v37-autonomous-coverage-cap-fix`
**PR:** #11

## Evidence-led finding

V36 identified hard-lock coverage tier caps as the remaining pipeline bottleneck:

- LOW coverage: historical delivery ceiling 12
- MEDIUM coverage: historical delivery ceiling 20
- V36 refill/purity stages could already produce 15–25 validated tracks
- therefore coverage classification could still truncate a downstream-validated playlist

This is a systemic funnel problem, not a genre-specific problem.

## V37 change

`backend/core/editorial/world-coverage.ts`

`getDeliveryCap()` no longer applies the historical LOW=12 or MEDIUM=20 terminal ceilings. LOW/MEDIUM remain coverage classifications used for retrieval/UX, but they no longer discard tracks merely because the candidate pool crossed an old fixed count.

VERY_LOW remains capped at 5 to preserve the existing conservative treatment of genuinely scarce worlds.

The optional `validatedTrackCount` parameter is retained so downstream callers can explicitly communicate proven depth in future stages without reintroducing a tier ceiling.

## Regression coverage

Added `backend/tests/v37-coverage-cap.test.ts` covering:

- LOW 25-track request → 25 cap
- MEDIUM 25-track request → 25 cap
- VERY_LOW remains 5 without validated-depth override
- HIGH remains bounded by requested length
- validated-depth behavior for LOW/MEDIUM

## Expected funnel effect

Before:

`post-purity/refill = 15–25 → coverage cap → delivery = 12/20`

After:

`post-purity/refill = N → coverage classification → delivery can retain N`

Actual live V37 playlist metrics are intentionally not claimed in this report until the fresh-build regression completes.

## Validation status

GitHub CI and coherence regression were triggered automatically by PR #11 and were still running when this report was produced.
