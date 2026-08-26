# Human-expectation spotcheck

**Question:** Does Kwalify currently curate like a human would?

**Answer: partial, and the internal gates are lying.** On locked genre worlds (red dirt, UK garage, 80s synth-pop) a person might save a short set. On everyday scenes (summer commute, rainy walk, coding, disco party, Christmas) live lists are either empty refuses or a repeating library landfill. Blind pairwise vs human playlists is the repo’s own trustworthy metric (~50% win target). That measurement has never been completed on live lists. Offline it sits at 53% overall and **20% on functional prompts**, while opening-pass / golden-prompt rates print as 100%.

This is a listen-style review of **real generated track lists**. Nothing here is invented.

---

## How this was produced

Zack asked to generate new playlists first. That path is blocked in this environment:

| Requirement | Status |
|---|---|
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | unset — `/api/generate` returns **503 `SPOTIFY_DISABLED`** without them |
| `PLAYLIST_EVAL_TOKEN` | unset — audit generate cannot authorize |
| `DATABASE_URL` + liked library | unset — no `koalablade` library to curate from |
| Local API (`npm start`, `:5000`) | not running |
| Production `https://kwalify.net` | unreachable from this pod (Cloudflare 1033) |
| `USE_MOCK_SPOTIFY` | rejected — mock library invents fake artists (`Mason Wilder`, `Velvet June`). User rule: never invent track lists |

No product code was changed. Evaluation only.

### Sources (newest real lists, not unit-test fixtures)

1. **Newest full artist–title lists in git:** V19-C frozen deliveries in `backend/scripts/v19-saveability-rescore.mjs` (authoritative live run, freeze dated with V19 / 11 Aug 2026). Full lists, but short (2–9 tracks).
2. **Largest live dump with first-10s:** GitHub Actions artifact `live-fault-diagnosis-500-28303914871` (2026-06-28, production commit `f27f3d1`, user `koalablade`, `https://kwalify.net` audit). 498 runs. Field `firstTen` is the actual opener. Subset saved as `live-fault-2026-06-28-subset.json`.
3. **Live reliability (same week, no track names):** prompt-reliability 2/25 pass; production-evidence 0/65 E2E success and “human-save YES” with **empty** opening tens.
4. **Offline pairwise (not live generate):** `backend/tests/playlist-quality-benchmark/experiments/opening-curator-v2-locked-benchmark-2026-07-07T00-25-35-789Z-c1b56c.json` — simulated/perturbed human references, **REJECT** overall, 53.3% preference win, opening pass rate 100%.
5. **Human expectation references** (what a person would typically put): `data/corpus/pairwise-benchmark-prompts.json` and `HUMAN_100_PROMPTS`.

V19 is later than the June live dump. Where both exist, V19 is treated as the newer full list; June 28 is treated as the last time everyday *scene* prompts actually shipped 25-track lists we can read.

---

## Headline verdicts

| # | Prompt | Human would make this? | Gate vs ears |
|---|---|---|---|
| 1 | Feel-good summer morning commute | **NO** | Gate **passed**. List is landfill. |
| 2 | Rainy city / rainy highway | **NO** (shipped) / refuse on the walk prompt | Gate **passed** the highway list. Same opener template. |
| 3 | Gym | **NO** as a playlist | Live gym **422**. V19 is a 3-song AC/DC stub. |
| 4 | 70s disco party | **NO** | Timeout-fallback shipped dad-rock. |
| 5 | UK hip hop / UKG / grime | **PARTIAL** (UKG short set) / **NO** (old-school hip hop) | UKG is the rare on-world list. Grime 422. |
| 6 | Coding / focus | **NO** | Stutter-techno and indie rock. One gate-pass is a lie. |
| 7 | Goth but danceable | **NO** (empty) | 409 refuse — honest, still not a playlist. |
| 8 | Country / red dirt | **YES** (best live list) | Inner would-save **true**; outer `humanSaveable` **false** (timeout fallback). Gate lies the other way. |
| 9 | Christmas party | **NO** | Wham! then System of a Down. |
| 10 | Winter, not Christmas | **NO** (empty) | 409 coherence refuse. Did not leak Christmas; also did not deliver winter. |
| 11 | No rap gym | **PARTIAL** on V19 stub | Live 422. V19 metal is the right world, too short. |
| 12 | Study / cozy rain | **NO** | Gate **passed** both. Same My Summer Car / Fugazi template. |

