# Kwalify object UI style lock

**Brand DNA:** [KWALIFY_STYLE_DNA.md](./KWALIFY_STYLE_DNA.md) — canonical atmosphere + form language  
**Canonical UI:** `artifacts/api-server/public/js/pets-ui.js` · `#appView.pets-shell`  
**Illustration:** [KWALIFY_OBJECT_CONSTRUCTION_MODE.md](./KWALIFY_OBJECT_CONSTRUCTION_MODE.md) · [KWALIFY_PETROL_PUMP_SVG_LOCKED.md](./KWALIFY_PETROL_PUMP_SVG_LOCKED.md)  
**Boot:** [EMOTION_GRID_UI_ENTRY.md](./EMOTION_GRID_UI_ENTRY.md)

---

## Core principle

Every screen = **ONE soft illustrated object** as hero in **quiet night atmosphere**. Everything else is secondary.

**Positioning:** Emotional object system for moments — not playlist browsing.

---

## Visual language (required)

- Soft rounded geometry · simplified silhouettes · controlled asymmetry
- Objects feel *found in the real world at night* — not cute mascots
- Personality via **scale, silence, lighting, spacing** — never faces
- Gentle gradients, cinematic restraint, generous negative space

## Forbidden

- Spotify Pets clone aesthetics (bright blue, bouncy UI, custom cursor, card tilt)
- Mascots · faces · UI icons · diagrams · toys
- Dashboards · industrial chrome · neon · harsh contrast

---

## Object system

One simplified object per mood: `pump` · `road` · `lamp` · `car` · `horizon`

Design question: *What does this object feel like in a quiet world?*

**Reference hero:** `pump` (Night Refuel) sets the bar for all others.

---

## UI structure (strict)

| Screen | Content |
|--------|---------|
| **Home** | 5 cards · 2+3 centered grid · mini illustration + title only |
| **Emotion** | Fullscreen one object · dark gradient bg · auto-generate · tap to return |

No other chrome on logged-in path.

---

## Lighting

- Late night / early morning stillness
- Low ambient glow · subtle depth · objects paused in time
- No harsh shadows · no dramatic contrast · no global bloom

---

## Override

> If it looks cute, darken the atmosphere. If it looks like a dashboard, remove chrome. If it looks like Spotify Pets, add silence.

---

## Auth note (separate from visuals)

If `/api/auth/me` returns **401**, boot shows guest path (landing) — **not** the emotion grid. Fix session/cookies separately from visual polish.
