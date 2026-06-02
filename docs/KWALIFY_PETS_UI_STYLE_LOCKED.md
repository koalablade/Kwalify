# Kwalify object UI style lock

**Brand DNA:** [KWALIFY_STYLE_DNA.md](./KWALIFY_STYLE_DNA.md) — Pets-influenced objects in Kwalify night atmosphere  
**Canonical UI:** `artifacts/api-server/public/js/pets-ui.js` · `#appView.pets-shell`  
**Illustration:** [KWALIFY_OBJECT_CONSTRUCTION_MODE.md](./KWALIFY_OBJECT_CONSTRUCTION_MODE.md) · [KWALIFY_PETROL_PUMP_SVG_LOCKED.md](./KWALIFY_PETROL_PUMP_SVG_LOCKED.md)  
**Boot:** [EMOTION_GRID_UI_ENTRY.md](./EMOTION_GRID_UI_ENTRY.md)

---

## Core principle

Every screen = **ONE Spotify Pets–soft illustrated object** as hero in **quiet night atmosphere**. Everything else is secondary.

**Positioning:** Emotional object system for moments — not playlist browsing.

---

## Visual language (required)

- **Objects:** Pets chunkiness — soft pills, gentle pastels, thick soft curves, slight asymmetry  
- **World:** Kwalify night — deep radial vignette, restrained chrome, generous space  
- **Type:** Nunito · uppercase whisper labels on cards  
- Personality via **scale, silence, lighting, spacing** — never faces  

## Forbidden

- Mascots · faces · Spotify Pet *characters*  
- Dashboard / industrial UI on logged-in path  
- Harsh neon · mechanical SVG detail · icon-grid shapes  

## Allowed from Pets

- Card color tints · soft illustration fills · friendly rounded type · chunky object proportions  

## Restrained (not cloned)

- Custom cursor · card tilt parallax · bouncy loaders · playful UI chrome  

---

## Object system

One object per mood: `pump` · `road` · `lamp` · `car` · `horizon`

**Reference hero:** `pump` (Night Refuel) sets the illustration bar.

---

## UI structure (strict)

| Screen | Content |
|--------|---------|
| **Home** | 5 cards · 2+3 centered grid · mini illustration + title only |
| **Emotion** | Fullscreen one object · mood gradient bg · auto-generate · tap to return · retry on error |

---

## Override

> If objects lack Pets softness, inflate and round. If the world lacks Kwalify silence, darken and simplify.

---

## Auth note

If `/api/auth/me` returns **401**, boot shows guest landing — not the emotion grid.
