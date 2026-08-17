# Kwalify closed beta — user evidence log

**Engine status:** FROZEN at V55 (`5fab771`). Do not change retrieval/scoring/routing from isolated feedback.

**Production candidate:** `v55-committed-world` @ `0b647af` (rollback: `434be42`).

**This is NOT an engineering project.** Do not build analytics dashboards, new telemetry pipelines, or elaborate feedback systems. Existing logs + `requestId` tracing are enough. The goal is **get humans using Kwalify** and write down what you observe.

Use this log for **patterns**, not one-off complaints. Only P0/P1 interrupt beta; P2+ accumulate until weekly review.

---

## What actually matters (qualitative beats benchmarks)

These observations are worth more than another six-prompt benchmark:

- "I didn't know I had to connect Spotify."
- "I didn't understand what Kwalify was asking me to type."
- "I generated a playlist but didn't know what to do next."
- "The playlist was actually good."
- "I wouldn't save this."
- "I expected it to use my liked songs."
- "Why did it choose this song?"
- "I wanted to regenerate but couldn't find how."
- "Great for the first 8 songs then got weird."
- "I couldn't figure out how to replace this track."
- "It was really slow."
- "I wanted to share this."
- "I'd use this again."
- "I don't understand what makes this different from Spotify."

---

## Watch behaviour, not just opinions

Don't only ask whether they liked the playlist. **Watch what they do.**

Strong positive funnel:

**Generate → inspect → play → save → create Spotify playlist → regenerate another → come back later**

| Signal | Meaning |
|--------|---------|
| Saves without being prompted | Strong positive |
| Creates Spotify playlist | Strong positive |
| Generates again unprompted | Strong positive |
| Returns days later | Strong positive |
| Generates once, stares, leaves | Important negative |
| High replacement rate | Possible ranking/world issue (log pattern, don't fix yet) |
| Repeated regenerate same prompt | UX or quality issue (log why) |

Existing instrumentation (`generate_complete` logs, gallery saves, Spotify create, replacement API) is sufficient. **Do not build new dashboards for beta.**

---

## User questions (after they use Kwalify — do not lead)

1. What did you try to make?
2. Did Kwalify understand what you meant?
3. Did the playlist feel like the moment you described?
4. Did you recognise the music as **your** taste?
5. Did the playlist flow well?
6. Were there songs you immediately wanted to remove?
7. Would you save this playlist?
8. Would you use Kwalify again?
9. What was the most annoying thing?
10. What is the **one** thing you would change?

Also capture: desktop or phone, Spotify playlist created (Y/N), saved in gallery (Y/N), regenerated (Y/N), replaced tracks (Y/N).

---

## Automatic capture (after each generation on self-host)

When `KWALIFY_HOST_MODE=selfhost` (or `BETA_EVIDENCE_CAPTURE=1`), successful generations append to:

`reports/beta-generations/evidence.jsonl`

Each line is a self-contained JSON record with: commit, prompt, interpretation, **full track list**, artist diversity, pipeline summary, Spotify status.

**Correlation key:** `generationEvidenceId` = `requestId` (also on result page Reference ID).

### Add your opinion

```bat
npm run beta:evidence:feedback -- --id REQUEST_ID --opinion "First half brilliant, tail drifts."
```

Optional JSON file with ratings / track feedback:

```json
{
  "ratings": { "wouldSave": false, "overall": 6 },
  "trackFeedback": [
    { "position": 7, "verdict": "love", "comment": "Perfect transition." },
    { "position": 12, "verdict": "wrong", "comment": "Too energetic." }
  ]
}
```

### View one record

```bat
npm run beta:evidence:show -- REQUEST_ID
```

### Retroactive capture from saved API JSON

```bat
npm run beta:evidence:from-json -- path\to\generate-response.json
```

No dashboards. No new analytics platform. Append-only files under `reports/` (gitignored).

---

| Field | Value |
|-------|-------|
| **Date** | |
| **User** | (alias only — no unnecessary PII) |
| **Device** | desktop / phone |
| **Prompt** | (user's words) |
| **What they expected** | |
| **What Kwalify did** | (title, track count, honest partial?) |
| **User reaction** | |
| **Problem category** | misunderstanding / wrong world / taste / repetition / opening / tail / sequencing / too short / generic / library limit / UI / expectation / engine / isolated |
| **Severity** | P0 / P1 / P2 / P3 / P4 |
| **Frequency** | first report / 2nd user / pattern |
| **Reproducibility** | yes / no / unknown |
| **Request ID** | (from error or logs — internal only) |
| **Possible root cause** | (hypothesis — verify before building) |
| **Evidence** | (quote, screenshot ref, log line) |
| **Proposed action** | none / investigate / UX fix / ops / engine (requires freeze exit) |

---

## Internal retention (already in product — do not expose to users)

Where available from logs/DB for investigations:

- original prompt, interpreted intent, world/context
- library size, delivered count, generation duration
- Spotify playlist creation success
- save / regenerate / replacement / feedback events

See `docs/closed-beta-runbook.md` for log tracing by `requestId`.

---

## Weekly review checklist

Keep it to one page. No new tooling.

- [ ] Users tested (count)
- [ ] **Behaviour funnel:** generate → play → save → Spotify → regenerate → return (how many completed each step?)
- [ ] Top confusion quotes (copy verbatim)
- [ ] Top failure **classes** (not single playlists)
- [ ] Engine: KEEP FROZEN unless 3+ users hit same systemic issue

---

## Exit engine-freeze only when

- Multiple users report the same playlist-quality failure, **or**
- Telemetry shows systemic failure, **or**
- Repeated real usage exposes weakness benchmarks miss, **or**
- P0 production blocker discovered

Before any engine change, complete:

```
PROBLEM:
EVIDENCE: (users / generations)
IMPACT:
ROOT CAUSE:
EXISTING SOLUTION: (search git history first)
PROPOSED CHANGE:
REGRESSION RISK:
SUCCESS CRITERIA:
```

---

## Feedback channels

- **Users:** footer Feedback link → Google Form (`frontend/public/lib/shared.js`)
- **Structured checklist:** `docs/beta-tester-checklist.md` (optional, after 1st and 5th generation)
- **Do not send** `docs/BETA-TESTER-GUIDE.md` to first uncached testers — say only: *"Go to kwalify.net and try it."*
