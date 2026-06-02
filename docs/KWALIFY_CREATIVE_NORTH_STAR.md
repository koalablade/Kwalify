# KWALIFY CREATIVE NORTH STAR

## Purpose

This document exists to prevent Kwalify from drifting into unnecessary complexity.

It is not a technical roadmap.

It is the creative and product direction that all future design, UI, scene, animation, and visual decisions must be measured against.

---

# Core Product

Kwalify is:

> A tool that turns moments into soundtracks using your Spotify liked songs.

The user enters:

* a feeling
* a moment
* a memory
* an atmosphere
* a place
* a situation

Kwalify returns:

* a playlist
* an emotional world

The playlist is always the primary product.

The visual world exists to support the feeling of the playlist.

---

# Product Promise

A user should feel:

> "I didn't expect it to understand that."

The goal is emotional recognition.

Not technical impressiveness.

Not AI sophistication.

Not visual complexity.

---

# What Kwalify Is NOT

Kwalify is NOT:

* a cinematic engine
* a movie generator
* an AI showcase
* a visual effects project
* a dashboard
* a Spotify clone

If a feature moves the product in one of those directions, reconsider it.

---

# Spotify Pets Principle

The lesson from Spotify Pet Playlists is NOT dogs.

The lesson is:

* instant understanding
* strong personality
* emotional recognition
* simple interaction
* memorable visual identity

Users immediately understand:

"What is this?"
"What do I do?"
"What do I get?"

Kwalify should achieve the same clarity.

---

# Current UX Direction (shipped path)

**Logged-in home (canonical):** Pets-style **mood grid only** — 5 cards → tap → fullscreen soft illustrated object. See [EMOTION_GRID_UI_ENTRY.md](./EMOTION_GRID_UI_ENTRY.md).

**Playlist path (backend, not on home):** moment text → generate → result — available via hidden API stubs; must not clutter the mood browser.

Avoid on the home/emotion path:

* dashboards, maps, compose chrome, cinema stills
* multi-stage loaders, engine visualisation
* industrial/geometric placeholder art as final UI

---

# Visual Direction

We are **not** using realistic cinematic photography or industrial product renders on the mood UI.

We are using:

## Spotify Pets–inspired object illustrations

Each mood = **one soft, simplified, character-like object** (pump, road ribbon, lamp, car, horizon band).

The goal is **instant emotional recognition** through friendly illustration — not technical diagrams or machined icons.

The goal is not realism.

The goal is: *“oh yeah, that’s a fuel pump / night road / lamp”* at a glance — same discipline Pets uses for animals, applied to **objects**.

---

# Dream Object System

Every scene should be built around a symbolic emotional object.

Examples:

Night Drive:

* dashboard glow

Petrol Station 2am:

* fuel pump (see [OBJECT_EXPLORATION.md](./OBJECT_EXPLORATION.md) — 50 objects + concept variations)

Train Journey:

* train ticket

Rainy Interior:

* lamp beside window

Urban Midnight:

* streetlight

Sunset Coast:

* lighthouse

Memory Road:

* road sign

Summer Drift:

* garden chair

Club Exit Dawn:

* fading neon sign

Open Highway:

* mile marker

The object is the emotional anchor.

The environment exists to support the object.

---

# Visual Philosophy

Think:

"small emotional worlds"

Not:

"large realistic scenes"

The world should feel:

* memorable
* recognisable
* iconic
* emotionally readable

The user should remember:

"the fuel pump scene"

not

"that petrol station photograph"

---

# Art Direction

Target qualities:

* soft rounded illustration (Pets-inspired system, objects not mascots)
* premium, calm, minimal UI chrome
* simplified friendly forms with clear silhouettes
* generous negative space
* soft gradients and gentle ambient light
* limited palettes per mood

Avoid:

* industrial / mechanical / CNC aesthetic
* sharp geometric icon UI as final art
* hyper realism, HDR, photobashing
* Spotify Pet character cosplay (dogs, lime campaign skin)
* blob AI slop without readable structure

---

# Asset Creation Roadmap

Phase 1

Focus on ONE illustrated hero:

**Night Refuel — soft fuel pump**

Refine in Figma/SVG until it passes the Pets-style read test at card + hero size.

Do NOT attempt all 10 scenes until pump illustration language is locked.

Reject: industrial diagrams, geometric placeholders, AI mascot blobs.

---

Phase 2

Extract the common characteristics:

* shapes
* composition
* colour palette
* texture
* atmosphere

Create style guide from discoveries.

---

Phase 3

Create remaining 9 scenes using the established style.

All scenes must feel like:

different emotional worlds from the same universe.

---

# Motion Philosophy

Motion should be responsive.

Not cinematic.

Allowed:

* fades
* opacity shifts
* small hover responses

Avoid:

* camera systems
* parallax engines
* cinematic movement
* multi-layer animation stacks

---

# Success Test

A new user lands on Kwalify.

Within 5 seconds they understand:

"I describe a moment and it makes a playlist from my liked songs."

Within 30 seconds they feel:

"That actually understands me."

If a feature does not improve one of those two outcomes, it should not be prioritised.

---

# Ultimate Goal

Create a product that feels:

* memorable
* emotionally intelligent
* visually distinctive
* easy to understand

The ideal outcome is not:

"this is technically impressive"

The ideal outcome is:

"I keep coming back because it gets me."
