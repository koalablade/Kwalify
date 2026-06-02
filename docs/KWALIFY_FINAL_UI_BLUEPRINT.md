# Final UI blueprint (canonical) — Pets illustration

**North Star:** [KWALIFY_CREATIVE_NORTH_STAR.md](./KWALIFY_CREATIVE_NORTH_STAR.md) — playlist remains primary (generate path off-home).  
**Illustration mode:** [KWALIFY_OBJECT_CONSTRUCTION_MODE.md](./KWALIFY_OBJECT_CONSTRUCTION_MODE.md)  
**Assembly:** [KWALIFY_EMOTIONAL_SCENE_ASSEMBLY.md](./KWALIFY_EMOTIONAL_SCENE_ASSEMBLY.md)  
**Implemented:** [EMOTION_GRID_UI_ENTRY.md](./EMOTION_GRID_UI_ENTRY.md) · `artifacts/api-server/public/index.html`

---

## Mental model

> Not a dashboard. Not a world map.  
> A **minimal Spotify Pets–inspired mood browser** — each mood is one soft illustrated object in calm space.

---

## 1. Home screen (mood grid)

| Rule | Value |
|------|--------|
| Cards | **Exactly 5** (locked heroes) |
| Layout | 3 columns desktop, generous spacing |
| Card content | Small **soft illustrated preview** + mood title |
| Forbidden | Map, compose, playlist UI, cinema, header chrome when logged in |

**Behaviour:**

- Hover → slight lift + brightness (gentle only)  
- Click → fade/zoom into fullscreen emotion screen (~500–600ms, ease-out)

---

## 2. Emotion screen

```
[ FULL SOFT GRADIENT BACKGROUND ]
        ONE LARGE ILLUSTRATED OBJECT
              (centered, calm)
```

| Rule | Value |
|------|--------|
| Objects | One per mood — see [KWALIFY_HERO_OBJECTS_LOCKED.md](./KWALIFY_HERO_OBJECTS_LOCKED.md) |
| Style | Rounded, friendly, simplified illustration |
| UI | **None** on emotion screen (tap to return) |
| Background | Soft gradient only — no environments |

**Forbidden:** industrial icons, geometric placeholders, technical diagrams, extra navigation

---

## 3. Motion

- Home ↔ emotion: opacity + gentle scale  
- **No** bounce, elastic, or hard cuts  

---

## 4. What not to build on home

- Moment typing UI, chips, generate button (legacy — stubs only)  
- World/map systems  
- `still.jpg` cinema bleed on logged-in load  
- 6th mood until five pass illustration review  

---

## Cursor prompt (locked)

```
Pets-style mood browser — 2 screens only.

HOME: 5 cards, 3 columns, soft illustrated preview + title. Nothing else.
EMOTION: fullscreen one soft illustrated object, soft gradient, tap back.

Spotify Pets–inspired illustration — rounded, friendly, simplified. NOT industrial, NOT geometric icon UI, NOT diagrams.

ONE object per screen. Calm motion (fade + gentle scale).

If dashboard/technical → simplify to 5 cards → 1 object.
```

---

## Gap vs legacy moment wireframe

| Canonical (now) | Legacy |
|-----------------|--------|
| 5-card Pets grid | Type-first compose |
| Inline SVG illustrations | Cinema `still.jpg` |
| `#appView.pets-shell` at root | Moment shell in page |

Playlist: reachable later from emotion/context — not on home grid.
