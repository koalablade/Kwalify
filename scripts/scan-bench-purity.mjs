import { readFileSync, writeFileSync } from "node:fs";

const CONTAMINANTS = [
  { id: "blondie", re: /\bblondie\b/i, banUnless: [/classic.?rock|70s/i] },
  { id: "fleetwood_mac", re: /\bfleetwood\s+mac\b/i, banUnless: [/classic.?rock|70s/i] },
  { id: "queen", re: /(?<!\bstorm\s)\bqueen\b(?!\s+of\s+the\s+stone)/i, banUnless: [/classic.?rock|70s/i] },
  { id: "led_zeppelin", re: /\bled\s+zeppelin\b/i, banUnless: [/classic.?rock|70s/i] },
  { id: "men_at_work", re: /\bmen\s+at\s+work\b/i, banUnless: [/classic.?rock|70s/i] },
  { id: "storm_queen", re: /\bstorm\s+queen\b/i, banUnless: [] },
];

const STRICT_WORLDS = /grunge|goth|angry|gym|pop punk|metal|post punk|quiet rage|boss fight|lofi|comedown|sleepy/i;

const dir = process.argv[2] ?? "reports/live-spotify-verify/bench-purity-recheck-test-10";
const raw = JSON.parse(readFileSync(`${dir}/raw-results.json`, "utf8"));
const results = raw.results ?? raw;

const rows = [];
for (const r of results) {
  const prompt = r.prompt ?? "";
  const tracks = r.tracks ?? [];
  const hits = [];
  if (STRICT_WORLDS.test(prompt) || /gym|angry|goth|grunge|metal|punk/i.test(prompt)) {
    for (const t of tracks) {
      const artist = String(t.artistName ?? "");
      for (const c of CONTAMINANTS) {
        if (c.banUnless.some((re) => re.test(prompt))) continue;
        if (c.re.test(artist)) hits.push(`${artist} (${c.id})`);
      }
    }
  }
  // 70s rock: blankets are OK
  rows.push({
    id: r.id,
    ok: r.ok,
    status: r.status,
    n: r.trackCount ?? tracks.length,
    requested: r.requestedLength,
    purity: hits.length === 0,
    contaminants: hits,
    error: r.error,
    url: r.spotifyPlaylistUrl,
    topArtists: [...new Set(tracks.map((t) => t.artistName).filter(Boolean))].slice(0, 8),
  });
}

const summary = {
  ok: rows.filter((r) => r.ok).length,
  fail: rows.filter((r) => !r.ok).length,
  purityPass: rows.filter((r) => r.ok && r.purity).length,
  purityFail: rows.filter((r) => r.ok && !r.purity).length,
  rows,
};
writeFileSync(`${dir}/purity-scan.json`, JSON.stringify(summary, null, 2));
console.log(`OK ${summary.ok}/${rows.length} · purity ${summary.purityPass}/${summary.ok || 0} clean among OK`);
for (const r of rows) {
  const mark = !r.ok ? "FAIL" : r.purity ? "CLEAN" : "DIRTY";
  console.log(`${mark.padEnd(5)} ${r.id.padEnd(28)} n=${String(r.n).padStart(2)}/${r.requested} ${r.contaminants.join(", ") || r.error || "—"}`);
  if (r.topArtists.length) console.log(`      artists: ${r.topArtists.join(", ")}`);
}