**Would a human make these themselves?** **Partial — mostly no.** Locked cowboy/UKG/80s-synth pockets can land. Everyday prompts do not.

---

## Repo judges vs ears

The repo says the north star is **blind pairwise vs human playlists**, target ~50% win, **not** internal gate pass-rate (`docs/human-curation-alignment-v2.md`, `backend/scripts/pairwise-human-playlist-benchmark.ts`, `data/corpus/human-benchmark-baseline-pre-fix.json`).

What the numbers actually show:

| Metric | Value | Trust? |
|---|---|---|
| Live `humanSaveable=true` on summer morning / rainy highway / study / cozy rain | true | **No.** Those four share a Heikki Mustonen → Fugazi opener. |
| June 28 live `humanSaveableRate` | 29.9% of 498 | Weak. Many “passes” are the same landfill. |
| June 28 HTTP 200 success | 39% | Mix of real lists and timeout-fallback trash. |
| Prompt-reliability 2026-06-28 | 8% (2/25) | Closer to lived quality than save-rate. |
| Production evidence 2026-06-24 | 6/6 scene-world “human save YES” with **blank** opening 10 | Gate can pass with no songs. |
| Offline OC2 `openingPassRate` | 100% | **Lying.** Preference win 53% overall, **20% functional**. |
| Offline OC2 `goldenPromptsPassed` | 59/59 | Same run was overall **REJECT**. |
| Blind pairwise vs human (live) | `null` — never completed | This is the missing measurement. |
| Pre-fix baseline | 80%+ HTTP 422, “gate passed incoherent playlists” | Matches what the June lists still look like. |

`humanSaveable: passed` on a playlist that opens with a Finnish video-game soundtrack is the definition of the gate lying.

---

## Per-prompt listen notes

Human-keep labels below are **this reviewer’s** application of `backend/scripts/human-keep-judge.ts` rules (SAVE / PARTIAL_OK / MAYBE / SKIP / REFUSE_OK / EMPTY_BAD) plus ears. Live HQG action was not stored as `pass | honest_partial | refuse`; we report the dump’s `humanSaveable` and `wouldISave.combinedScore` instead.

Prompts 1–2, 4–7, 9–10, 12 use June 28 live `firstTen` (count is full delivered length; only first 10 were stored). Prompts 3, 8, 11 also cite V19 full lists.

---

### 1. Summer morning commute — **NO**

**Prompt:** `Feel-good summer morning music to hype yourself up for the day, getting ready, and commuting to work.`  
Corpus: `summer_morning` / pairwise reference.

**What a human would put:** Bright indie-pop / feel-good commute. Wallows, Dayglow, Rex Orange County, Jake Bugg, maybe Arctic Monkeys — one world, windows-down, no metal, no 8 Mile. Reference opener: Wallows — Remember When.

**Actual (live 2026-06-28, 25 tracks, first 10):**

1. Heikki Mustonen — Routainen Maa (My Summer Car Soundtrack)
2. Fugazi — I'm So Tired
3. Oasis — Don't Look Back In Anger - Remastered
4. Oasis — Champagne Supernova - Remastered
5. Oasis — Morning Glory - Remastered
6. Eminem — Lose Yourself - From "8 Mile" Soundtrack
7. Gang Starr — Work
8. Chad VanGaalen — Stuttering Light
9. Will Varley — King for a King
10. Madness — Embarrassment - 2010 Remaster

