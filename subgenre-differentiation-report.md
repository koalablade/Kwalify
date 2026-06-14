# Subgenre Differentiation Report

Generated: 2026-06-14

Scope: read-only source verification plus offline candidate diagnostics. The diagnostic used the built `buildLockedIntent()` output and a taxonomy-derived candidate universe to verify identity extraction and ordering pressure. It does not call Spotify and should not be read as a live recommendation benchmark.

Definitions:

- `Top20 overlap` measures candidate ordering overlap in the first 20 ranked candidates.
- `Top50 overlap` measures broad candidate-pool overlap in the first 50 ranked candidates.
- `Artist overlap` follows the same top-20/top-50 split.
- High `Top50 overlap` can be acceptable when sibling subgenres share a parent family; high `Top20 overlap` is the stronger collapse signal.

## Verdict

The system can now distinguish the tested sibling subgenres at the structured identity level. Every tested prompt produced a distinct `primarySubgenre`, and top-20 ordering changed materially for most pairs.

The system is not fully isolated at the broad candidate-pool level. D&B and trance still share large top-50 parent-family pools, which means they are no longer collapsing in identity extraction, but broad retrieval pools can still overlap heavily. The current behavior is best described as: structured identity is fixed; broad pool separation is partial.

Summary:

- Structured identity: PASS. No tested pair shares the same `primarySubgenre`.
- Candidate ordering: PASS/PARTIAL. Top-20 overlap is usually low, but some sibling pairs remain around 45-55%.
- Broad candidate pools: PARTIAL. Top-50 overlap remains high for D&B and trance because parent-family candidates are still retained.
- Collapse status: not collapsing to the same structured intent; still sharing parent-family candidate pools.

## Identity Signatures

| Group | Prompt | primaryGenre | primarySubgenre | secondarySubgenre | genreFamilies | subgenreTerms |
|---|---|---|---|---|---|---|
| D&B | Liquid D&B | electronic | liquid_dnb | dnb | electronic | liquid_dnb, dnb |
| D&B | Jump Up D&B | electronic | jump_up_dnb | dnb | electronic | jump_up_dnb, jump up, jump-up, dnb |
| D&B | D&B rollers | electronic | dnb_rollers | dnb | electronic | dnb_rollers, rollers, dnb |
| D&B | Neurofunk D&B | electronic | neurofunk | dnb | electronic | neurofunk, dnb |
| Techno | Industrial Techno | electronic | industrial_techno | hard_techno | electronic | industrial_techno, industrial techno, hard_techno, techno |
| Techno | Hardgroove Techno | electronic | hardgroove | hard_techno | electronic | hardgroove, hard groove, hard_techno, techno |
| Techno | Schranz Techno | electronic | schranz | hard_techno | electronic | schranz, hard_techno, techno |
| Techno | Warehouse rave techno | electronic | rave | peak_time_techno | electronic | rave, warehouse rave, peak_time_techno, rave techno, techno |
| Trance | Uplifting Trance | electronic | uplifting_trance | trance | electronic | uplifting_trance, uplifting trance, trance |
| Trance | Tech Trance | electronic | tech_trance | trance | electronic | tech_trance, tech trance, trance |
| Trance | Hard Trance | electronic | hard_trance | trance | electronic | hard_trance, hard trance, trance |
| Metal | Black Metal | metal | black_metal |  | metal | black_metal, black metal |
| Metal | Doom Metal | metal | doom_metal |  | metal | doom_metal, doom metal |
| Metal | Death Metal | metal | death_metal |  | metal | death_metal, death metal |

## Pairwise Metrics

### Drum & Bass

