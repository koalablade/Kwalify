# UI spec — Emotional World Interface System

**Status:** Design bible (target UI).  
**Supreme product direction:** [KWALIFY_CREATIVE_NORTH_STAR.md](./KWALIFY_CREATIVE_NORTH_STAR.md) — playlist first; visuals support feeling.  
**Object / still art:** [KWALIFY_VISUAL_STYLE_TLDR.md](./KWALIFY_VISUAL_STYLE_TLDR.md) · Figma Phase 1: [PHASE1_FIGMA_PUMP_CHECKLIST.md](./PHASE1_FIGMA_PUMP_CHECKLIST.md)  
**Current shipped loop:** [MOMENT_UI_WIREFRAME.md](./MOMENT_UI_WIREFRAME.md) (simpler; see §10 gap)

---

## Core idea

**One screen = one emotional state = one hero object = one controlled environment.**

No exceptions.

---

## 1.1 Visual language (absolute rules)

### Shapes

- 100% **geometric or semi-geometric** forms
- Rounded rectangles, soft cylinders, simple extrusions
- **No** organic noise shapes
- **No** smoke blobs, watercolor, chaos textures

### Depth

- **2.5D layered depth only** — not full 3D simulation
- Foreground: hero object
- Mid: ambient props
- Back: soft background gradient field

### Lighting

- **Single** directional soft light source per scene
- Subtle glow **only** on hero object edges
- **No** global bloom overload

---

## 1.2 Hero object system

Every emotion screen has **exactly ONE** hero object that defines the mood.

| Emotion world | Hero object |
|---------------|-------------|
| Motorway drive | Stylised highway stretch + reflective lane markers |
| Petrol station | Iconic pump + canopy light bar |
| Late night London | Streetlight pole |
| Old car work | Lifted car silhouette on jack stands |

### Hero object rules

- Centered or slightly off-center (rule of thirds)
- Readable silhouette at **1 second** glance
- Isolated from clutter
- Subtle shadow or glow to **ground** it

Aligns with Pets: **recognition-first**, personality later (motion/UI).

---

## 1.3 Ambient world (background layer)

**Not a map.** An emotional field.

| Allowed | Not allowed |
|---------|-------------|
| Gradients | Real geography |
| Soft horizon lines | Detailed environments |
| Abstract light trails | Buildings with detail |
| Minimal hints (road lines, signage shapes, windows) | Cluttered scenes |

---

## 1.4 Interaction model

### Home

- Grid or vertical list of **emotion nodes**
- Each node = small preview vignette of the hero object

### Hover

- Slight lift + soft glow pulse
- Background subtly shifts mood tone

### Click

- Smooth **zoom into world** transition
- Hero scales from preview → full scene anchor

### Search (parallel navigation)

- Always visible; floats above world (subtle glass panel)
- Typing filters **emotion nodes**
- Suggestions show **emotion interpretations**, not raw keywords

Example: user types `driving` → motorway at night, rainy motorway solitude, late fuel stop.

---

## 1.5 Typography

- **One** font family — geometric sans (Inter / Söhne class)
- Emotion titles: **medium**
- Search: **regular**
- Metadata: **light**
- **No** decorative fonts

---

## 1.6 Color

Per emotion:

- 1 dominant hue
- 1 secondary supporting hue
- Neutral base (dark or off-white)

**Saturation always controlled.** No rainbow mixing inside one scene.

---

## 1.7 Transitions (Spotify Pets feel)

| Must have | Forbidden |
|-----------|-----------|
| Slow ease-in zoom (0.6–1.2s) | Hard cuts |
| Object morph scaling (not fade-only) | |
| Background gradient shift synced to selection | |
| Slight parallax drift | |

North Star motion guardrail: micro, not cinematic camera systems — transitions here are **UI world entry**, not film-grade scene animation.

---

## 1.8 Failure fix (stop rule)

If generation drifts toward:

- Blurred blobs
- Abstract amorphous shapes
- Messy composition

**STOP** → replace with:

