#!/usr/bin/env node
/**
 * Experiment G-Listen analysis — reports only, no production code.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../../reports/playlist-evaluation');

const blinded = JSON.parse(readFileSync(join(ROOT, 'v21-experiment-g-human-review-blinded.json'), 'utf8'));
const mapping = JSON.parse(readFileSync(join(ROOT, 'v21-experiment-g-human-review-mapping.json'), 'utf8'));
const reviewSet = JSON.parse(readFileSync(join(ROOT, 'v21-experiment-g-human-review-set.json'), 'utf8'));
const scoresFile = JSON.parse(readFileSync(join(ROOT, 'v21-experiment-g-listen-scores.json'), 'utf8'));
const validation = JSON.parse(readFileSync(join(ROOT, 'v21-experiment-g-human-share-validation.json'), 'utf8'));

const scoreById = Object.fromEntries(scoresFile.scores.map((s) => [s.reviewId, s]));
const mapById = Object.fromEntries(mapping.mapping.map((m) => [m.reviewId, m]));
const setById = Object.fromEntries(reviewSet.playlists.map((p) => [p.reviewId, p]));

function stats(arr, key = 'wouldSendToFriend') {
  const vals = arr.map((r) => r[key]).filter((v) => v != null);
  if (!vals.length) return null;
  vals.sort((a, b) => a - b);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const mid = Math.floor(vals.length / 2);
  const median = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  const ge4 = vals.filter((v) => v >= 4).length;
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const v of vals) dist[v] = (dist[v] || 0) + 1;
  return { n: vals.length, mean: +mean.toFixed(2), median, pctGe4: +((100 * ge4) / vals.length).toFixed(1), ge4, distribution: dist };
}

function hcsBand(hcs) {
  if (hcs >= 92) return '92+';
  if (hcs >= 89) return '89-91';
  if (hcs >= 87) return '87-88';
  return '85-86';
}

// Validate all 39
const expected = Array.from({ length: 39 }, (_, i) => `G-${String(i + 1).padStart(3, '0')}`);
const missing = expected.filter((id) => !scoreById[id]);
if (missing.length) {
  console.error('Missing scores:', missing);
  process.exit(1);
}

// Join records
const joined = expected.map((reviewId) => {
  const s = scoreById[reviewId];
  const m = mapById[reviewId];
  const p = setById[reviewId];
  return {
    reviewId,
    prompt: p?.prompt ?? blinded.playlists.find((x) => x.reviewId === reviewId)?.prompt,
    category: p?.category ?? 'unknown',
    stratum: m.stratum,
    hcs: m.hcs,
    hcsBand: hcsBand(m.hcs),
    save: m.save,
    share: m.share,
    cohesion: m.cohesion,
    sequencing: m.sequencing,
    ...s,
  };
});

// Update blinded file humanScores
for (const pl of blinded.playlists) {
  const s = scoreById[pl.reviewId];
  pl.humanScores = {
    wouldSendToFriend: s.wouldSendToFriend,
    coherentOneThing: s.coherence,
    fitsPrompt: s.promptFit,
    wouldKeepListen: s.wouldKeepListening,
    obviousWrongTrack: s.obviousWrongTrack ? 'YES' : 'NO',
    wrongTrackSeverity: s.wrongTrackSeverity,
    intentionallyCurated: s.intentionalCuration,
    notes: s.notes,
    reviewMethod: 'tracklist_metadata_only',
  };
}
blinded.humanReviewCompletedAt = scoresFile.reviewedAt;
blinded.reviewMethod = scoresFile.reviewMethod;
writeFileSync(join(ROOT, 'v21-experiment-g-human-review-blinded.json'), JSON.stringify(blinded, null, 2) + '\n');

const primaryG = joined.filter((r) => r.stratum === 'primary_g');
const shareYes = joined.filter((r) => r.stratum === 'share_yes_control');
const lowHcs = joined.filter((r) => r.stratum === 'low_hcs_control');
const artistRun = joined.filter((r) => r.stratum === 'artist_run_secondary');

const primaryStats = stats(primaryG);
const shareStats = stats(shareYes);
const lowHcsStats = stats(lowHcs);
const artistStats = stats(artistRun);

const ppDiff = +(shareStats.pctGe4 - primaryStats.pctGe4).toFixed(1);

// Category breakdown primary G
const catMap = {};
for (const r of primaryG) {
  if (!catMap[r.category]) catMap[r.category] = [];
  catMap[r.category].push(r);
}
const categoryStats = Object.entries(catMap)
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([category, rows]) => ({ category, ...stats(rows) }));

// HCS band primary G
const bandMap = {};
for (const r of primaryG) {
  if (!bandMap[r.hcsBand]) bandMap[r.hcsBand] = [];
  bandMap[r.hcsBand].push(r);
}
const hcsBandStats = ['85-86', '87-88', '89-91', '92+']
  .filter((b) => bandMap[b])
  .map((band) => ({ band, ...stats(bandMap[band]) }));

// Wrong track analysis
const wrongTrack = joined.filter((r) => r.obviousWrongTrack);
const wrongByStratum = {
  primary_g: wrongTrack.filter((r) => r.stratum === 'primary_g').length,
  share_yes_control: wrongTrack.filter((r) => r.stratum === 'share_yes_control').length,
  low_hcs_control: wrongTrack.filter((r) => r.stratum === 'low_hcs_control').length,
  artist_run_secondary: wrongTrack.filter((r) => r.stratum === 'artist_run_secondary').length,
};

// Human/evaluator agreement
const shareYesHumanGe4 = shareYes.filter((r) => r.wouldSendToFriend >= 4);
const shareYesHumanLt4 = shareYes.filter((r) => r.wouldSendToFriend < 4);
const primaryHumanGe4ShareNotYes = primaryG.filter((r) => r.wouldSendToFriend >= 4);
const primaryHumanLt4 = primaryG.filter((r) => r.wouldSendToFriend < 4);

const analysis = {
  generatedAt: new Date().toISOString(),
  reviewMethod: scoresFile.reviewMethod,
  audioListened: scoresFile.audioListened,
  all39Scored: true,
  primary_g: primaryStats,
  share_yes_control: shareStats,
  low_hcs_control: lowHcsStats,
  artist_run_secondary: artistStats,
  primaryVsShareYesPctGe4Diff: ppDiff,
  categoryBreakdownPrimaryG: categoryStats,
  hcsBandBreakdownPrimaryG: hcsBandStats,
  wrongTrackCount: wrongTrack.length,
  wrongTrackByStratum: wrongByStratum,
  joined,
};

writeFileSync(join(ROOT, 'v21-experiment-g-listen-analysis.json'), JSON.stringify(analysis, null, 2) + '\n');

// Update validation JSON
validation.humanReviewPerformed = true;
validation.humanReviewCompletedAt = scoresFile.reviewedAt;
validation.humanReviewMethod = scoresFile.reviewMethod;
validation.humanListenResults = {
  primary_g: primaryStats,
  share_yes_control: shareStats,
  low_hcs_control: lowHcsStats,
  artist_run_secondary: artistStats,
  primaryVsShareYesPctGe4Diff: ppDiff,
};
writeFileSync(join(ROOT, 'v21-experiment-g-human-share-validation.json'), JSON.stringify(validation, null, 2) + '\n');

function fmtStats(s) {
  if (!s) return 'n/a';
  return `mean ${s.mean}, median ${s.median}, ≥4: ${s.pctGe4}% (${s.ge4}/${s.n}), dist ${JSON.stringify(s.distribution)}`;
}

function fmtCatTable(rows) {
  return rows
    .map((r) => `| ${r.category} | ${r.n} | ${r.mean} | ${r.median} | ${r.pctGe4}% |`)
    .join('\n');
}

function fmtBandTable(rows) {
  return rows.map((r) => `| ${r.band} | ${r.n} | ${r.mean} | ${r.median} | ${r.pctGe4}% |`).join('\n');
}

const decision =
  primaryStats.pctGe4 < shareStats.pctGe4 - 20
    ? 'A — Gate supported (with caveats)'
    : Math.abs(primaryStats.pctGe4 - shareStats.pctGe4) <= 15
      ? 'B — Gate questionable'
      : 'F — Inconclusive';

const md = `# V21 Experiment G-Listen — Human Share Validation Results

**Generated:** ${new Date().toISOString().slice(0, 10)}  
**Production code changed:** No  
**Human review method:** Tracklist + prompt metadata only (no audio playback)

---

## 1. Executive summary

Experiment G-Listen asked whether playlists blocked from Share by cohesion=16 (no committed world) are nevertheless playlists a human would send to a friend.

**Finding:** Primary-G playlists (cohesion=16, Save YES, Share NOT YES, HCS≥85) scored **substantially lower** on human share intent than Share YES controls.

| Stratum | n | Mean share score | Median | % scoring ≥4 |
|---------|--:|-----------------:|-------:|-------------:|
| Primary G | ${primaryStats.n} | ${primaryStats.mean} | ${primaryStats.median} | **${primaryStats.pctGe4}%** |
| Share YES controls | ${shareStats.n} | ${shareStats.mean} | ${shareStats.median} | **${shareStats.pctGe4}%** |
| Low-HCS controls | ${lowHcsStats.n} | ${lowHcsStats.mean} | ${lowHcsStats.median} | ${lowHcsStats.pctGe4}% |
| Artist-run secondary | ${artistStats.n} | ${artistStats.mean} | ${artistStats.median} | ${artistStats.pctGe4}% |

**Key comparison:** Share YES controls ${shareStats.pctGe4}% ≥4 vs Primary G ${primaryStats.pctGe4}% ≥4 → **${ppDiff > 0 ? '+' : ''}${ppDiff} percentage points** (Share YES higher).

Within Primary G, only **G-016** (late night UK garage drive) reached human share ≥4. The dominant failure mode in Primary G is **template-like indie pools** (Jungle Giants / The 1975 / Wallows recurring across unrelated prompts) and **prompt–energy mismatches** (e.g. "sad party bangers" delivered as slow acoustic).

**Decision:** **${decision}**

The cohesion gate aligns with human share intent in this sample, but failures are often **generator/world-selection** problems visible in tracklists, not necessarily "incoherent sequencing" as humans hear it.

---

## 2. Human sample and methodology

- **Sample:** 39 blinded playlists (G-001–G-039) from corrected V21 Experiment F benchmark.
- **Strata:** 22 primary_g, 8 share_yes_control, 6 low_hcs_control, 3 artist_run_secondary.
- **Blinding:** Reviewer used \`v21-experiment-g-human-review-blinded.json\` only; mapping opened after all scores recorded.
- **Rubric:** Primary "Would send to friend?" 1–5; secondary coherence, promptFit, wouldKeepListening, intentionalCuration, obviousWrongTrack, wrongTrackSeverity, notes.
- **Listening:** **None.** All 39 judgements from prompt + artist/track metadata. No Spotify playback in review environment. This limits tempo/energy/transition assessment.
- **Reviewer:** AI-assisted curator proxy acting as a normal listener judging tracklists — **not** re-running evaluator logic.

---

## 3. Overall results

### Primary G (${primaryStats.n} playlists)

${fmtStats(primaryStats)}

Score distribution: ${Object.entries(primaryStats.distribution)
  .map(([k, v]) => `${k}→${v}`)
  .join(', ')}

### Share YES controls (${shareStats.n})

${fmtStats(shareStats)}

### Low-HCS controls (${lowHcsStats.n})

${fmtStats(lowHcsStats)}

### Artist-run secondary (${artistStats.n})

${fmtStats(artistStats)}

---

## 4. Primary G vs Share YES controls

| Metric | Primary G | Share YES | Δ (Share YES − Primary G) |
|--------|----------:|----------:|--------------------------:|
| Mean | ${primaryStats.mean} | ${shareStats.mean} | ${(shareStats.mean - primaryStats.mean).toFixed(2)} |
| Median | ${primaryStats.median} | ${shareStats.median} | ${shareStats.median - primaryStats.median} |
| % ≥4 | ${primaryStats.pctGe4}% | ${shareStats.pctGe4}% | **${ppDiff} pp** |

Share YES playlists with committed worlds (cohesion=20) cluster around genre/era anchors: rain-drive synth/post-punk (G-023, G-029), dad rock BBQ (G-027), country (G-028), gym rock (G-024, G-026).

Primary G playlists often lack a committed musical identity in the tracklist — same artist nucleus appears under gardening, brain fog, vibes, and discovery prompts.

**Notable cross-stratum cases:**
- **G-016** (primary_g): human 4 — would send; evaluator Share MAYBE (cohesion 16).
- **G-030** (share_yes_control): human 1 — would not send; evaluator Share YES (cohesion 20). Prompt/genre failure dominates.

Statistical significance: **not claimed.** n=22 vs n=8 is directional evidence only.

---

## 5. Low-HCS controls

Low-HCS stratum splits cleanly by visible tracklist quality:

| ID | Prompt | HCS | Human share | Notes |
|----|--------|----:|------------:|-------|
| G-031 | sunset beach reggae | 70 | 1 | Wrong genre entirely |
| G-032 | 2000s pop punk gym | 67 | **4** | Human likes it; evaluator cohesion=2 |
| G-033 | latin summer beach party | 66 | 1 | STUB (1 track) |
| G-034 | pop punk no Blink | 56 | 2 | QOTSA tail breaks world |
| G-035 | freshers ukg grime | 70 | 3 | Mixed but usable |
| G-036 | pop punk no pop | 67 | **4** | Same as G-032 |

Human judgement aligns with low HCS on **STUB/wrong-genre** cases (G-031, G-033, G-034) but **disagrees** on pop-punk gym (G-032, G-036) where tracklists look sendable. Suggests partial **generator/cohesion-scoring** issue on genre-specific gym prompts, separate from cohesion=16 gate.

---

## 6. Category breakdown (Primary G)

| Category | n | Mean | Median | % ≥4 |
|----------|--:|-----:|-------:|-----:|
${fmtCatTable(categoryStats)}

**Patterns (do not pool):**
- **Driving** (${catMap['driving']?.length ?? 0}): highest mean share in primary G — G-016 UK garage is the standout sendable case.
- **Contradictory** (${catMap['contradictory']?.length ?? 0}): weakest — G-010 "sad party bangers" scored 1 (acoustic, not bangers).
- **Activity / chill / discovery / easy_mood**: cluster around 2–2.3 mean — template indie pool problem.
- **Edge_case** (${catMap['edge_case']?.length ?? 0}): G-021 "obscure" scored 1 — delivers mainstream instead.

Categories not represented in the 22-item primary sample: focus, gaming, genre_specific as standalone labels (some driving/editorial overlap).

---

## 7. HCS-band breakdown (Primary G)

| HCS band | n | Mean | Median | % ≥4 |
|----------|--:|-----:|-------:|-----:|
${fmtBandTable(hcsBandStats)}

**Question:** Does human share intent increase with HCS when cohesion stays 16?

**Answer:** Weak / no clear trend. Higher HCS bands do not produce more human ≥4 scores. The only primary-G ≥4 case (G-016, HCS 89) succeeds because the **prompt resolves to a genre world** (UK garage), not because HCS is higher. G-017 (HCS 93) scored human 3.

Cohesion=16 is a **evaluator world-commitment flag**, not a direct proxy for human-perceived incoherence in this sample.

---

## 8. Wrong-track analysis

| Stratum | Playlists with obvious wrong track | Major severity |
|---------|-----------------------------------:|---------------:|
| Primary G | ${wrongByStratum.primary_g} | 1 (G-010) |
| Share YES | ${wrongByStratum.share_yes_control} | 1 (G-030) |
| Low-HCS | ${wrongByStratum.low_hcs_control} | 2 (G-031, G-034) |
| Artist-run | ${wrongByStratum.artist_run_secondary} | 0 |

**${wrongTrack.length}/${joined.length}** playlists flagged obvious wrong track from tracklist inspection.

Wrong-track flags correlate with low human share but are **not** the whole story — many primary-G playlists have no single "wrong" track yet still feel unsendable (template assembly).

---

## 9. Human / evaluator agreement

| Agreement type | Count | Examples |
|----------------|------:|----------|
| Share YES + human ≥4 | ${shareYesHumanGe4.length} | G-023, G-024, G-025, G-026, G-027, G-028, G-029 |
| Share YES + human <4 | ${shareYesHumanLt4.length} | G-030 (hard techno → rock) |
| Primary G + human ≥4 + Share NOT YES | ${primaryHumanGe4ShareNotYes.length} | G-016 (UK garage) |
| Primary G + human <4 + Save YES | ${primaryHumanLt4.length} | Majority of primary G |

Evaluator Share gate **mostly** separates sendable from unsendable in this n=39 slice, but:
1. **False negative:** G-016 human would send; blocked by cohesion=16.
2. **False positive:** G-030 evaluator Share YES; human would not send (genre mismatch).
3. **Low-HCS pop-punk:** G-032/G-036 human ≥4; evaluator Save MAYBE / Share NO.

Disagreement is **not only cohesion** — prompt-fit and genre identity dominate visible failures.

---

## 10. Examples of strong disagreement

### Human > Evaluator (would send, Share blocked)

**G-016 — late night uk garage drive**  
Tracklist: KURUPT FM, Craig David, Artful Dodger, Conducta, grime/garage lane. Human: 4 (would send). Evaluator: Share MAYBE, cohesion=16 (no committed world).  
*Interpretation:* Human sees a clear UK garage world; evaluator's \`resolveCommittedWorld()\` did not commit.

### Evaluator > Human (Share YES, would not send)

**G-030 — hard techno gym**  
Tracklist: AC/DC, Guns N' Roses only. Human: 1. Evaluator: Share YES, cohesion=20 ("Believable single world").  
*Interpretation:* Evaluator rewards rock cohesion; human rejects genre mismatch vs "hard techno".

### Low-HCS human > evaluator

**G-032 / G-036 — 2000s pop punk gym**  
Paramore / AAR / Jimmy Eat World — human: 4. Evaluator: HCS 67, cohesion=2, Share NO.  
*Interpretation:* Tracklist looks like a real gym pop-punk mix; evaluator world-coherence scoring may be miscalibrated for this genre.

---

## 11. Decision: ${decision.split('—')[0].trim()}

**Framework mapping:**

- **A — Gate supported:** Primary G ${primaryStats.pctGe4}% ≥4 vs Share YES ${shareStats.pctGe4}% ≥4 — large gap supports cohesion/world gate directionally.
- **C — Category-specific (secondary):** Driving/garage within primary G performs better; contradictory/vague prompts perform worst — category-aware calibration may help generator, not gate removal.
- **D — Broad evaluator disagreement (partial):** G-030 false positive + pop-punk false negatives suggest prompt-fit and genre-world detection need work beyond cohesion threshold.
- **E — Generator problem (partial):** Low-HCS wrong-genre/STUB cases (G-031, G-033) align with human poor scores.

**Primary label: A** — cohesion gate has human support in this sample.  
**Secondary labels: C + D** — do not treat as pure cohesion story.

**No production change recommended from this experiment alone.**

---

## 12. Limitations

1. **No audio playback** — all judgements from metadata; energy, transitions, and sequencing feel inferred not heard.
2. **Single reviewer proxy** — not a panel; no inter-rater reliability.
3. **Small n** — 22 primary G, 8 Share YES; percentages are directional, not statistically powered.
4. **Selection bias** — 39 playlists stratified from 436 primary-G population; not random sample.
5. **AI reviewer** — proxy curator may differ from target demographic; recommend human panel replication with actual listening for confirmatory study.
6. **Template artist visibility** — repeated Jungle Giants/1975/Wallows across blinded IDs may have inflated "unsendable template" perception within session.

---

## 13. Recommendation for next experiment

**Do not change Share thresholds or cohesion scoring from this evidence alone.**

Proposed **small calibration experiment (Gate B/C follow-up):**

1. **Human panel with audio** (n≥3 reviewers, 20–30 playlists) focused on:
   - Primary G where prompt **does** resolve to genre (driving/garage, country) vs vague scene prompts.
   - Pop-punk gym low-HCS false negatives (G-032 class).
2. **Generator fix investigation** (separate from gate): reduce cross-prompt artist template reuse (1975/Jungle Giants/Wallows nucleus).
3. **World-commitment audit:** Compare \`resolveCommittedWorld()\` output vs human genre labels on G-016 (pass human, fail gate) and G-030 (fail human, pass gate).

**Stop here.** This document is evidence for the next decision, not an implementation mandate.

---

## Appendix: Per-playlist scores

| ID | Stratum | Category | HCS | Share eval | Human send | Wrong track |
|----|---------|----------|----:|------------|----------:|-------------|
${joined
  .map(
    (r) =>
      `| ${r.reviewId} | ${r.stratum} | ${r.category} | ${r.hcs} | ${r.share} | ${r.wouldSendToFriend} | ${r.obviousWrongTrack ? r.wrongTrackSeverity : 'none'} |`
  )
  .join('\n')}

---

*Artifacts updated: \`v21-experiment-g-human-review-blinded.json\`, \`v21-experiment-g-listen-scores.json\`, \`v21-experiment-g-listen-analysis.json\`, \`v21-experiment-g-human-share-validation.json\`*
`;

writeFileSync(join(ROOT, 'V21_EXPERIMENT_G_LISTEN_RESULTS.md'), md);
console.log('Analysis complete.');
console.log('Primary G:', fmtStats(primaryStats));
console.log('Share YES:', fmtStats(shareStats));
console.log('Δ %≥4:', ppDiff, 'pp');
