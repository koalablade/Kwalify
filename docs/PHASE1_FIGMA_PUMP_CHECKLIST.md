# Phase 1 — Fuel pump in Figma (step-by-step)

**Cursor instruction:** [KWALIFY_OBJECT_CONSTRUCTION_MODE.md](./KWALIFY_OBJECT_CONSTRUCTION_MODE.md) · **Pump SVG (locked):** [KWALIFY_PETROL_PUMP_SVG_LOCKED.md](./KWALIFY_PETROL_PUMP_SVG_LOCKED.md)  
**Locked pump spec:** [KWALIFY_HERO_OBJECTS_LOCKED.md](./KWALIFY_HERO_OBJECTS_LOCKED.md) §1 (no canopy, no environment).  
**Figma frames:** [KWALIFY_FIGMA_EMOTION_SCENE_UI.md](./KWALIFY_FIGMA_EMOTION_SCENE_UI.md)

**Goal:** Soft rounded pump illustration reads “petrol pump” at card (~64px) and hero (~240px) — friendly Pets-style, not industrial diagram.

**Refs:** [KWALIFY_VISUAL_STYLE_TLDR.md](./KWALIFY_VISUAL_STYLE_TLDR.md)  
**SVG source (5 shapes):** `artifacts/api-server/public/cinema/petrol_station_2am/fuel-pump-hero.svg`  
**Silhouette test @ 48px:** `fuel-pump-silhouette.svg` (reference) · **live UI:** `PETS_ILLUST_DEFS.pump` in `index.html`

---

## 0. Set up Figma (5 min)

1. New file → frame **`Kwalify / petrol_station_2am / export`** → **1920 × 1080**.
2. Frame fill: muted blue-grey e.g. `#B4C2CC` (adjust later; keep desaturated).
3. Optional reference frame: paste Pet Playlists landing screenshot **locked**, 20% opacity — compare **clarity of subject**, not colours to copy.
4. Paste a **real pump photo** on a separate locked layer — trace over it, then hide photo before export.

---

## 1. Silhouette pass (the “is it a dog?” test)

Draw **one shape** (black fill) for the whole pump + hose.

| Check | Pass? |
|-------|-------|
| Shrink layer to **48×48 px** on canvas — still a pump? | ☐ |
| Hiding photo, still reads without colour? | ☐ |
| Hose/nozzle visible in silhouette? | ☐ |

**If fail:** add back width on body, nozzle hook, or screen rectangle — do not add eyes or detail yet.

**Placement:** pump width ≈ **480px** (25% of 1920). Vertical: slightly **below centre** so **empty sky above** = liminal space.

---

## 2. Structure pass (parts you must not strip)

Build as **separate flat layers** (like Pets body / ear / stripe):

| Layer | Figma name | Notes |
|-------|------------|--------|
| 1 | `pump/body` | Main column |
| 2 | `pump/screen` | Rectangle only — **no pupils, no concentric eyes** |
| 3 | `pump/nozzle+hose` | One or two paths; hose = simple curve |
| 4 | `pump/base` | Island pad / footing |
| 5 | `env/canopy-hint` | Single flat bar or angle above — suggests forecourt, not a full scene |

**Optional:** `brand/stripe` or one `accent/green` (#1DB954-ish muted) — **one** accent only.

**Do not add:** second pump, car, shop, person, text, logo, gradients, shadows except optional **small black oval** under base (8% opacity, Pets-style ground).

---

## 3. Style pass (flat, neutral, deadpan)

| Rule | Value |
|------|--------|
| Fills | Flat only — max **5** fills on pump |
| Corners | One radius system (e.g. 8px @ 1×, scale with pump) |
| Outline | All or nothing — e.g. **2px** `#121212` on pump parts |
| Pump colours | Off-white body `#F4F4F2`, black lines, one green accent |
| Background | Frame fill only — no busy ground texture |

**Pets lesson:** their animals look playful because **shape is right**, not because the drawing “acts sad.” Stay neutral.

---

## 4. Figma opacity test (before export)

The moment app shows your still at **18%** (home) and **38%** (typing), on near-black `#060608`, plus a dark overlay.

Simulate in Figma:

1. Duplicate export frame → name **`test / app home`**.
2. Rectangle full bleed behind art: `#060608`.
3. Set **only the pump group + field** (or full frame) to **18%** opacity.
4. Rectangle on top: `#060608` at **55%** (matches `momentCanvasOverlay`).

| Check | Pass? |
|-------|-------|
| Still reads as pump at 18% + overlay? | ☐ |
| Repeat at **38%** opacity (less overlay: 48% if you want to be precise) | ☐ |
| Silhouette clearer than colour detail? | ☐ |

**If fail:** increase contrast (outline weight, white vs field), **not** more scenery or faces.

---

## 5. Export

1. Hide reference photo and Pet screenshot.
2. Export frame **`export`** → PNG **1920×1080**, no compression artifacts.
3. Publish into the app:

```powershell
cd c:\Users\Kwalah\Projects\Kwalify
python scripts/publish_cinema_still.py "C:\path\to\your-export.png" petrol_station_2am
```

Requires: `pip install pillow`

---

## 6. Browser test (real UI)

1. Run api-server the way you usually open the moment app.
2. Open moment home → type a phrase that picks **petrol / late night / empty** (or chip that maps to `petrol_station_2am`).
3. **Ctrl+F5** hard refresh (cache bust `still.jpg`).
4. Confirm:

| State | Scene opacity | You should see |
|-------|---------------|----------------|
| Home | ~18% | faint pump + void, UI readable |
| Typing | ~38% | pump slightly clearer, still not competing with input |

If the pump vanishes → return to Figma step 4 (contrast), not step 3 (more detail).

---

## 7. Lock the style sheet (Phase 2 prep)

When one export passes, write down **exactly**:

- Frame background hex
- Pump fill / stroke / accent hex
- Corner radius
- Stroke weight
- Pump width as % of frame
- Oval shadow yes/no

Other objects (streetlight, ticket, …) reuse **these rules**, different silhouette.

---

## Rejection checklist (stop and redo)

- ☐ Could be a generic “icon” not a forecourt pump  
- ☐ Has eyes or mascot expression on the screen  
- ☐ Lime / campaign Pets cosplay on a loneliness moment  
- ☐ Dies at 18% in Figma test  
- ☐ Looks like AI slop (mixed 3D, muddy gradients, inconsistent stroke)

---

## Personality (later — not in this PNG)

- CSS: tiny breathe / hover on scene layer  
- Copy + playlist carry emotion  

Do not draw loneliness into the pump’s face. Use **space and scale** only.
