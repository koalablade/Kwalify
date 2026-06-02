# Pets UI — homepage entry (single source of truth)

**Visual language:** Spotify Pets–inspired soft illustrations — rounded, friendly, one object per mood. Not industrial/geometric UI.

## Two screens only

| Screen | DOM | Interaction |
|--------|-----|-------------|
| **Home** | `#emotionGridHome` → `#emotionMoodGrid` (5 × `.pets-card`) | Tap card |
| **Emotion** | `#emotionScene` → `#emotionSceneObject` (one `.pets-illust--hero`) | Tap anywhere → home |

## File & entry

| Item | Location |
|------|----------|
| **File** | `artifacts/api-server/public/index.html` |
| **Shell** | `#appView.pets-shell` (root-level, not inside `.page`) |
| **Logged-in** | `showApp()` → `body.pets-app` + `initEmotionGridUI()` |
| **Logged-out** | `#landingView` inside `.page` |
| **Data** | `EMOTION_MOODS` + `PETS_ILLUST_DEFS` (`pump`, `road`, `lamp`, `car`, `horizon`) |
| **Motion** | Fade + gentle scale (`pets-scene-active`, `pets-hero-in`) |
| **API stubs** | `#apiStubs` (hidden; playlist backend only) |

## Hidden when logged in

Entire `.page` (header, landing, load overlay), cinema layers, moment/world legacy chrome.