**Judges:** HTTP 200. `humanSaveable=true`. `wouldISave.combined=0.62` with **inner `humanSaveable=false`**. Rejection: `human_saveable:passed`. World tag: none.

**Ears:** SKIP. Opener is a game OST. Then post-hardcore, three Oasis songs in a row, then gym-rap. Algorithm smell is immediate. A Spotify user would not save this. **Gate passed anyway.**

---

### 2. Rainy city walk / rainy highway — **NO** (shipped) / refuse on the walk

**Prompts:**  
- Human corpus: `rainy city morning walk with reflective mood` (`rainy_walk`)  
- Live shipped: `rainy highway driving` (`drive-rainy-highway`)

**What a human would put:** Wet pavements, low voice, one indie/folk world — Bon Iver, Phoebe Bridgers, The National, Fleet Foxes. Not a party, not a rave, not a game soundtrack.

**Actual rainy walk (live):** HTTP **422**, 0 tracks. Error: `Human saveability gate failed … interleaver audit failed: opening cluster purity degraded`. World tag `indie_folk_rain_walk`. Verdict: **EMPTY_BAD / almost REFUSE_OK** — it refused rather than ship, which is better than prompt 1.

**Actual rainy highway (live, 30 tracks, first 10):**

1. Heikki Mustonen — Routainen Maa (My Summer Car Soundtrack)
2. Fugazi — I'm So Tired
3. Bloc Party — Positive Tension
4. Noah Kahan — Your Needs, My Needs
5. Oasis — Champagne Supernova - Remastered
6. Dexter and The Moonrocks — Freakin’ Out
7. Steely Dan — Only A Fool Would Say That
8. Baltazar Lora — There She Goes
9. Val Texas — JEAN SHORTS
10. Malcolm Todd — Sweet Boy

**Judges:** `humanSaveable=true`. combined 0.63, inner false. Same `human_saveable:passed`.

**Ears:** SKIP. Same Mustonen → Fugazi template as summer morning. That is shuffle-from-library, not a rainy drive. A human highway mix might be The War on Drugs / Chromatics / The Cure (see V19 motorway below) — this is not that.

**V19 motorway (newer, 5 tracks, better world):** New Order — Blue Monday '88; Chromatics — Cherry; The Cure — The Lovecats; The Cure — Boys Don't Cry; Tears For Fears — Head Over Heels. **PARTIAL** — right nocturnal lane, too short, two Cure songs, Lovecats is jaunty for midnight rain. A person might play it once, not save it as “the” rainy motorway playlist.

---

### 3. Gym — **NO** as a playlist

**Prompts:** `gym confidence boost high energy workout` (`gym_boost`); V19 `heavy gym workout aggressive`; also `2000s pop punk gym workout`.

**What a human would put:** Immediate pump. Either hip-hop/EDM (Eminem, Kanye, Guetta — the corpus reference) or rock/metal if that’s the library. Track 1 has to hit. No ballads, no Jack Stauber.

**Actual gym_boost (live):** HTTP **422**, 0 tracks. Gate failed after retries: `wouldSaveScore 0.769 < 0.78`; opening cluster purity 2/5. Honest refuse of a weak gym. **REFUSE_OK**.

**Actual 2000s pop punk gym (live, 30 tracks, first 10):**

1. Mogwai — Take Me Somewhere Nice
2. The Hellacopters — Murder On My Mind
3. Iggy Pop — The Passenger
4. Jack Stauber — Buttercup
5. The Hellacopters — I'm In The Band
6. Jack Stauber — Oh Klahoma
7. Poppy — I Disagree
8. BROCKHAMPTON — SUGAR
9. Jim Legxacy — candy reign (!)
10. System Of A Down — Aerials

**Judges:** HTTP 200, `humanSaveable=false`, timeout fallback. combined 0.73.

