# Human-centric playlist quality evaluation

**Engine status:** FROZEN at V55. This evaluator **measures** output; it does **not** modify generation.

## Purpose

Answer: *"If a real human asked Kwalify for this playlist, would they genuinely enjoy it, play it, save it, and want another?"*

Automated scores are **hypotheses** until validated against human review or beta feedback.

## What it reuses (does not reinvent)

- **Human Curation Score** (`evaluateHumanCurationScore`) — listenability dimensions
- **Independent human-quality verifier** (`verifyIndependentHumanQuality`) — blind misfit detection
- **Prompt expectation parser** (`parsePromptExpectation`) — constraint accounting
- **Beta evidence** (`reports/beta-generations/evidence.jsonl`) — real user generations

## CLI

```bat
npm run eval:human-quality -- report
npm run eval:human-quality -- audit-json path\to\generate-response.json
npm run eval:human-quality -- audit-id REQUEST_ID
npm run eval:human-quality -- review-template REQUEST_ID
npm run eval:human-quality -- corpus
```

Reports written to `reports/human-quality/`.

Human review templates: `reports/human-quality-reviews/`.

## 100-generation forensic diagnosis

The 100-run does **not** create Spotify playlists. It writes tracklists to `reports/human-quality/100-gen/results.jsonl`.

```bat
npm run eval:human-quality:diagnose
npm run eval:human-quality:qa -- --dry-run
npm run eval:human-quality:qa -- --run hq100-6822d2f0
npm run eval:human-quality:qa -- --list
npm run eval:human-quality:qa -- --cleanup
```

`eval:human-quality:qa` screens the JSONL, selects ~12 cases, and creates **new private** Spotify playlists named `Kwalify QA | …`. Dry-run creates none. Cleanup unfollows **only** playlists in `playlist-registry.json`.

Listen on Spotify, fill `reports/human-quality/100-gen/spotify-qa/human-review/*.review.json`, rerun the QA command to compare human vs automation.

Library opportunity is measured from `liked_songs` (not hardcoded). Underfill with HIGH/VERY_HIGH opportunity is treated as candidate/admission failure until disproven. Coherence alone cannot produce CLEARLY_GOOD.

Auth reuses Kwalify: `SPOTIFY_REFRESH_TOKEN`, or a live local session (`DATABASE_URL` + logged-in `playlist-modify-private`). Genome `spotify:oauth-setup` currently requests read scopes only — if create fails with 403, log into the Kwalify app rather than genome OAuth.

Do **not** treat HCS as human quality. Do **not** change the engine from this report.

## Human review workflow

1. Generate playlist (beta user or yourself)
2. Note Reference ID on result page
3. `npm run eval:human-quality -- review-template REQUEST_ID`
4. Fill in `*.review.json` rubric (0–5) + free-text `opinion`
5. Optionally append feedback: `npm run beta:evidence:feedback -- --id REQUEST_ID --verdict bad --opinion "..."`
6. Weekly: `npm run eval:human-quality -- report`

## Rubric (human authority)

| Dimension | 0–5 |
|-----------|-----|
| Human saveability | Would they save it? |
| Moment fidelity | Feels like the requested moment? |
| Musical coherence | One believable playlist? |
| Taste fit | Grounded in user's library taste? |
| Opening quality | First tracks excellent? |
| Tail quality | Ending remains good? |
| Discovery quality | Tasteful surprises? |
| Replayability | Would they return? |
| Overall human quality | Gut check |

**Free text matters more than categories.**

## Automated vs human

The report flags:

- **False alarms** — automated says bad, human says good
- **Blind spots** — automated says good, human says bad

Use these to improve the **evaluator**, not the engine (until repeated failure classes justify investigation).

## Prompt corpus

48 representative prompts across genre, mood, activity, atmosphere, compound, negative constraints, vague, edge cases, and natural phrasing.

Pilot subset (12) for first baseline runs — use existing live harness (`evaluation:playlists`) with audit mode; do not optimize scores.

## Engine change gate

**NONE from this system.**

Engine work requires: repeated evidence → clear failure class → probable root cause → human review confirmation.

## Loop

```
Generate → automated audit → human listens → human reaction
    → compare prediction vs reality → repeated failure class?
    → investigate (not V56) → fix only if evidence-backed → freeze again
```
