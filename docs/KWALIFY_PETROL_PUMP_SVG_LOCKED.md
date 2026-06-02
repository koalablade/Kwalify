# Petrol pump — Spotify Pets SVG construction (LOCKED)

**Scene:** `petrol_station_2am` · **Hero key:** `pump` · **Illust key:** `pump`  
**Parent:** [KWALIFY_OBJECT_CONSTRUCTION_MODE.md](./KWALIFY_OBJECT_CONSTRUCTION_MODE.md) · [KWALIFY_HERO_OBJECTS_LOCKED.md](./KWALIFY_HERO_OBJECTS_LOCKED.md) §1

**Reference assets:**

| Asset | Path |
|-------|------|
| Hero (export / Figma trace) | `artifacts/api-server/public/cinema/petrol_station_2am/fuel-pump-hero.svg` |
| Silhouette @ 48px test | `artifacts/api-server/public/cinema/petrol_station_2am/fuel-pump-silhouette.svg` |
| Live UI (grid + emotion) | `PETS_ILLUST_DEFS.pump` in `artifacts/api-server/public/js/pets-ui.js` |

---

## Purpose

Strict SVG assembly for the **Night Refuel** petrol pump hero.

Every valid pump MUST:

- Read as **petrol pump** at **48px**
- Feel **soft Kwalify illustration** — night forecourt object, not mechanical, not UI icon
- Use **only** the six layers below — no detail creep

---

## Mandatory layer order

Every pump SVG MUST follow this structure **and this order**:

```xml
<svg>
  <!-- 1. BODY -->
  <!-- 2. HEAD UNIT -->
  <!-- 3. SCREEN PANEL -->
  <!-- 4. HOSE -->
  <!-- 5. NOZZLE -->
  <!-- 6. LIGHT / ACCENT (optional glow on screen only) -->
</svg>
```

**No other layers allowed.** No base plate, canopy, forecourt, text, or environment.

---

## 1. BODY (primary shape)

| | |
|--|--|
| **Element** | `<rect>` |
| **Role** | Soft pill-like pillar — dominant mass |

**Rules**

- Rounded rectangle only  
- **Large `rx`** (primary softness — typically 40–50% of half-width)  
- Slightly wider / heavier toward bottom (scale or subtle width)  
- Single fill — flat or very subtle vertical gradient only  

**Forbidden:** sharp corners, segmentation, internal detail, bolts, panels on body

**Visual intent:** soft **pill-like pillar**

---

## 2. HEAD UNIT (top cap)

| | |
|--|--|
| **Element** | `<rect>` or simple `<path>` |
| **Role** | Top cap — reads as “pump head” |

**Rules**

- Slightly **narrower** than body width  
- Same **radius family** as body (proportionally large `rx`)  
- Top-center on body  
- May overhang forward **2–5%** (optional subtle `x` shift)  

**Forbidden:** mechanical joints, bolts, hard edges, separate hardware parts

---

## 3. SCREEN PANEL (UI face area)

| | |
|--|--|
| **Element** | `<rect>` |
| **Role** | Face / display zone on upper-mid body |

**Rules**

- Centered on upper-mid body  
- Visually **inset** (padding from body edges)  
- Slightly **brighter** fill or higher opacity than body  
- Optional soft inner glow via filter on **layer 6 only**  

**Forbidden:** text, digits, UI clutter, detailed display content

---

## 4. HOSE (most important shape)

| | |
|--|--|
| **Element** | `<path>` (stroke, not hairline) |
| **Role** | Soft connection from pump to nozzle |

**Rules**

- **Thick stroke** — never thin line (Pets ribbon, not wire)  
- **Smooth S-curve only**  
- Originates from **mid-lower body** (right or left — pick one, stay consistent)  
- Must **not** touch canvas edges  
- **Max 2 control points** per curve segment (no complexity creep)  
- Soft radius of curvature — **no sharp bends**  

**Visual intent:** **soft ribbon connection**, not cable or industrial hose

---

## 5. NOZZLE

| | |
|--|--|
| **Element** | `<path>` or simplified `<rect>` |
| **Role** | Bean / capsule at hose end |

**Rules**

- Simplified **capsule / bean** shape  
- Attached at hose terminus  
- **Slightly oversized** vs realism (Pets exaggeration)  
- Fully rounded ends  

**Forbidden:** trigger, buttons, ridges, mechanical detail

---

## 6. ACCENT / LIGHT (optional)

| | |
|--|--|
| **Element** | `<circle>` or `<ellipse>` + blur / soft radial gradient |
| **Role** | Screen glow only |

**Rules**

- Used **only** on / behind **screen panel**  
- Opacity **10–25%**  
- Soft radial gradient only  

**Forbidden:** global bloom, multi-light systems, dramatic shading, hero-wide glow

---

## Global style rules (all elements)

### Corner radius system

| Part | Radius |
|------|--------|
| Body | Large (primary softness) |
| Head | Same family as body |
| Screen | Slightly smaller (secondary) |
| Nozzle | Full capsule (999 / half-height) |

### Fill

- Flat base colour per part  
- **No** textures  
- Gradients **only** on screen glow (layer 6) or extremely subtle body/head depth  

### Stroke

- Minimal or **none**  
- If used: very thin, soft opacity — never hard black outlines on final Pets art  

### Geometry

Everything reducible to **rounded rectangles + one curve system** (hose path).

---

## Silhouette guarantee

Before finalising:

| Must pass | |
|-----------|--|
| ☐ | Readable at **48×48 px** |
| ☐ | Recognisable as pump in **black silhouette only** (no colour, no glow) |
| ☐ | Identity needs **no** internal micro-detail |

**If fail → remove detail, do not add more.**

Test file: `fuel-pump-silhouette.svg`

---

## Spotify Pets translation

**Do**

- Slightly inflate proportions  
- Soften transitions between parts  
- Allow **very subtle** asymmetry  

**Do not**

- Realistic product modelling  
- Mechanical precision  
- Technical parts (valves, hinges, branding)  

---

## Cursor hard fail rule

If the SVG becomes **angular**, **overly complex**, **mechanical**, or **icon-like UI**:

**STOP** and simplify to **3 shapes minimum:** **body + hose + nozzle** (re-add head/screen only if silhouette still reads).

---

## Final output goal

> A soft illustrated petrol pump with clear identity, built from a minimal set of rounded components.

**NOT:** diagram · product model · UI icon · realistic render

---

## Copy-paste (Cursor — pump ONLY)

```
PETROL PUMP SVG — LOCKED (Spotify Pets style)

Layers ONLY, in order: BODY (rect, large rx) → HEAD (rect) → SCREEN (rect, inset) → HOSE (thick path, soft S-curve, max 2 cp) → NOZZLE (capsule) → ACCENT (optional screen glow 10–25%).

48px silhouette must read "pump" in black only. Soft, rounded, slightly inflated — NOT mechanical, NOT UI icon.

No extra layers. No text, base plate, canopy, environment. If over-complex → body + hose + nozzle only.

Refs: docs/KWALIFY_PETROL_PUMP_SVG_LOCKED.md · fuel-pump-hero.svg · PETS_ILLUST_DEFS.pump
```
