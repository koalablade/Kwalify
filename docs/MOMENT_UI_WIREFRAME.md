# Kwalify — Pet-style wireframe (pixel-level)

Single-screen product. No engine feel. **Type → click → receive playlist.**

**Visual system (10 scenes):** [VISUAL_SYSTEM_GUIDE.md](./VISUAL_SYSTEM_GUIDE.md) · **Principles:** [KWALIFY_DESIGN_SYSTEM.md](./KWALIFY_DESIGN_SYSTEM.md)

---

## Full-screen canvas (desktop = mobile logic)

```
┌──────────────────────────────────────┐
│        [ BACKGROUND SCENE ]          │  z-index 0 — one image/video only
│        [ subtle dark overlay ]       │  z-index 1 — readability only
│                                      │
│      What moment are you in?         │  z-index 2 — input layer
│      ________________________        │
│      petrol station 2am              │  chips (whisper)
│      late night driving              │
│      sunset walk alone               │
│                                      │
│        [ Make playlist → ]           │  one primary action
└──────────────────────────────────────┘
```

Everything centered. Lots of vertical space. Nothing hugs screen edges.

---

## Three layers only

| Layer | Rule |
|-------|------|
| **1. Background** | One emotional world; no CSS filters on scene; no stacked FX |
| **2. Input** | Centered; never blurred; Inter only |
| **3. Action** | One button on hero; no secondary CTAs on canvas |

No fourth “system” layer (progress, analysis, atmosphere stacks).

---

## Flow (Spotify Pets parallel)

| Pets | Kwalify |
|------|---------|
| Choose pet | Type moment |
| Pet reacts | Scene opacity shifts (~18% → ~38%) |
| Get playlist | Get playlist (same screen) |

### Step 1 — Arrival

Empty emotional space + prompt. No onboarding copy.

### Step 2 — Input

User types. Scene matches mood (debounced swap). **No loading UI.**

### Step 3 — Action

**Make playlist →** → button **Making playlist…**; overlay slightly darker; scene holds. **Same screen.** 0.8–1.5s max.

### Step 4 — Result (one reveal)

| Zone | Content |
|------|---------|
| Top | Emotional title (refined from user’s moment text) |
| Middle | Playlist preview (5 tracks) — **primary focus** |
| Background | Full-bleed still @ 100% |
| Bottom | Play on Spotify · Try another moment |

Fade only (200–400ms). No credits sequence.

---

## Typography & motion

- **Font:** Inter only; large input (`clamp(22px, 5.5vw, 30px)`).
- **Result title:** light positive letter-spacing (`~0.02em`).
- **Motion:** opacity fades + optional 300ms scene crossfade (non-moment instant).
- **Forbidden:** bounce, blur fog, multi-stage transitions, “processing” language.

---

## Colour

- UI neutral: off-black `#060608`, white at stepped opacity.
- Accent: Spotify green on **one** CTA.
- Emotion comes from **background**, not UI chrome.

---

## Must not reintroduce

Thinking / locked / reveal engines · cinematic overlays · blur on input · vignette/grain stacks · AI explanation panels · DJ stages.

---

## Implementation map (`index.html`)

| Spec | Implementation |
|------|----------------|
| Overlay | `#momentCanvasOverlay` |
| Typing scene | `body.moment-typing` |
| States | `moment-home` / `loading` / `result` |
| Title | `_refinedMomentTitle()` |
| Preview | `#momentPlaylistPreview` |
| Tune hidden on canvas | `.settings-whisper` hidden in moment-app |

---

## Build order

1. This wireframe in code (done iteratively).
2. Regenerate stills per [VISUAL_SYSTEM_GUIDE.md](./VISUAL_SYSTEM_GUIDE.md).
3. Figma optional — spacing only, not art.