**Ears:** SKIP. Mogwai post-rock is the opposite of a gym opener. Two Jack Stauber novelty tracks. Not 2000s pop punk (no Blink, Paramore, Green Day, FOB).

**V19 heavy gym (3 tracks):** AC/DC — Back In Black; AC/DC — T.N.T.; Guns N' Roses — Welcome To The Jungle. **PARTIAL** — a human *would* put these on a gym playlist, but three songs is a stub, not a product. Human-keep: PARTIAL_OK at best.

---

### 4. 70s disco party — **NO**

**Prompt:** `70s disco party dancefloor` (`party-70s-disco`). Human: Bee Gees, Chic, Donna Summer, dancefloor from bar 1.

**Actual (live, 30 tracks, first 10):**

1. Funkadelic — Hit It and Quit It
2. Iggy Pop — The Passenger
3. Linda Ronstadt — Long Long Time
4. Harmful Logic — 100PERCENTFEELINGS
5. Pink Floyd — Another Brick In The Wall, Pt. 2 - 2011 Remastered Version
6. Cher — Gypsys, Tramps & Thieves
7. Shuggie Otis — Sweet Thang
8. Lynyrd Skynyrd — Sweet Home Alabama
9. GRLwood — Get Shot
10. Eagles — Witchy Woman - 2013 Remaster

**Judges:** `humanSaveable=false`, timeout fallback. combined 0.74 (too high for this list).

**Ears:** SKIP. Funkadelic is the only disco-adjacent thought. Then proto-punk, a ballad, Pink Floyd, southern rock. Wrong decade-culture. A party would die at track 3.

**V19 disco rooftop 1978 (2 tracks):** Michael Jackson — Rock with You; ABBA — Gimme! Gimme! Gimme!. **PARTIAL** honest stub — those two belong; 2/30 is not a disco party. V16 archive of the same prompt was worse (Otis Redding, Warren G Regulate, The Black Keys, Princess Nokia). Later freeze got *shorter and cleaner*, not longer and better.

---

### 5. UK hip hop / UK garage / grime — **PARTIAL / NO**

**What a human would put:**  
- UKG late drive: Artful Dodger, Craig David, MJ Cole, Conducta, Sweet Female Attitude.  
- UK hip hop / grime: Skepta, Dave, Headie One, Stormzy, Dizzee — not Jonas Brothers.

**Actual late night UK garage (live, 11/25, first 10):**

1. Craig David — Rewind
2. KURUPT FM — Dreaming (feat. Jaykae & MIST)
3. KURUPT FM — Blaze It (feat. Big Narstie)
4. Conducta — Whippet
5. Craig David — When the Bassline Drops
6. KURUPT FM — Your Mum Loves Garage
7. Artful Dodger — Re-Rewind (feat. Craig David)
8. Sweet Female Attitude — Flowers - Sunship Radio Edit
9. MJ Cole — Pictures In My Head - High Contrast Remix
10. ALEXYS — Wasting My Time - Speed Garage

**Judges:** `humanSaveable=false` (timeout fallback) but combined **0.78**. World is obviously UKG.

**Ears:** **YES, with an asterisk.** This is the playlist a UKG fan would actually send. Three KURUPT FM cuts is club-DJ repetition, not editorial spacing, and 11 tracks is an honest partial. Human-keep: **PARTIAL_OK / SAVE** if you accept short. One of the only lists here that passes the friend test.

**Actual old school hip hop (live, 25 tracks, first 10):**

1. gnash — Tell Me It's Okay
2. ArrDee — Oliver Twist
3. Jonas Brothers — Sucker
4. Chelsea Wolfe — Advice & Vices
5. Common Courtesy — I Can't Say I Meant It When I Said I'm Fine
6. Skepta — Back 2 Back
7. Nas — N.Y. State of Mind
8. ProdMarvin — Otra Vez
9. Headie One — 18HUNNA (feat. Dave) - Four Tet Remix
10. Harvey Whyte — Mocktails and Weed

