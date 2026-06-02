# Cursor — strict object construction mode

**Paste this as your ONLY instruction** when building or editing heroes, mood cards, or emotion-screen visuals.

**After objects pass silhouette test:** [KWALIFY_EMOTIONAL_SCENE_ASSEMBLY.md](./KWALIFY_EMOTIONAL_SCENE_ASSEMBLY.md) · [KWALIFY_VISUAL_STYLE_DNA.md](./KWALIFY_VISUAL_STYLE_DNA.md)

---

## System role

You are building UI using a **Spotify Pets-style system**.

You are **NOT** designing mood, atmosphere, or scenes.

You are **ONLY** constructing **recognisable objects**.

---

## Core rule (most important)

Every visual element must pass:

> **Is the object instantly recognisable in pure silhouette (no colour, no lighting, no background)?**

If **NO** → simplify until **YES**.

---

## Object rules

- Simple geometric construction only  
- **Max 3–6 shapes** per object  
- Must read clearly at **48px** icon size  
- Must work in **pure black silhouette**  
- **No** facial features or mascot behaviour  
- **No** environmental context inside the object  

### Forbidden

- Blobs / organic shapes  
- “Cinematic” styling during construction  
- Emotional expression in the object itself  
- Scenery or background details inside objects  
- Gradients used to **define** shape  

---

## Lighting rule (separate step only)

Lighting is applied **AFTER** the object is correct.

Lighting may only:

- Change contrast  
- Add soft shadow  
- Add subtle glow  

Lighting **cannot** change the shape language.

---

## Order of operations

1. Build raw geometric object (**no style**)  
2. Test silhouette readability  
3. Simplify until it works at small size  
4. **Only then** apply lighting and colour  
5. Place on flat gradient background  

---

## Hero objects (current set)

Use these definitions strictly:

| Mood | Object |
|------|--------|
| Petrol Station | Single fuel pump monolith |
| Motorway Drive | Single ribbon road strip |
| London Walk | Single streetlamp pole |
| Old Car Project | Simplified lifted car body |
| Summer Drift | Single horizon light band |

**No** extra objects. **No** scenery.

Geometry detail: [KWALIFY_HERO_OBJECTS_LOCKED.md](./KWALIFY_HERO_OBJECTS_LOCKED.md)

---

## Failure fix rule

If output looks:

- blurry  
- like an illustration  
- like a scene  
- like a mascot  

**STOP** and reduce complexity by **50%**.

---

## Output goal

A system of clean, readable objects that feel like:

> **Industrial design icons placed in empty space**

**NOT** illustrations or moods.

---

## What this fixes

| Removes | Forces |
|---------|--------|
| Blob generation | Structure first |
| Mascot drift | Style second |
| Spotify cosplay | |
| Emotional over-design | |
| AI art behaviour | |

**Never reverse:** structure → then style.

---

## Copy-paste (Cursor — ONLY instruction)

```
CURSOR — STRICT OBJECT CONSTRUCTION MODE

You are building UI using a Spotify Pets-style system.
You are NOT designing mood, atmosphere, or scenes.
You are ONLY constructing recognisable objects.

CORE RULE:
Every visual must pass: instantly recognisable in pure black silhouette (no colour, light, or background)?
If NO → simplify until YES.

OBJECT RULES:
- Geometric construction only, max 3–6 shapes per object
- Readable at 48px, pure black silhouette
- No faces, mascot behaviour, or environment inside the object
FORBIDDEN: blobs, organic shapes, cinematic styling during construction, emotion in the object, scenery inside object, gradients that define shape

LIGHTING (AFTER object is correct only):
contrast, soft shadow, subtle glow — cannot change shape language

ORDER: raw geometry → silhouette test → simplify → then lighting/colour → flat gradient background

HEROES (strict):
Petrol Station = fuel pump monolith
Motorway Drive = ribbon road strip
London Walk = streetlamp pole
Old Car Project = lifted car body
Summer Drift = horizon light band
No extra objects. No scenery.

If blurry / illustration / scene / mascot → STOP, reduce complexity 50%.

OUTPUT: industrial design icons in empty space — NOT illustrations or moods.
```