- Clean geometric hero object
- Clear silhouette
- Controlled single-source lighting

---

## 2. Cursor prompt (copy-paste)

Use when implementing or generating UI/scene code in Cursor:

```
You are building a "Spotify Pets-like Emotional World UI system".

STRICT VISUAL CONSTRAINTS — DO NOT BREAK:

Every screen MUST contain exactly ONE hero object representing the selected emotion.
No blobs, no abstract noise shapes, no organic watercolor effects.
All shapes must be geometric or semi-geometric (rounded rectangles, cylinders, clean extrusions).
No detailed environments, no real-world scenes, no clutter.
Background is always an abstract gradient field with subtle light direction only.
Lighting must be single-source soft lighting with subtle edge glow only on hero object.
No multiple competing focal points.

INTERACTION RULES:

Home screen shows emotion nodes as clean cards with mini hero previews.
Hover: subtle lift + glow pulse only.
Click: smooth zoom transition into single emotion world.
Each emotion world must feel isolated and self-contained.

DESIGN STYLE:

inspired by Spotify Pets UI system (soft geometry, emotional minimalism, controlled depth)
2.5D layered composition only (not full 3D realism)
calm, readable silhouettes first, detail second

TYPOGRAPHY:

single geometric sans font
no decorative fonts
strict hierarchy only

IMPORTANT FAILURE FIX:
If you are about to generate blurred blobs, abstract amorphous shapes, or messy composition,
STOP and replace with a clean geometric hero object with clear silhouette and controlled lighting.

OUTPUT GOAL:
A clean, emotionally readable interface where each screen feels like a single "world card" built around one object.
```

---

## 3. Scene manifest mapping (10 worlds)

| `scene_id` | Hero object (spec) |
|------------|-------------------|
| `night_drive` | Highway stretch + lane markers |
| `petrol_station_2am` | Pump + canopy light bar |
| `urban_midnight_walk` | Streetlight pole |
| `open_highway_daylight` | Highway / mile marker |
| `sunset_coast` | Lighthouse (object anchor) |
| `train_journey` | Train ticket |
| `rainy_city_interior` | Lamp beside window |
| `memory_road` | Road sign |
| `summer_afternoon_drift` | Garden chair |
| `club_exit_dawn` | Fading neon sign shape |

Still assets: geometric 2.5D illustration per [KWALIFY_VISUAL_STYLE_TLDR.md](./KWALIFY_VISUAL_STYLE_TLDR.md), not photographic stills.

---

## 4. Implementation phases (suggested)

| Phase | Scope |
|-------|--------|
| **A** | Figma hero + field for `petrol_station_2am`; publish `still.jpg` |
| **B** | Emotion node cards with mini vignettes (home) |
| **C** | Zoom transition + gradient sync on node click |
| **D** | Search → emotion interpretations filter |
| **E** | Remaining nine heroes locked to same geometry/light rules |

Do not block playlist shipping on D/E if North Star loop (type → make → result) still works.

---

## 5. Current app vs this spec (gap)

| This spec | Today (`index.html` moment-app) |
|-----------|----------------------------------|
| Emotion node grid + vignettes | Vertical chips + free-text moment |
| Click → zoom into world | Opacity shift while typing; scene swap |
| Search filters interpretation cards | Search is moment input → scene hint |
| 2.5D composed worlds | Full-bleed `still.jpg` at 18–38% opacity |
| Parallax + zoom transitions | Fade opacity only |

**Rule:** New UI work should move **toward** this spec without breaking generate stability or “playlist in 30 seconds” clarity. Update [MOMENT_UI_WIREFRAME.md](./MOMENT_UI_WIREFRAME.md) when a phase ships.

---

## 6. Open next steps (pick one)

- **Visual metaphor for world transition** — zoom from card vignette vs crossfade vs scale-from-chip anchor  
- **Emotion node data model** — map chips → nodes → `scene_id` + interpretation copy  
- **Figma component set** — node card, glass search, hero 2.5D layer tokens  
- **Phase B implementation plan** in `index.html` behind feature flag  