| Pair | Candidate overlap top20 | Candidate overlap top50 | Artist overlap top20 | Artist overlap top50 | Genre/subgenre distribution |
|---|---:|---:|---:|---:|---|
| liquid vs jump up | 5.0% | 80.0% | 11.1% | 80.5% | liquid: liquid_dnb/dnb_rollers/dancefloor_dnb/neurofunk; jump up: jump_up_dnb/dnb/dnb_rollers/dancefloor_dnb |
| liquid vs rollers | 55.0% | 80.0% | 55.6% | 78.0% | liquid: liquid_dnb/dnb_rollers/dancefloor_dnb/neurofunk; rollers: dnb_rollers/liquid_dnb/neurofunk/dnb |
| liquid vs neurofunk | 50.0% | 80.0% | 55.6% | 80.5% | liquid: liquid_dnb/dnb_rollers/dancefloor_dnb/neurofunk; neurofunk: neurofunk/dnb/jump_up_dnb/liquid_dnb |
| jump up vs rollers | 50.0% | 80.0% | 55.6% | 80.5% | jump up: jump_up_dnb/dnb/dnb_rollers; rollers: dnb_rollers/liquid_dnb/neurofunk |
| jump up vs neurofunk | 0.0% | 80.0% | 11.1% | 81.0% | jump up: jump_up_dnb/dnb_rollers; neurofunk: neurofunk/dnb |
| rollers vs neurofunk | 5.0% | 92.0% | 11.1% | 95.1% | rollers: dnb_rollers/liquid_dnb; neurofunk: neurofunk/dnb |

Top-20 candidate differences:

- liquid vs jump up: liquid top candidates are `liquid_dnb`; jump up top candidates are `jump_up_dnb`.
- liquid vs rollers: liquid retains `liquid_dnb` and `neurofunk`; rollers lifts `dnb_rollers`.
- liquid vs neurofunk: liquid lifts `liquid_dnb`; neurofunk lifts `neurofunk` and base `dnb`.
- jump up vs rollers: jump up lifts `jump_up_dnb`; rollers lifts `dnb_rollers` and `liquid_dnb`.
- jump up vs neurofunk: top-20 sets fully separate; jump up is `jump_up_dnb`/`dnb_rollers`, neurofunk is `neurofunk`/`dnb`.
- rollers vs neurofunk: top-20 sets almost fully separate; rollers is `dnb_rollers`/`liquid_dnb`, neurofunk is `neurofunk`/`dnb`.

Interpretation: D&B is structurally differentiated, but broad top-50 overlap remains high. Liquid/rollers/neurofunk still share enough related D&B pool mass that top-20 overlap can remain around 50-55% for some pairs.

### Techno

| Pair | Candidate overlap top20 | Candidate overlap top50 | Artist overlap top20 | Artist overlap top50 | Genre/subgenre distribution |
|---|---:|---:|---:|---:|---|
| industrial vs hardgroove | 50.0% | 78.0% | 55.6% | 81.0% | industrial: hard_techno/industrial_techno; hardgroove: hardgroove/hard_techno |
| industrial vs schranz | 50.0% | 62.0% | 55.6% | 66.7% | industrial: industrial_techno/hard_techno; schranz: schranz/hard_techno/techno |
| industrial vs warehouse rave | 0.0% | 60.0% | 11.1% | 61.0% | industrial: industrial_techno/hard_techno; warehouse rave: peak_time_techno/rave |
| hardgroove vs schranz | 50.0% | 54.0% | 55.6% | 59.5% | hardgroove: hardgroove/hard_techno; schranz: schranz/techno |
| hardgroove vs warehouse rave | 0.0% | 42.0% | 11.1% | 41.5% | hardgroove: hardgroove/hard_techno; warehouse rave: peak_time_techno/rave |
| schranz vs warehouse rave | 0.0% | 42.0% | 11.1% | 46.3% | schranz: schranz/hard_techno/techno; warehouse rave: peak_time_techno/rave |

Top-20 candidate differences:

- industrial vs hardgroove: industrial top candidates are `industrial_techno`; hardgroove top candidates are `hardgroove`.
- industrial vs schranz: industrial lifts `industrial_techno`; schranz lifts `schranz` plus adjacent `techno`.
- industrial vs warehouse rave: top-20 sets fully separate; warehouse rave lifts `peak_time_techno` and `rave`.
- hardgroove vs schranz: hardgroove lifts `hardgroove`; schranz lifts `schranz` and base `techno`.
- hardgroove vs warehouse rave: top-20 sets fully separate; hardgroove is `hardgroove`/`hard_techno`, warehouse rave is `peak_time_techno`/`rave`.
- schranz vs warehouse rave: top-20 sets fully separate; schranz is `schranz`/`hard_techno`, warehouse rave is `peak_time_techno`/`rave`.

