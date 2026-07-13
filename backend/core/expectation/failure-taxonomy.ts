/**
 * Human Expectation Layer — human failure taxonomy.
 *
 * A single place for the failure categories a human listener notices, with
 * detectors that reason over the whole playlist against the contract. This
 * unifies vocabulary that was previously scattered across gates/guards.
 */

import { evaluateTrackAdmissibility, trackIsChristmas } from "./track-admissibility";
import { nearDuplicateKey } from "../../lib/near-duplicate";
import type {
  ExpectationContract,
  ExpectationTrack,
  FailureFinding,
  FailureMode,
  MomentInterpretation,
} from "./types";

const ERA_RANGES: Record<string, [number, number]> = {
  eighties: [1980, 1989],
  nineties: [1990, 1999],
  y2k: [2000, 2009],
  retro: [1950, 1989],
  modern: [2015, 2100],
};

function opening(tracks: ExpectationTrack[]): ExpectationTrack[] {
  return tracks.slice(0, Math.min(5, tracks.length));
}

/**
 * Detect the human-visible failure modes for a playlist. `now` lets season
 * detection be deterministic in tests (defaults to the current date).
 */
export function detectFailureModes(
  tracks: ExpectationTrack[],
  contract: ExpectationContract,
  interpretation: MomentInterpretation,
  now: Date = new Date(),
): FailureFinding[] {
  const findings: FailureFinding[] = [];
  if (tracks.length === 0) return findings;

  const adm = tracks.map((t) => ({ track: t, a: evaluateTrackAdmissibility(t, contract) }));

  // MOOD_INVERSION / ENERGY_MISMATCH — tracks on the opposite side of the band.
  const inverted = adm.filter((x) => x.a.severity === "high" || x.a.violations.some((v) => /energy too|too upbeat|too bleak/.test(v)));
  if (inverted.length > 0) {
    const energyInvert = inverted.filter((x) => x.a.violations.some((v) => /energy too/.test(v)));
    if (energyInvert.length > 0) {
      findings.push({
        mode: "ENERGY_MISMATCH",
        severity: energyInvert.length >= 3 ? "high" : "medium",
        detail: `${energyInvert.length} track(s) fight the moment's energy (${contract.sonicBands.energy.map((x) => x.toFixed(2)).join("–")}).`,
        trackIds: energyInvert.map((x) => x.track.trackId),
      });
    }
    const toneInvert = inverted.filter((x) => x.a.violations.some((v) => /too upbeat|too bleak/.test(v)));
    if (toneInvert.length > 0) {
      findings.push({
        mode: "MOOD_INVERSION",
        severity: toneInvert.length >= 3 ? "high" : "medium",
        detail: `${toneInvert.length} track(s) invert the emotional tone of "${interpretation.candidates[0]?.label ?? contract.atmosphere.join(", ")}".`,
        trackIds: toneInvert.map((x) => x.track.trackId),
      });
    }
  }

  // OPENING_MISREPRESENTS — the first tracks don't communicate the moment.
  const open = opening(tracks);
  const openBad = open
    .map((t) => ({ t, a: evaluateTrackAdmissibility(t, contract) }))
    .filter((x) => !x.a.admissible || x.a.severity === "high");
  if (openBad.length > 0) {
    findings.push({
      mode: "OPENING_MISREPRESENTS",
      severity: openBad.some((x) => x.a.severity === "high") ? "high" : "medium",
      detail: `Opening track(s) misrepresent the moment; the first ~5 tracks must say "I understood you".`,
      trackIds: openBad.map((x) => x.t.trackId),
    });
  }

  // ARTIST_FATIGUE — one artist dominates.
  const byArtist = new Map<string, string[]>();
  for (const t of tracks) {
    const key = (t.artistName ?? "").trim().toLowerCase();
    if (!key) continue;
    byArtist.set(key, [...(byArtist.get(key) ?? []), t.trackId]);
  }
  const cap = Math.max(3, Math.ceil(tracks.length / 8));
  for (const [artist, ids] of byArtist) {
    if (ids.length > cap) {
      findings.push({
        mode: "ARTIST_FATIGUE",
        severity: ids.length >= cap + 2 ? "high" : "medium",
        detail: `Artist "${artist}" appears ${ids.length}× (cap ~${cap}) — feels lazy/repetitive.`,
        trackIds: ids.slice(cap),
      });
    }
  }

  // NEAR_DUPLICATE — the same recording under different ids/versions ("Song",
  // "Song - Remaster", "Song (Live)"). Exact-id dedup misses these; to a human
  // the playlist audibly repeats itself. Grouped by near-duplicate key.
  const byNearKey = new Map<string, string[]>();
  for (const t of tracks) {
    const key = nearDuplicateKey({ name: t.trackName, artist: t.artistName });
    if (!key) continue;
    byNearKey.set(key, [...(byNearKey.get(key) ?? []), t.trackId]);
  }
  const nearDupIds: string[] = [];
  for (const ids of byNearKey.values()) {
    if (ids.length > 1) nearDupIds.push(...ids.slice(1));
  }
  if (nearDupIds.length > 0) {
    findings.push({
      mode: "NEAR_DUPLICATE",
      severity: nearDupIds.length >= 2 ? "high" : "medium",
      detail: `${nearDupIds.length} near-duplicate recording(s) (same song under a different id/version) — the playlist repeats itself.`,
      trackIds: nearDupIds,
    });
  }

  // IDENTITY_COLLAPSE — strong opening, then admissibility falls apart later.
  if (tracks.length >= 8) {
    const scoreAt = (t: ExpectationTrack) => evaluateTrackAdmissibility(t, contract).score;
    const head = open.reduce((s, t) => s + scoreAt(t), 0) / open.length;
    const tailTracks = tracks.slice(Math.floor(tracks.length / 2));
    const tail = tailTracks.reduce((s, t) => s + scoreAt(t), 0) / tailTracks.length;
    if (head - tail > 0.28) {
      findings.push({
        mode: "IDENTITY_COLLAPSE",
        severity: head - tail > 0.42 ? "high" : "medium",
        detail: `Playlist identity collapses after the opening (fit ${head.toFixed(2)} → ${tail.toFixed(2)}).`,
        trackIds: tailTracks.filter((t) => scoreAt(t) < head - 0.28).map((t) => t.trackId),
      });
    }
  }

  // SEASON_MISMATCH — Christmas tracks without holiday intent, outside December.
  const holidayIntent =
    (interpretation.dimensions.scores["snow"] ?? 0) > 0.3 &&
    /christmas|holiday|festive|xmas/.test(interpretation.vibe.toLowerCase());
  const december = now.getMonth() === 11;
  if (!holidayIntent && !december) {
    const xmas = tracks.filter((t) => trackIsChristmas(t));
    if (xmas.length > 0) {
      findings.push({
        mode: "SEASON_MISMATCH",
        severity: "high",
        detail: `${xmas.length} Christmas/holiday track(s) leaked into a non-holiday moment.`,
        trackIds: xmas.map((t) => t.trackId),
      });
    }
  }

  // ERA_MISMATCH → CULTURAL_MISMATCH — years far outside a strongly-expected era.
  if (contract.era && contract.era.strictness > 0.5) {
    const range = ERA_RANGES[contract.era.label];
    if (range) {
      const offEra = tracks.filter(
        (t) => typeof t.releaseYear === "number" && (t.releaseYear < range[0] - 3 || t.releaseYear > range[1] + 3),
      );
      if (offEra.length >= Math.max(2, Math.ceil(tracks.length * 0.25))) {
        findings.push({
          mode: "CULTURAL_MISMATCH",
          severity: "medium",
          detail: `${offEra.length} track(s) fall outside the expected era (${contract.era.label}).`,
          trackIds: offEra.map((t) => t.trackId),
        });
      }
    }
  }

  // TOO_GENERIC / GOOD_SONGS_BAD_PLAYLIST — everything is individually fine but
  // the set has no distinct identity (uniformly mid admissibility, no peak).
  const scores = adm.map((x) => x.a.score);
  const avg = scores.reduce((s, x) => s + x, 0) / scores.length;
  const peak = Math.max(...scores);
  if (avg > 0.45 && avg < 0.72 && peak - avg < 0.12 && findings.length === 0) {
    findings.push({
      mode: "TOO_GENERIC",
      severity: "low",
      detail: `Tracks are individually acceptable but the playlist lacks a distinct identity for this moment.`,
      trackIds: [],
    });
  }

  return findings;
}

export function failureModePresent(findings: FailureFinding[], mode: FailureMode): boolean {
  return findings.some((f) => f.mode === mode);
}
