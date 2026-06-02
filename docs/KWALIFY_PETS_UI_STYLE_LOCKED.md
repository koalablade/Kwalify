# Spotify Pets UI style lock (strict visual system)

**Canonical UI:** `artifacts/api-server/public/index.html` · `PETS_ILLUST_DEFS`  
**Illustration:** [KWALIFY_OBJECT_CONSTRUCTION_MODE.md](./KWALIFY_OBJECT_CONSTRUCTION_MODE.md) · [KWALIFY_PETROL_PUMP_SVG_LOCKED.md](./KWALIFY_PETROL_PUMP_SVG_LOCKED.md)  
**Boot:** [EMOTION_GRID_UI_ENTRY.md](./EMOTION_GRID_UI_ENTRY.md)

---

## Core principle

Every screen = **ONE soft illustrated object** as hero. Everything else is secondary.

---

## Visual language (required)

- Soft rounded shapes (primary rule)
- Friendly simplified illustration — slight character-like abstraction
- **No** mascots, **no** faces, **no** Spotify Pet characters
- Gentle gradients, soft shading, calm compositions
- Generous negative space

## Forbidden

- Geometric / icon-only UI systems
- Industrial / mechanical aesthetics
- Sharp technical diagrams
- Dashboards or data layouts
- Realistic 3D, neon, cyber, harsh contrast

---

## Object system

One simplified illustrated object per mood: `pump` · `road` · `lamp` · `car` · `horizon`

Must feel **illustrated, soft, friendly, minimal** — not technical or mechanical.

---

## UI structure (strict)

| Screen | Content |
|--------|---------|
| **Home** | 5 cards · 3 columns · mini illustration + title only |
| **Emotion** | Fullscreen one object · soft gradient bg · tap to return |

No other chrome on logged-in path.

---

## Lighting

- Soft ambient only · gentle gradients · subtle depth
- No harsh shadows · no dramatic contrast

---

## Override

> If it looks like a diagram, simplify it. If it looks like a system, soften it. If it looks harsh, round it.

---

## Auth note (separate from visuals)

If `/api/auth/me` returns **401**, boot shows guest path (landing or login redirect) — **not** the emotion grid. Fix session/cookies separately from visual polish.
