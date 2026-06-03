/**
 * Music Life Chapters — timeline clusters from like dates (no private event names).
 */

import type { LikedSongRow } from "./library-signals";

export interface MusicChapter {
  id: string;
  label: string;
  description: string;
  start: Date;
  end: Date;
  trackIds: string[];
  dominantArtists: string[];
  /** 0–1 how distinct this burst is vs rest of library */
  strength: number;
}

export interface ChapterMatch {
  chapter: MusicChapter;
  boost: number;
}

const MS_DAY = 24 * 60 * 60 * 1000;

function reservoirSample<T>(items: T[], k: number): T[] {
  if (items.length <= k) return items;
  const out = items.slice(0, k);
  for (let i = k; i < items.length; i++) {
    const j = Math.floor(Math.random() * (i + 1));
    if (j < k) out[j] = items[i]!;
  }
  return out;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function detectMusicChapters(songs: LikedSongRow[], _now = Date.now()): MusicChapter[] {
  const sample = songs.length > 8000 ? reservoirSample(songs, 8000) : songs;
  const dated = sample.filter((s) => s.addedAt).sort((a, b) => a.addedAt!.getTime() - b.addedAt!.getTime());
  if (dated.length < 20) return buildYearChapters(dated);

  const byMonth = new Map<string, LikedSongRow[]>();
  for (const s of dated) {
    const k = monthKey(s.addedAt!);
    const arr = byMonth.get(k) ?? [];
    arr.push(s);
    byMonth.set(k, arr);
  }

  const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const counts = months.map(([, rows]) => rows.length);
  const avg = counts.reduce((a, b) => a + b, 0) / counts.length || 1;

  const chapters: MusicChapter[] = [];
  let burstStart: string | null = null;
  let burstRows: LikedSongRow[] = [];

  const flushBurst = () => {
    if (burstRows.length < 8 || !burstStart) return;
    const start = burstRows[0]!.addedAt!;
    const end = burstRows[burstRows.length - 1]!.addedAt!;
    const artistCounts = new Map<string, number>();
    for (const r of burstRows) {
      const a = r.artistName.toLowerCase();
      artistCounts.set(a, (artistCounts.get(a) ?? 0) + 1);
    }
    const dominantArtists = [...artistCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([a]) => a);

    const y0 = start.getFullYear();
    const y1 = end.getFullYear();
    const label =
      y0 === y1 ? `${y0}` : `${y0}–${y1}`;
    const id = `chapter_${monthKey(start)}_${monthKey(end)}`.replace(/-/g, "");

    chapters.push({
      id,
      label,
      description: `A dense period of likes around ${label}`,
      start,
      end,
      trackIds: burstRows.map((r) => r.trackId),
      dominantArtists,
      strength: Math.min(1, burstRows.length / (avg * 4)),
    });
    burstRows = [];
    burstStart = null;
  };

  for (const [mk, rows] of months) {
    if (rows.length >= avg * 1.35) {
      if (!burstStart) burstStart = mk;
      burstRows.push(...rows);
    } else {
      flushBurst();
    }
  }
  flushBurst();

  const yearChapters = buildYearChapters(dated);
  const merged = [...chapters, ...yearChapters];
  const byId = new Map<string, MusicChapter>();
  for (const c of merged) {
    const existing = byId.get(c.id);
    if (!existing || c.trackIds.length > existing.trackIds.length) byId.set(c.id, c);
  }

  return [...byId.values()]
    .sort((a, b) => b.trackIds.length - a.trackIds.length)
    .slice(0, 12);
}

function buildYearChapters(dated: LikedSongRow[]): MusicChapter[] {
  const byYear = new Map<number, LikedSongRow[]>();
  for (const s of dated) {
    const y = s.addedAt!.getFullYear();
    const arr = byYear.get(y) ?? [];
    arr.push(s);
    byYear.set(y, arr);
  }
  return [...byYear.entries()]
    .filter(([, rows]) => rows.length >= 5)
    .map(([year, rows]) => {
      const sorted = [...rows].sort((a, b) => a.addedAt!.getTime() - b.addedAt!.getTime());
      const artistCounts = new Map<string, number>();
      for (const r of rows) {
        const a = r.artistName.toLowerCase();
        artistCounts.set(a, (artistCounts.get(a) ?? 0) + 1);
      }
      return {
        id: `year_${year}`,
        label: String(year),
        description: `Likes from ${year}`,
        start: sorted[0]!.addedAt!,
        end: sorted[sorted.length - 1]!.addedAt!,
        trackIds: rows.map((r) => r.trackId),
        dominantArtists: [...artistCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([a]) => a),
        strength: Math.min(1, rows.length / 80),
      };
    });
}

const LIFE_PHASE_PATTERNS: { re: RegExp; chapterIdHint: string; label: string }[] = [
  { re: /\bschool years?\b|\bhigh school\b|\bteenage\b/i, chapterIdHint: "school", label: "school-era likes" },
  { re: /\buniversity\b|\buni\b|\bcollege\b/i, chapterIdHint: "uni", label: "university-era likes" },
  { re: /\bfirst job\b|\bfirst real job\b/i, chapterIdHint: "work", label: "early career likes" },
  { re: /\blockdown\b|\b2020\b|\b2021\b/i, chapterIdHint: "2020", label: "lockdown-era cluster" },
  { re: /\bgym phase\b|\bgym era\b|\bworkout phase\b/i, chapterIdHint: "gym", label: "high-energy cluster" },
  { re: /\bgaming phase\b|\bgaming era\b/i, chapterIdHint: "gaming", label: "late-night cluster" },
  { re: /\broad trip era\b|\bdriving phase\b|\bfirst started driving\b/i, chapterIdHint: "drive", label: "driving-era likes" },
  { re: /\bindie phase\b|\bforgotten indie\b/i, chapterIdHint: "indie", label: "indie-heavy period" },
];

export function matchChapterFromVibe(
  vibe: string,
  chapters: MusicChapter[],
  songs: LikedSongRow[]
): ChapterMatch | null {
  const lower = vibe.toLowerCase();

  const yearMatch = lower.match(/\b(?:take me back to|back to|songs from|my)\s*(20\d{2})\b/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1]!, 10);
    const ch = chapters.find((c) => c.label === String(year) || c.id === `year_${year}`);
    if (ch) return { chapter: ch, boost: 0.14 };
  }

  for (const pat of LIFE_PHASE_PATTERNS) {
    if (!pat.re.test(lower)) continue;
    if (pat.chapterIdHint === "2020") {
      const ch = chapters.find((c) => c.start.getFullYear() <= 2021 && c.end.getFullYear() >= 2020);
      if (ch) return { chapter: ch, boost: 0.12 };
    }
    if (pat.chapterIdHint === "gym") {
      const highEnergy = songs.filter((s) => (s.energy ?? 0.5) > 0.65 && s.addedAt);
      if (highEnergy.length >= 10) {
        const mid = highEnergy[Math.floor(highEnergy.length / 2)]!.addedAt!;
        const near = chapters.find(
          (c) => mid >= c.start && mid <= c.end
        );
        if (near) return { chapter: near, boost: 0.1 };
      }
    }
    const largest = chapters[0];
    if (largest) return { chapter: largest, boost: 0.08 };
  }

  return null;
}

export function chapterTrackBoost(trackId: string, match: ChapterMatch | null): number {
  if (!match) return 0;
  if (!match.chapter.trackIds.includes(trackId)) return -0.02;
  return match.boost;
}