**Judges:** `humanSaveable=true`, combined **0.80**, inner true. **This is the most dangerous pass.**

**Ears:** SKIP. Jonas Brothers on an old-school hip hop playlist. Chelsea Wolfe (goth/folk). Nas at 7 is the first real hit. Gate scored this *higher* than the good UKG list.

**Grime walk / freshers UKG-grime:** both HTTP **422** `insufficient_intent_pool`. EMPTY. A human with a UK library would still expect *something* for freshers; refuse is better than Jonas Brothers, worse than the UKG 11-track.

---

### 6. Coding / focus — **NO**

**Prompt:** `deep focus coding session late evening electronic ambient` (`focus_coding`). Human: Aphex Twin, The xx intro, Massive Attack, Moby — low vocal pull.

**Actual (live, 25 tracks, first 10):**

1. MØRTY — ENTER THE RAVE
2. Sonny Wern — Dance For Me (1, 2, 3) - Stutter Techno
3. Spencer Ramsay — Beat Goes On - DnB Flip
4. Jax Jones — House Work
5. KegOne — Run Wi D Riddim
6. Macky Gee — Rave To The Grave
7. STUTTER TECHNO — WE ARE THE PEOPLE - STUTTER
8. Tiny Little Houses — Garbage Bin
9. System Of A Down — Aerials
10. YONAKA — Don't Wait 'Til Tomorrow

**Judges:** `humanSaveable=false`, timeout fallback. combined 0.58. **Gate correctly refused save.**

**Ears:** SKIP. This is a TikTok rave playlist with a metal closer. Unusable for coding.

**Sister prompt `calm coding focus` (gate PASSED, 30 tracks):** Killers, Oasis, Arctic Monkeys, Local H, Bon Iver, Bloc Party, Beach House, Amy Winehouse, MGMT, Madness. Indie radio, not focus. **Gate lying again.**

---

### 7. Goth but danceable — **NO** (empty)

**Prompt:** `goth but danceable` (`launch-calibration-085`). Human: The Cure, Siouxsie, Depeche Mode, New Order, Bauhaus — dark but you can move. Corpus `h32` / `h83`.

**Actual:** HTTP **409**, 0 tracks. `COHERENCE_GATE_FAILED` in Strict. **REFUSE_OK** — better than padding with Queen. Still: a human with The Cure in-library (this library clearly has The Cure; see V19 motorway) *could* have made this. The system chose refuse over a Cure/New Order set.

**Human-keep:** REFUSE_OK. **Would a human make this themselves?** No output to judge. Capability looks like a miss, not a principled goth playlist.

---

### 8. Country / red dirt — **YES**

**Prompt:** `american country cowboy red dirt` (`genre-red-dirt`). Human: outlaw / red dirt / Americana — Stapleton, Childers, Zach Bryan, Colter Wall, 49 Winchester. Not John Denver twice and a random 2023 “Country Road Trip” search hit.

**Actual (live, 30 tracks, first 10):**

1. Chris Stapleton — Tennessee Whiskey
2. 49 Winchester — Annabel
3. Luke Combs — Beer Never Broke My Heart
4. Tyler Childers — Shake the Frost (Live)
5. Treaty Oak Revival — Missed Call
6. Kenny Chesney — Knowing You
7. Luke Combs — Beautiful Crazy
8. Tyler Childers — Feathered Indians
9. Sierra Ferrell — I Could Drive You Crazy
10. Colter Wall — Living on the Sand

**Judges:** outer `humanSaveable=false` because **timeout fallback**; inner would-save **true**, combined **0.83**.

**Ears:** **SAVE.** This is the one I would actually keep. Right world from track 1. Two Luke Combs / two Childers is a bit radio-repeat, Chesney is more gulf-and-western than red dirt, but a country fan would not skip the opener. **The gate marking this unsavable while passing summer-morning landfill is the sharpest proof that pass-rate is lying.**