Interpretation: Techno separation is meaningfully improved. Industrial/hardgroove/schranz share hard-techno adjacency, but warehouse rave is clearly separated.

### Trance

| Pair | Candidate overlap top20 | Candidate overlap top50 | Artist overlap top20 | Artist overlap top50 | Genre/subgenre distribution |
|---|---:|---:|---:|---:|---|
| uplifting vs tech trance | 45.0% | 100.0% | 52.9% | 100.0% | both top50 contain hard_trance, psytrance, tech_trance, trance, uplifting_trance |
| uplifting vs hard trance | 10.0% | 100.0% | 16.7% | 100.0% | both top50 contain hard_trance, psytrance, tech_trance, trance, uplifting_trance |
| tech trance vs hard trance | 5.0% | 100.0% | 11.8% | 100.0% | both top50 contain hard_trance, psytrance, tech_trance, trance, uplifting_trance |

Top-20 candidate differences:

- uplifting vs tech trance: uplifting top candidates are `uplifting_trance`; tech trance top candidates are `tech_trance`.
- uplifting vs hard trance: uplifting lifts `uplifting_trance`/classic `trance`; hard trance lifts `hard_trance`/`psytrance`.
- tech trance vs hard trance: tech trance lifts `tech_trance`/classic `trance`; hard trance lifts `hard_trance`/`psytrance`.

Interpretation: Trance identity signatures and top-20 ordering separate, but top-50 pools fully overlap in this diagnostic because all tested trance subgenres live inside a compact parent-family universe. This is not identity collapse, but it is broad candidate-pool convergence.

### Metal

| Pair | Candidate overlap top20 | Candidate overlap top50 | Artist overlap top20 | Artist overlap top50 | Genre/subgenre distribution |
|---|---:|---:|---:|---:|---|
| black metal vs doom metal | 0.0% | 62.0% | 11.8% | 64.3% | black: black_metal/metalcore/doom_metal; doom: doom_metal/thrash/black_metal |
| black metal vs death metal | 0.0% | 58.0% | 11.1% | 64.3% | black: black_metal/metalcore/doom_metal; death: death_metal/black_metal/sludge_metal |
| doom metal vs death metal | 10.0% | 58.0% | 11.8% | 61.9% | doom: doom_metal/thrash; death: death_metal/sludge_metal |

Top-20 candidate differences:

- black metal vs doom metal: black metal top candidates are `black_metal`; doom metal top candidates are `doom_metal`.
- black metal vs death metal: black metal top candidates are `black_metal`; death metal top candidates are `death_metal`.
- doom metal vs death metal: doom metal top candidates are `doom_metal`; death metal top candidates are `death_metal`.

Interpretation: Metal separation is the strongest of the tested groups. Top-20 candidate overlap is 0-10%, and each sibling subgenre preserves distinct candidate ordering.

## Answer

Can the system now distinguish sibling subgenres?

Yes, at structured intent and top-candidate ordering levels. The implemented fields are active: `primaryGenre`, `primarySubgenre`, `secondarySubgenre`, and `subgenreTerms` are populated distinctly and influence candidate ordering.

Are they still collapsing to the same candidate pools?

Partially, only at broad pool breadth. D&B and trance still show high top-50 overlap because parent-family retrieval retains related sibling candidates. That is not the same as the previous parent-only collapse, but it means live outputs could still converge if Spotify metadata is sparse or if later selection stages favor adjacent siblings. Metal and warehouse-rave techno show strong separation.

## Risk Notes

- The diagnostic verifies identity extraction and ordering pressure, not live Spotify results.
- The remaining weakness is broad sibling-pool convergence, especially trance and D&B top-50 pools.
- If live playlists still feel too similar, the next fix should not be another parser change; it should be a small subgenre-aware retrieval/finalization preference threshold after candidate generation.
