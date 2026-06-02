# Pets UI — canonical implementation (2 screens only)

**Code:** `artifacts/api-server/public/index.html` · `#appView.pets-shell` · `body.pets-app`  
**Illustration rules:** [KWALIFY_OBJECT_CONSTRUCTION_MODE.md](./KWALIFY_OBJECT_CONSTRUCTION_MODE.md)  
**Assembly:** [KWALIFY_EMOTIONAL_SCENE_ASSEMBLY.md](./KWALIFY_EMOTIONAL_SCENE_ASSEMBLY.md)

---

## Absolute structure (no exceptions)

### 1. HOME — mood grid

- **5** mood cards only  
- **3-column** layout (2-col on narrow viewports)  
- Each card: soft **Pets-inspired illustrated preview** + mood title  
- **No** other UI (no header, nav, compose, playlist, cinema, maps)

### 2. EMOTION — fullscreen object

- Card click → fade + gentle scale into fullscreen  
- **One** large illustrated object, centered  
- Soft gradient background  
- **No** chrome on emotion screen  
- Tap anywhere → return to grid  

---

## Visual language

Spotify Pets–**inspired illustration** for objects (not animals):

- Rounded, friendly, simplified forms  
- Gentle curves, soft gradients, soft shading  
- Slight character-like abstraction — **no** mascots, faces, or lime campaign cosplay  

**Forbidden:** industrial/mechanical, geometric icon UI, diagrams, dashboards, worlds, harsh neon.

---

## Heroes (locked)

| Mood | `illust` | Object |
|------|----------|--------|
| Night Refuel | `pump` | Soft rounded pump |
| Motorway Drive | `road` | Curved ribbon road |
| Late London Walk | `lamp` | Glowing soft pole |
| Old Car Project | `car` | Rounded car silhouette |
| End of Summer Drive | `horizon` | Soft atmospheric band |

Data: `EMOTION_MOODS` · art: `PETS_ILLUST_DEFS`

---

## Motion

- Fade + zoom only · `cubic-bezier(.22,1,.36,1)` · ~520–560ms  
- **No** bounce, overshoot, or elastic  

---

## Entry points

| Event | Function |
|-------|----------|
| Login | `bootAuthedHome()` → `initEmotionGridUI()` only |
| Boot | `init()` → `/auth/me` → authed: `bootAuthedHome()` · guest: `bootGuestLanding()` |
| Logout / landing | `bootGuestLanding()` — never runs when session valid |
| Legacy | `#apiStubs` outside `#appView`; sync gate permanently disabled |

Legacy moment/cinema: **disabled** while `pets-app` (`setMomentState` / `renderScene` no-op).

---

## Override rule

| If it looks like… | Then… |
|-------------------|--------|
| Machine / diagram | Softer, rounder, more illustrated |
| Blob / messy | Simplify structure, restore read |
| Dashboard / system UI | Strip to cards + one object only |

**Core principle:** One mood = one soft illustrated object in calm empty space.
