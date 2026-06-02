# Figma — Emotion Scene UI layout system

**Hero geometry:** [KWALIFY_HERO_OBJECTS_LOCKED.md](./KWALIFY_HERO_OBJECTS_LOCKED.md)  
**Product frame:** [KWALIFY_FINAL_UI_BLUEPRINT.md](./KWALIFY_FINAL_UI_BLUEPRINT.md)

Build **2 screens only:** Home (Mood Grid) · Emotion Scene (fullscreen hero).

---

## File structure (pages)

1. **Foundations** — colours, typography, shadows, gradients  
2. **Components** — mood card, hero primitives (5), minimal buttons  
3. **Screens** — home grid, emotion scene template  

**Sticky note (non-negotiables):**

```
ONE hero object per scene
NO environmental detail
NO multiple focal points
NO texture-heavy design
BACKGROUND is always abstract
LIGHTING is always single-source
```

---

## 1. Home — mood grid

| Token | Value |
|-------|--------|
| Frame | 1440 × 900 |
| Safe margin | 64px |
| Grid | 3 columns · 24px gutter · auto row |
| Card | **240 × 180** px |
| Card radius | 20px |
| Card fill | Subtle gradient (not flat) |
| Card border | 1px soft translucent |
| Card shadow | Extremely soft |

### Card anatomy

```
[ HERO MINI — centered, no noise, ~65% opacity ok ]
[ Mood title — 14–16px / 500 / Inter ]
```

**Mini heroes (vector only):**

| Mood | Mini |
|------|------|
| Pump | Tiny block + screen rect |
| Road | Thin curved strip |
| Lamp | Vertical line + glow dot |
| Car | Capsule + two ticks (stands) |
| Horizon | Thin horizontal band |

### Interaction (prototype)

| State | Spec |
|-------|------|
| Default | Flat calm |
| Hover | Y **-6px** · glow +5–10% · gradient shift 5–10% |
| Click | Smart animate **600–800ms** ease-out → emotion screen |

---

## 2. Emotion scene

| Token | Value |
|-------|--------|
| Frame | 1440 × 900 |
| Layers | **3 only** (see below) |

### Layer stack

```
┌──────────────────────────────┐
│ UI overlay (minimal text)     │
│   ambient background (L1)     │
│      HERO OBJECT (L3)         │
└──────────────────────────────┘
```

| Layer | Content |
|-------|---------|
| **L1 Background** | Gradient field OR soft beams OR blurred motion streaks — no texture |
| **L2 Mid** | Optional minimal ambient (very subtle) |
| **L3 Hero** | Single object — **sharpest** element |

### Hero placement

- Centered, **~55%** viewport height (slightly above vertical centre)  
- Large scale — dominates frame  
- Nothing overlaps hero  

### Figma hero construction (vector)

**Pump:** body rect · screen rect · curved hose (stroke) · nozzle rect  

**Road:** long rect · curve mask · dashed line pattern repeat  

**Lamp:** line pole · rounded rect head · radial gradient cone below  

**Car:** capsule body · two small rects (stands) · disc wheels  

**Horizon:** horizontal rect · linear gradient warm→cool · slight curve path  

### Lighting (premium)

- **One** light source per scene  
- Radial gradient behind hero OR soft directional blur layer  
- Glow **only** on hero edges · blur 20–80px · opacity 10–40%  

### Typography

| Position | Spec |
|----------|------|
| Top-left | Mood title · 18px medium · slight letter-spacing |
| Bottom | “Type to explore moods…” · near-invisible |

### Prototype transition

Home card → Scene: hero base shape expands · background fades to mood field · **600–800ms** ease-out.

---

## 3. Visual style DNA (foundations page)

Full system: [KWALIFY_VISUAL_STYLE_DNA.md](./KWALIFY_VISUAL_STYLE_DNA.md)

**Core principle:** one physical object under one light — not a scene.

| Token | Direction |
|-------|-----------|
| Base UI | Dark neutral `#060608` |
| Card surface | Translucent gradient + hairline border |
| Pump accent | Muted green + warm screen glow |
| Road accent | Sodium warm + cool strip |
| Lamp accent | Humid amber cone |
| Car accent | Industrial underside cyan-white |
| Horizon accent | Warm peach → cool lilac |

Export heroes as **SVG components**; export scene stills only when matching locked silhouettes.

---

## Sync with code

CSS heroes in `index.html` mirror these primitives for dev smoke test before Figma export replaces raster/`still.jpg` paths.
