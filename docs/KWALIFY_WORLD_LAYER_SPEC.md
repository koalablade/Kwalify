# Kwalify World Layer — cursor micro-world (Page 2)

**Parent:** [KWALIFY_STYLE_DNA.md](./KWALIFY_STYLE_DNA.md) · [KWALIFY_EMOTIONAL_SCENE_ASSEMBLY.md](./KWALIFY_EMOTIONAL_SCENE_ASSEMBLY.md)  
**Code:** `artifacts/api-server/public/js/world-layer.js` · `#emotionWorld`

---

## Two-page architecture (locked)

| Page | Role | Default? |
|------|------|----------|
| **1 — Entry** | 5 mood grid → tap mood → **scene** (playlist) | Yes — logged-in home |
| **2 — World** | Cursor-reactive emotional field — experiential only | No — opt-in via *Explore mood space* |

> Grid = navigation. World = experience. Never swap them.

---

## Core idea

**Objects exist in a quiet emotional field and respond subtly to cursor presence.**

Not: UI system · game · playground · Spotify Pets characters

Kwalify difference: **object-first** — expression through space, light, silence, movement restraint.

| Pets | Kwalify World |
|------|----------------|
| dog, cat, bird mascots | pump, road, lamp, car, horizon |
| character-first | object-first |
| playful bounce | ambient breathing + proximity only |

---

## Object rules

Each object:

- Static by default  
- Slightly alive via **micro motion** (breathing scale/opacity)  
- Reacts to **cursor proximity only** — no click gamification  

Examples:

- Pump — slight lean toward cursor  
- Road — ribbon subtly shifts  
- Lamp — glow expands softly  
- Car — subtle weight shift  
- Horizon — haze brightens  

---

## Cursor states (only 3)

| State | Distance | Behaviour |
|-------|----------|-----------|
| **Idle** | Far | Still + ambient breath (very subtle) |
| **Near** | Medium | Attraction/tilt, glow +5–10%, slow |
| **Focus** | Close | More present (scale ~1.04), no UI chrome |

Forbidden: menus · tooltips · badges · popups · gamified particles

---

## Entry / exit

- **Enter:** whisper control on home — *Explore mood space* (not hero CTA)  
- **Exit:** tap empty space → return to grid  
- **Optional later:** long-press object → scene (not v1)  

---

## Hard rules

- Do **not** make World the default homepage  
- Do **not** add navigation chrome inside World  
- Do **not** clone Spotify Pets layout — borrow **proximity magic**, not mascots  

---

## Override

> If it feels like a toy, reduce motion. If it feels like a dashboard, remove UI. If it feels like Pets, replace character energy with object silence.
