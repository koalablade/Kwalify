# Emotional Scene Interface — assembly (Pets-style)

**Objects first:** [KWALIFY_OBJECT_CONSTRUCTION_MODE.md](./KWALIFY_OBJECT_CONSTRUCTION_MODE.md) (Pets illustration mode)  
**Heros:** [KWALIFY_HERO_OBJECTS_LOCKED.md](./KWALIFY_HERO_OBJECTS_LOCKED.md)  
**UI blueprint:** [KWALIFY_FINAL_UI_BLUEPRINT.md](./KWALIFY_FINAL_UI_BLUEPRINT.md) · [EMOTION_GRID_UI_ENTRY.md](./EMOTION_GRID_UI_ENTRY.md)

---

## System role

You are assembling a **two-screen Pets-inspired mood browser**:

1. **Home** — 5 mood cards, soft illustrated previews only  
2. **Emotion** — fullscreen one large illustrated object, soft gradient background  

You are **not** building dashboards, worlds, maps, or moment-compose chrome on the home path.

---

## Absolute rules (non-negotiable)

### 1. Single hero object

Each emotion screen = **exactly ONE** illustrated object, centered.

- No secondary focal objects  
- No detailed environments  
- No UI competing with the hero (no nav, grid, sidebars on emotion screen)

### 2. Illustration language only

**Required:** soft rounded forms, friendly simplification, gentle gradients, calm spacing  

**Forbidden:** industrial/mechanical look, sharp geometric icon art, technical diagrams, photoreal scenes, blob chaos, mascot faces

### 3. Background

- Soft gradient field only (warm/cool per mood)  
- Very subtle radial depth — **no** buildings, roads as environment, clutter  
- Max **1–2** ultra-soft ambient glow shapes (optional)

### 4. Lighting

- **Soft ambient** — single calm direction implied  
- Gentle depth on the object — **no** harsh contrast, neon bloom, or studio product shots  

### 5. Depth (3 layers max)

| Layer | Content |
|-------|---------|
| L1 | Soft gradient background |
| L2 | Optional faint ambient glow (max 2 shapes) |
| L3 | One crisp **illustrated** hero (sharpest element) |

### 6. Typography

- Card: small mood title under preview  
- Emotion screen: **no** required chrome (title optional later; default = object only)  
- One sans family, minimal hierarchy  

### 7. Motion

- Card → emotion: smooth fade + gentle scale (~500–600ms, ease-out)  
- Emotion → home: same, reversed  
- **No** bounce, elastic overshoot, or aggressive animation  

---

## Output goal

> One soft illustrated object in a calm gradient space — feels like Spotify Pets applied to **objects**, not animals.

**Not** a dashboard. **Not** a world map. **Not** an industrial product render.

---

## Failure detection

Rebuild if **yes** to any:

- More than one focal object?  
- Reads as machine diagram or flat icon set?  
- Background busy or environmental?  
- Harsh realism or neon overload?  
- Home shows extra UI (search, playlist, cinema stills, compose)?  

### Correction

1. Remove extra UI and objects  
2. Soften and round the hero  
3. Simplify background to gradient  
4. Increase negative space  
5. Re-center hero (optical center, slightly above mathematical center)

---

## Copy-paste (Cursor)

```
ASSEMBLY: Pets-style Emotional Scene Interface — 2 screens only.

HOME: 5 cards, 3-column grid, soft illustrated preview + title. Nothing else.
EMOTION: fullscreen, ONE large soft illustrated object, soft gradient bg, tap to return.

ONE hero per screen. Illustration language — rounded, friendly, simplified. NOT industrial/geometric/diagram.

Bg = soft gradient only. Light = calm ambient. Depth = gradient + optional faint glow + hero.
Motion = fade + gentle scale, ease-out — no bounce.

If dashboard/technical/realistic → strip to 5 cards → 1 object per screen.
```
