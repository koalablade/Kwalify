# Final UI blueprint (canonical)

**Use this exactly** for UI implementation.  
**Assembly enforcement:** [KWALIFY_EMOTIONAL_SCENE_ASSEMBLY.md](./KWALIFY_EMOTIONAL_SCENE_ASSEMBLY.md)  
**North Star (product):** [KWALIFY_CREATIVE_NORTH_STAR.md](./KWALIFY_CREATIVE_NORTH_STAR.md) — playlist remains primary.  
**Hero stills / Figma:** [KWALIFY_VISUAL_STYLE_TLDR.md](./KWALIFY_VISUAL_STYLE_TLDR.md) · [PHASE1_FIGMA_PUMP_CHECKLIST.md](./PHASE1_FIGMA_PUMP_CHECKLIST.md)  
**Implemented prototype:** `artifacts/api-server/public/index.html` — `#worldHome`, `#worldEmotion`

---

## Mental model

> This is not a world. It is a collection of **emotional posters that come alive**.

That is Spotify Pets logic.

---

## 1. Home screen (mood grid)

Think: Spotify-style browse, but cleaner.

| Rule | Value |
|------|--------|
| Cards | 12–20 max |
| Layout | 3 columns desktop, lots of spacing |
| Forbidden | Map, full world on home |

**Each card:**

- Tiny hero preview (very simple shape)
- Mood title (e.g. “Motorway Drive”)
- Subtle ambient glow behind card

**Behaviour:**

- Hover → card lifts slightly + glow increases
- Click → zoom transition into full-screen emotion scene (600–900ms, ease-in-out)

---

## 2. Emotion screen (core product)

```
[ FULL SCREEN CANVAS ]
        (ambient background field)
              HERO OBJECT
         (one single dominant shape)
        subtle secondary light elements
     bottom optional UI (minimal controls)
```

### 2.1 Hero object rule (most important)

Each emotion = **exactly ONE** hero object.

| Mood | Hero |
|------|------|
| Motorway Drive | Long glowing road strip |
| Petrol Station | Single pump + canopy light bar |
| Late London Walk | One streetlamp pole |
| Old Car Project | Lifted car silhouette |

**Rules:** 1-second read · iconic · minimal detail · no competing objects.

### 2.2 Background layer

Mood atmosphere only — **not a scene**.

| Allowed | Not allowed |
|---------|-------------|
| Gradient shifts | Buildings with detail |
| Soft light streaks | Real environments |
| Subtle blur planes | Clutter |
| Gentle motion noise | Objects competing with hero |

### 2.3 Depth system (fixes blur/blob chaos)

**Only 3 layers:**

| Layer | Content |
|-------|---------|
| **1 Background** | Gradient / light field |
| **2 Mid** | Soft ambient shapes (very minimal) |
| **3 Hero** | One strong object — **sharpest** on screen |

### 2.4 Animation (click mood)

1. Home card enlarges → becomes hero object  
2. Background fades into mood atmosphere  
3. Everything else disappears  

**Timing:** 600–900ms · smooth ease-in-out only · no hard cuts  

### 2.5 Typography

- Top-left: mood title (small, calm)
- Bottom: optional search hint (invisible until needed)

---

## Why previous attempts failed

- No strict hero object rule  
- No layer limits  
- No background vs object definition  
- Too many interpretations → “vibe mush generator”

---

## Cursor prompt (locked system)

```
You are building a strict "Emotion Scene Card System".

ABSOLUTE RULES:

Each screen = exactly ONE emotion = ONE hero object.
The hero object must be the ONLY fully defined object in the scene.
No blobs, no abstract noise shapes, no organic chaos forms.
Background must be a simple gradient or soft light field only.
No detailed environments, no scenery, no multiple focal points.

STRUCTURE:

Layer 1: abstract gradient background only
Layer 2: minimal ambient light shapes (optional, very subtle)
Layer 3: single hero object (main focus, sharpest element)

INTERACTION:

Home screen = grid of emotion cards
Hover = lift + glow
Click = smooth zoom into full-screen emotion scene
Transition = hero object expands from card into full scene anchor

VISUAL STYLE:

soft geometric forms only
2.5D depth illusion (not realistic 3D environments)
controlled lighting, single light direction
calm readable silhouettes first, detail must be minimal

FAILSAFE RULE:

If output starts to look like blobs, foggy abstract art, or cluttered scenes,
STOP and replace with a single geometric hero object with clear silhouette and clean lighting.
```

---

## What to build (order)

1. **Mood grid** — `index.html` · **5 locked cards only**  
2. **Emotion screen** — 3 layers + single-source light  
3. **Hero objects** — [KWALIFY_HERO_OBJECTS_LOCKED.md](./KWALIFY_HERO_OBJECTS_LOCKED.md) (CSS in app; Figma per [KWALIFY_FIGMA_EMOTION_SCENE_UI.md](./KWALIFY_FIGMA_EMOTION_SCENE_UI.md))  

Do not add a 6th hero until all five pass silhouette + card→scene zoom test.

---

## Gap vs old moment-only wireframe

| Final blueprint | Legacy moment wireframe |
|-----------------|-------------------------|
| Mood grid first | Type-first input |
| CSS/SVG geometric heroes | `still.jpg` full bleed |
| Zoom 600–900ms | Opacity fade only |

Playlist flow: emotion screen → **Make playlist →** → existing generate (unchanged backend).
