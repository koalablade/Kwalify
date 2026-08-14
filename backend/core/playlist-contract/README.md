# PlaylistContract (V38 Prototype)

Intent-preserving single source of truth for playlist generation decisions.

## Schema

See `types.ts` — sections MUST / PREFER / MUST_NOT / CONTEXT / TENSION / UNKNOWN + `worldHypothesis`.

## Modules

| File | Role |
|------|------|
| `build-playlist-contract.ts` | Aggregates V37 parsers into contract |
| `compare-with-world.ts` | Detects contract vs CommittedWorld disagreements |
| `shadow.ts` | Flag-gated shadow logging (no output change) |
| `constraint-aware-retrieval.ts` | Track scoring against contract |
| `contract-validator.ts` | Terminal playlist audit |
| `honest-partial.ts` | Tension-aware honest partial messaging |
| `information-loss.ts` | A–M loss classification for forensics |
| `feature-flag.ts` | `PLAYLIST_CONTRACT_*` env flags |

## Flags

- `PLAYLIST_CONTRACT_SHADOW=1` — build + log contract disagreements (no output change)
- `PLAYLIST_CONTRACT_RETRIEVAL=1` — rerank orchestrator pool by contract score
- `PLAYLIST_CONTRACT_VALIDATION=1` — terminal audit shadow

V37 path unchanged when all flags off.
