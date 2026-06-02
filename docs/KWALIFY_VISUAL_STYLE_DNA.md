# Kwalify Visual Style DNA

**Core principle:**

> Every emotion is a **physical object under controlled light** — not a scene.

That separates AI blob UI from a premium product system.

**Assembly role (Cursor):** [KWALIFY_EMOTIONAL_SCENE_ASSEMBLY.md](./KWALIFY_EMOTIONAL_SCENE_ASSEMBLY.md)  
**Implementation:** [KWALIFY_HERO_OBJECTS_LOCKED.md](./KWALIFY_HERO_OBJECTS_LOCKED.md) · [KWALIFY_FIGMA_EMOTION_SCENE_UI.md](./KWALIFY_FIGMA_EMOTION_SCENE_UI.md) · `index.html` mood tokens

---

## 1. Form language (most important)

### Allowed only

| Form | Use |
|------|-----|
| Rounded rectangles | Primary |
| Soft capsules | Secondary (car body) |
| Clean cylinders | Vertical objects (lamp, pump) |
| Stretched ribbons | Motion (road) |
| Simple slabs | UI surfaces |

### Banned

Organic blobs · fractal shapes · noisy silhouettes · smoke geometry · overly complex curves · fake texture detail

**Mental model:** Everything could be **CNC-machined or injection-moulded**. That is the premium switch.

---

## 2. Lighting

**One scene = one light source.**

| Allowed | Notes |
|---------|--------|
| Soft directional light | Top-left or top-right · gentle depth |
| Ambient glow field | Behind hero · low-intensity gradient |
| Edge emission (rare) | Hero edges only · never full-object glow |

### Forbidden

Bloom overload · neon everywhere · multi-light chaos · game-engine lighting

---

## 3. Colour

**Not rainbow moods** — **controlled emotional palettes** per hero.

Each emotion:

- 1 **dominant** hue  
- 1 **supporting** hue  
- 1 **neutral** base  

| Mood | Dominant | Supporting | Neutral |
|------|----------|------------|---------|
| Motorway Drive | Deep blue-grey | Soft amber (lights) | Near-black |
| Petrol Night Refuel | Muted green-blue | Sodium amber | Dark graphite |
| Late London Walk | Cool blue-grey | Humid amber cone | Near-black |
| Old Car Project | Blue-grey industrial | Soft cyan underside | Graphite |
| End of Summer Drive | Dusty blue | Warm peach band | Charcoal |

**Rules:** Low–mid saturation · no pure RGB · rarely neon · slightly desaturated (cinematic)

---

## 4. Materials

| Allowed | Role |
|---------|------|
| Matte plastic | Primary UI / pump body |
| Soft anodised metal | Hero accents |
| Frosted glass | Rare overlays only |
| Rubberised surfaces | Secondary |

### Forbidden

Photoreal textures · grain noise · wood / fabric / skin · realistic environment materials

**Mental model:** **Manufactured**, not photographed.

---

## 5. Scale + composition

| Rule | Value |
|------|--------|
| Hero attention | **40–70%** of visual weight |
| Dominance | Hero always wins over background |
| Composition | Slight asymmetry preferred · large negative space |
| Edges | Hero/UI only — hero does not hug screen edges |

**Golden rule:** Zoom out — still understood instantly → correct.

---

## 6. Depth (3 layers only)

| Layer | Content |
|-------|---------|
| **L1 Background** | Gradient or soft light haze only |
| **L2 Atmosphere** | 1–2 abstract blurred light shapes · non-structural |
| **L3 Hero** | Crispest · highest contrast · sharp edges OK |

Fixes flat-or-blurry failure: never merge layers into one mush.

---

## 7. Motion

| Style | Spec |
|-------|------|
| Pace | Slow · weighted |
| Easing | ease-out / cubic — no snap |

| Allowed | Forbidden |
|---------|-----------|
| Slow background drift | Bounce |
| Gentle hero hover float | Elastic overshoot |
| Smooth zoom (600–900ms) | App UI jitter |

---

## 8. Premium test (before shipping any frame)

1. **One sentence object?** — If no → too complex.  
2. **Designed product object?** — If no → too organic.  
3. **One visual idea per screen?** — If no → clutter.

---

## 9. What you are building

Not “cool UI screens.”

**Emotionally isolated design objects under controlled lighting.**

Spotify Pets works because of **constraint-driven design**, not decoration.

---

## Cursor prompt (style DNA)

```
Every emotion is one physical object under one controlled light — not a scene.
Forms: rounded rects, capsules, cylinders, ribbons, slabs only. No blobs, smoke, fractals, or texture noise.
Lighting: single soft directional + optional low ambient behind hero; edge glow on hero only.
Colour: dominant + supporting + neutral per mood; low-mid saturation; desaturated cinematic.
Materials: matte plastic, soft metal, rare frosted glass — manufactured not photographed.
Depth: L1 gradient, L2 max 2 blurred light shapes, L3 crisp hero (40-70% attention).
Motion: slow ease-out only; no bounce or elastic overshoot.
Run premium test: one-sentence object, product-like, one idea per screen.
```
