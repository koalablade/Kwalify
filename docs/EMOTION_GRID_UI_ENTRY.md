# Emotion Grid — homepage entry (single source of truth)

| Item | Location |
|------|----------|
| **File** | `artifacts/api-server/public/index.html` |
| **Logged-in entry** | `showApp()` → `initEmotionGridUI()` |
| **Home DOM** | `#emotionGridHome` + `#emotionMoodGrid` (5 `.mood-card` buttons) |
| **Scene DOM** | `#emotionScene` + `#emotionSceneObject` (one geometric shape) |
| **Data** | `EMOTION_MOODS` (exactly 5 items) |
| **API stubs** | `#apiStubs` (hidden; playlist/generate only — not shown) |

## Removed from render tree

- Legacy moment compose (`#composeLayer`, vibe input UI)
- World/map chrome (back button, make playlist, streaks, SVG pump heroes)
- Duplicate `world-home` / `mood-grid` CSS blocks

## Not homepage

- `#landingView` — logged-out only
- Cinema layers (`#cinema`, `#cinemaStill`) — hidden when `body.emotion-grid-active`
