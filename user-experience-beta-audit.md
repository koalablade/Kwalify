# User Experience Beta Audit

Date: 2026-06-14

Scope: closed-beta product polish only. No benchmark harness changes, no V3 rewrite, no scoring experiments, and no ranking changes were made.

## Executive Summary

Kwalify is close to beta-ready from a user experience standpoint. The main polish risks were not playlist-generation logic; they were trust and clarity gaps around long-running generation, technical wording in the expanded progress panel, limited result transparency, No Library Mode expectations, and mobile wrapping for dense track controls.

Safe fixes were implemented for the issues that could make beta users think the product froze, misunderstand No Library Mode, or see internal wording.

## Issues And Fixes

### HIGH: Generation Could Still Feel Stuck During Long Runs

Status: Fixed.

File: `frontend/public/pages/app.js`

Issue:

- Backend phases are intentionally coarse, so a real generation can spend meaningful time in the same backend stage.
- The visible progress step now advances monotonically, but the expanded panel still lacked clear long-running reassurance after 30 seconds.
- Users could still interpret a long generation as frozen.

Exact change:

- Added long-running copy after 30 seconds:
  - "Searching your library carefully..."
  - "Finding tracks that match the prompt..."
  - "Building the final playlist..."
  - "Applying quality checks..."
  - "Saving the strongest version..."
- Added a shared `generationElapsedMs()` helper so displayed timing uses the strongest available client/server elapsed time.
- Replaced technical "fast fallback" wording with user-facing quality-check wording.

Risk:

- Low. Display-only copy and timing calculation. No generation, scoring, or polling contract changes.

### MEDIUM: Expanded Progress Panel Exposed Internal Wording

Status: Fixed.

File: `frontend/public/pages/app.js`

Issue:

- The "Show what is happening" panel displayed raw backend phase names such as `loading_library` and `building_profile`.
- That wording makes the app feel unfinished and technical.

Exact change:

- Changed the row label from "Phase" to "Step".
- Display now uses the friendly stage title and `x/5` count.
- Timing row now uses readable reassurance instead of implementation terms.

Risk:

- Low. UI text only.

### MEDIUM: Result Page Needed Lightweight Trust Signals

Status: Fixed.

File: `frontend/public/pages/app.js`

Issue:

- Users could see a completed playlist without quickly understanding whether it matched the prompt, used their library, used Spotify Discovery, or needed recovery assistance.
- Confidence existed, but the product did not translate it into enough plain-language cues.

Exact change:

- Added result trust chips:
  - "Strong Prompt Match", "Good Prompt Match", or "Best Available Match"
  - "Built from Your Library" or "Built from Spotify Discovery"
  - "Recovery Assisted" when fallback/recovery was used
  - "Review Copy Available" or "Spotify Partially Saved" for degraded Spotify saves

Risk:

- Low. Uses existing response fields only. No playlist generation behavior changed.

### MEDIUM: No Library Mode Could Be Misunderstood

Status: Fixed.

File: `frontend/public/pages/app.js`

Issue:

- The toggle explained that No Library Mode does not use liked songs, but did not clearly set the expectation that it is less personalized.
- Beta users could treat it as a better default rather than a broad Spotify discovery mode.

Exact change:

- Toggle copy now says: "Searches Spotify broadly for clear genre prompts - less personalized than your liked songs."
- Result insight now says Spotify-wide results are less personalized than liked-song results.

Risk:

- Low. Copy only.

### MEDIUM: Raw Or Technical Error Text Could Leak To Users

Status: Fixed.

File: `frontend/public/pages/app.js`

Issue:

- `userFacingApiError()` used backend `error`/`message` directly.
- Most backend messages are already friendly, but schema/payload/stack-like strings could still show if a route returned technical details.

Exact change:

- Added a small sanitizer that falls back to friendly copy when the message looks like JSON, stack/trace text, payload wording, or placeholder values like `undefined`/`null`.

Risk:

- Low. Frontend display only. Specific user-friendly backend messages still show.

### LOW: Mobile Generation Details Could Feel Cramped

Status: Fixed.

File: `frontend/public/styles/base.css`

Issue:

- On narrow screens, expanded generation details used a two-column row layout. Long text could feel cramped or clipped.

Exact change:

- Added mobile rules for generation cards and details:
  - tighter padding
  - stacked detail rows
  - left-aligned detail values

Risk:

- Low. CSS-only mobile layout adjustment.

### LOW: Track Feedback Controls Could Overflow On Mobile

Status: Fixed.

File: `frontend/public/styles/base.css`

Issue:

- Result track rows include multiple feedback buttons. On narrow screens, they could crowd the track title/artist area.

Exact change:

- Added wrapping layout for `.track-actions`.
- On mobile, feedback controls move to their own row under the track metadata.
- Feedback note text can wrap instead of forcing horizontal overflow.

Risk:

- Low. CSS-only; no feedback behavior changed.

### LOW: Playlist Quality Signals Are Present But Still Mostly Implicit

Status: Improved, not fully redesigned.

Files:

- `frontend/public/pages/app.js`
- `backend/controllers/generation.controller.ts`

Issue:

- Playlist confidence, recovery usage, no-library mode, and Spotify save degradation are available.
- Before this pass, only confidence and warnings were shown prominently.

Exact change:

- Added trust chips using existing result fields.

Remaining recommendation:

- Later, a non-technical "Why these songs?" user-facing panel could summarize 2-3 reasons without debug mode. This was not implemented because it is a larger product surface and the current task requested safe polish, not a redesigned explanation system.

Risk:

- Low for the implemented chips. Medium for any future explanation panel because it would need careful copy and data selection.

### LOW: Gallery/Shared Playlist Page May Still Expose "Fallback Used"

Status: Documented only.

File: `frontend/public/pages/gallery.js`

Issue:

- Gallery diagnostics can show "fallback used", which is technical and less friendly than "Recovery Assisted".

Proposed minimal fix:

- Replace "fallback used" with "recovery assisted" in gallery cards.

Risk:

- Low. Copy only.

Not implemented:

- This sweep focused on the main generation/result flow first. The gallery is secondary to closed-beta generation UX.

## Error Experience Coverage

Checked:

- Spotify auth failure
- Spotify timeout / unavailable server
- Generation timeout
- No Library Mode failures
- Sync failure
- Delete failure
- Playlist save degradation
- Playlist replacement/feedback failures

Findings:

- Auth errors have clear landing-page messages.
- Generation failures show a clear message and suggestion.
- No Library Mode failures now explain how to recover with broader genre prompts or by turning the mode off.
- Sync and delete failures show retryable messages.
- Playlist save degradation shows "Review ready" and explains that the playlist can still be reviewed locally.

Remaining risk:

- Some feedback button failures are silent after restoring the button. This is LOW because feedback is secondary and should not block playlist use, but a future toast would improve trust.

## Mobile Experience Coverage

Checked:

- Generation page
- Playlist/result page
- Settings/profile dropdown
- Auth/landing flow

Findings:

- Main layout already collapses to one column.
- Navigation hides sync action buttons on smaller screens.
- Generation detail rows and track feedback controls needed wrapping polish and were fixed.

Remaining risk:

- Very long playlist names can still make result cards visually dense, but they are constrained by layout and not a beta blocker.

## Beta Trust Polish

Removed or reduced normal-user exposure to:

- raw backend phase names
- "fast fallback" wording
- unclear No Library Mode expectations
- raw technical error messages

Kept debug-only content behind existing debug mode. No normal-user debug panel was enabled.

## Validation Plan

Required commands after this report:

- `npm run typecheck`
- `npm run build`