**V19 country cowboy road trip (7 tracks):** Johnny Cash — Jackson; Luke Combs — Dive; Zach Bryan ×3; Waylon Jennings. Also **SAVE / PARTIAL_OK** — on-world, short, Zach-heavy.

---

### 9. Christmas party — **NO**

**Prompt:** `xmas party actual christmas` (`launch-calibration-049`). Human: Wham!, Mariah, Slade, The Pogues, maybe a soul Christmas cut. Stay in the holiday lane.

**Actual (live, 30 tracks, first 10):**

1. Wham! — Last Christmas
2. System Of A Down — Aerials
3. YONAKA — Don't Wait 'Til Tomorrow
4. Indo — R U Sleeping - Bump 'N' Flex Remix
5. M|O|O|N — Hydrogen
6. Blonde — I Loved You (feat. Melissa Steel)
7. dialE — Made In The East
8. Finn — Lovesick
9. Beyoncé — Drunk in Love (feat. JAY-Z)
10. Bedside Kites — A Sad Song About a Girl I No Longer Know

**Judges:** `humanSaveable=false`, timeout fallback.

**Ears:** SKIP. Track 1 is correct; track 2 is a metal ballad. Seasonal identity dies immediately. Doctrine says wanted-Christmas with empty supply must refuse, not invent pop fillers. This invented (or fallback-filled) non-Christmas after one hit.

---

### 10. Winter, not Christmas — **NO** (empty)

**Prompts:** `winter but no christmas obviously`; also `not christmas winter warmth`, `winter cozy not christmas`. Corpus `h61` / `h75`.

**What a human would put:** Cold-weather indie/folk/soul **without** sleigh bells — Bon Iver, Fleet Foxes, maybe The Antlers. Hard suppress on Christmas.

**Actual:** HTTP **409** coherence fail (or cancelled). 0 tracks. Did **not** leak Christmas, which is the hard rule. Also did not produce a winter playlist.

**Human-keep:** REFUSE_OK on negation, EMPTY_BAD as a product. **Would a human make this?** No list.

---

### 11. No rap gym — **PARTIAL** (V19 only)

**Live prompt:** `no rap just heavy workout` — HTTP **422**, `opening_eligible=4<5`. EMPTY.

**V19 `no rap gym workout` (5 tracks, full list):**

1. Black Sabbath — Paranoid
2. Black Sabbath — Rat Salad
3. Iron Maiden — Fear of the Dark
4. Nirvana — In Bloom
5. Black Sabbath — Iron Man

**What a human would put:** Metal/rock gym, **zero** Drake/Kendrick. Paranoid / Iron Man / Fear of the Dark belong. Rat Salad is a drum-solo album cut most people would skip on a gym playlist. Three Sabbath tracks in five is shuffle-artist-radio.

**Ears:** PARTIAL_OK. Right world, respects `no rap`, too short, opener is good, Rat Salad is a smell. Live generation of the same idea later **refused** instead of shipping this stub.

---

### 12. Study session / cozy rainy night — **NO**

**Study prompt:** `music for thinking and study session focus`. Human: Weightless, Aphex Twin, The xx — low distraction.

**Actual study (live, 30 tracks, first 10):**

1. Wallows — Remember When
2. The Jungle Giants — Lights & Music - triple j Like A Version
3. General Levy — Jah Jah Bless
4. Beach House — Master of None
5. Title Fight — Safe In Your Skin
6. Deftones — Sextape
7. Bon Iver — Rosyln
8. Saliva — Click Click Boom
9. The Marías — Hush - Still Woozy Remix
10. Heikki Mustonen — Routainen Maa (My Summer Car Soundtrack)

**Judges:** `humanSaveable=true`. combined 0.58 inner false.

