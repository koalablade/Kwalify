# Kwalify product promise

> Understand where I am, what I'm doing, how I'm feeling, where I want to go emotionally, and use my own music history to soundtrack that moment.

## How the engine maps to each clause

| Promise | Engine |
|---------|--------|
| **Where I am** | Time / place / weather layers · experience scenes · knowledge graph |
| **What I'm doing** | Motion layer (driving, transit, walking, gym…) |
| **How I'm feeling** | Emotion keywords · mixed feelings · contradiction phrases |
| **Where I want to go** | Emotional destination (`anxious → calm`, `want to feel motivated`) · journey arc |
| **My own music history** | Full synced **liked songs** scored · rediscovery · chapters · archaeology · no external catalog |

## API: `momentUnderstanding`

Every successful `POST /api/generate` returns:

```json
{
  "momentUnderstanding": {
    "promise": "...",
    "where": { "time", "place", "scene", "season", "social" },
    "doing": { "motion", "summary" },
    "feeling": { "current", "mixed", "energy", "valence" },
    "destination": { "desired", "journeyArc", "arcDescription" },
    "soundtrack": {
      "source": "liked_songs",
      "librarySize": 4546,
      "tracksSelected": 25,
      "rediscoveryMode": "balanced",
      "usesForgottenFavourites": true,
      "chapter": "2019",
      "surpriseMix": { ... }
    },
    "summary": "Where: late night, urban · Doing: driving · ..."
  }
}
```

Use `summary` for debug or a future “here’s what I heard” UI — not required for generation.

## Example vibe (full promise)

```
Late summer evening, driving home from seeing old friends — nostalgic but want calm,
not sad. Surface something I forgot I loved.
```

Kwalify should infer: **evening · driving · friends/nostalgia · destination calm · rediscovery/archaeology · playlist from likes only**.

## What Kwalify is not

- Not a mood slider app
- Not Spotify’s algorithm (no their discovery pool)
- Not genre-only matching

It is an **AI DJ for moments**, built from **your** library and **your** words.