**Ears:** SKIP. Jungle Giants / Wallows is the “indie nucleus” V22 already called out as a template. Then jungle/reggae, emo, nu-metal (Saliva), game OST. Unstudyable. **Gate passed.**

**Cozy rainy night chill (same dump, also gate-passed):** Mustonen, Fugazi, Chad VanGaalen, Will Varley, Karen O, Lola Young, Debbie Harry, Oasis, Madness, Deftones. Same skeleton as summer morning. **SKIP.**

---

## Bonus: V19 80s night drive (newer freeze, not in the June 12)

**Prompt:** `80s night drive`  
**Full list (7):** The Cure — The Lovecats; Tears For Fears — Everybody Wants To Rule The World; Tears For Fears — Head Over Heels (two mixes); Gary Numan — Cars; The Human League — Don't You Want Me; Pet Shop Boys — West End Girls.

**Ears:** **YES / PARTIAL.** This is a human 80s drive. Duplicate Head Over Heels is sloppy. Short. Still the second-best list in the whole spotcheck after red dirt.

---

## Where generation wins

- **Hard genre locks with supply in the library:** red dirt, UK garage, 80s synth-pop, Cash/Combs/Bryan country, Sabbath/Maiden metal. Belonging beats audio-feature averaging here.
- **Honest refuse** on some identity failures (goth 409, gym_boost 422, winter-not-christmas 409, rainy_walk 422) instead of always padding. Doctrine-correct when it happens.
- V19 disco/gym stubs are *cleaner* than V16 padded disco (Regulate + Black Keys on a 1978 rooftop). Shorter, less wrong.

## Where it fails

- **Everyday scenes collapse to one landfill template:** Heikki Mustonen → Fugazi → Oasis, reused on summer, rain, and cozy. That is the opposite of human curation.
- **Timeout fallback ships 30 tracks of wrong-world** (disco, Christmas, focus, pop-punk gym, underground hip hop) with `humanSaveable=false` but still a user-visible list.
- **Wrong-world bleed** is severe: Jonas Brothers on old-school hip hop; SOAD on Christmas; Pink Floyd on 70s disco; stutter-techno on coding.
- **Artist radio:** three Oasis, three Sabbath, three KURUPT FM, two Jack Stauber.
- **Underfill / stub:** many “successes” are 2–11 tracks against 25–30 asked. Doctrine: do not ship stubs as success.
- **UK hip hop / grime / goth / focus / gym** often empty even when the library clearly contains Cure, AC/DC, Skepta, Nas.

## Is the gate lying?

**Yes.**

1. Passes summer morning, rainy highway, study, cozy rain, old-school hip hop — lists a person would skip.
2. Fails (or timeout-marks unsavable) the best list (red dirt, combined 0.83) and the good UKG 11-track.
3. Offline opening-pass 100% / golden 59/59 while pairwise functional win is 20% and the run is REJECT.
4. June 24 production-evidence: 6/6 “human save YES” with empty opening tens.
5. Inner `wouldISave.humanSaveable` is often **false** at the same time the outer flag is **true**. Even the two save scores disagree.

Trust **ears and pairwise**, not `humanSaveableRate`.

---

## Would a human make this themselves?

**Partial — mostly no.**

If you only sampled red dirt, UKG, and 80s night drive, you could believe Kwalify is a curator. If you sampled the prompts real people actually type (summer, rain, gym, coding, disco, Christmas), you would not save the playlist, would not send it to a friend, and would not replay it next week.

Until live generate can be run in an environment with Spotify + `PLAYLIST_EVAL_TOKEN` + the `koalablade` library, this is the newest honest listen evidence. It is **not** a current-HEAD live regenerate (V37/V38 coverage-cap work landed after these dumps and did not commit new track lists).

---

## Files

- `live-fault-2026-06-28-subset.json` — extracted live runs used above
- `v19-c-frozen-tracklists.json` — full V19-C lists from git
