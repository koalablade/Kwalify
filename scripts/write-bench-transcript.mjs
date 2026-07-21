import { readFileSync, writeFileSync } from "node:fs";

const dir = process.argv[2] ?? "reports/live-spotify-verify/bench-100-test-4";
const raw = JSON.parse(readFileSync(`${dir}/raw-results.json`, "utf8"));
const results = raw.results ?? [];
const ok = results.filter((r) => r.ok);
const fail = results.filter((r) => !r.ok);
const under = (r) =>
  (r.trackCount || 0) < Math.max(1, Math.floor((r.requestedLength || 25) * 0.5));
const softUnder = results.filter(
  (r) => r.ok && (r.trackCount || 0) < (r.requestedLength || 25),
);

let md = `# Bench 100 Test 4 — Full Transcript\n\n`;
md += `Stopped mid-run. **${results.length}/100** completed · **${ok.length} OK** · **${fail.length} FAIL**\n\n`;
md += `Format: \`Artist — Track [genreFamily]\`\n\n---\n\n`;

for (const r of results) {
  const n = r.trackCount ?? (r.tracks || []).length;
  const req = r.requestedLength || 25;
  md += `## ${r.id}\n\n`;
  md += `- **prompt:** "${String(r.prompt).replace(/"/g, "'")}"\n`;
  md += `- **mode:** ${r.mode || ""}\n`;
  md += `- **requested:** ${req}\n`;
  md += `- **status:** ${r.ok ? "ok" : "FAIL"}${r.status ? ` (HTTP ${r.status})` : ""}\n`;
  md += `- **tracks:** ${n} / ${req}${under(r) ? " — **UNDERFILL**" : n < req ? " — short" : ""}\n`;
  md += `- **Spotify:** ${r.spotifyPlaylistUrl || "none"}\n`;
  if (!r.ok) md += `- **error:** ${String(r.error || "")}\n`;
  const hqg = r.diagnostics?.humanQualityGate;
  if (hqg?.action) {
    md += `- **HQG:** ${hqg.action}${hqg.userMessage ? ` — ${hqg.userMessage}` : ""}\n`;
  }
  md += `\n`;
  const tracks = r.tracks || [];
  if (!tracks.length) {
    md += `_No tracks._\n\n---\n\n`;
    continue;
  }
  md += `### Tracks\n\n`;
  tracks.forEach((t, i) => {
    const artist = String(t.artistName || "Unknown").trim();
    const name = String(t.trackName || t.name || "Unknown").trim();
    const g = t.genreFamily || t.genrePrimary || "";
    md += `${i + 1}. ${artist} — ${name}${g ? ` \`[${g}]\`` : ""}\n`;
  });
  md += `\n---\n\n`;
}
writeFileSync(`${dir}/TRANSCRIPT.md`, md);

let u = `# Underfill detail — Test 4\n\n`;
u += `Strict (<50%): **${results.filter(under).length}** · Soft short (ok but < requested): **${softUnder.length}**\n\n`;
const listed = [];
for (const r of results.filter(under)) listed.push(r);
for (const r of softUnder) {
  if (!under(r)) listed.push(r);
}
for (const r of listed) {
  const n = r.trackCount ?? 0;
  const req = r.requestedLength || 25;
  u += `## ${r.id} — "${r.prompt}"\n\n`;
  u += `${n}/${req}${r.ok ? " ok" : " FAIL"}\n\n`;
  if (r.spotifyPlaylistUrl) u += `${r.spotifyPlaylistUrl}\n\n`;
  if (r.error) u += `Error: ${r.error}\n\n`;
  const hqg = r.diagnostics?.humanQualityGate;
  if (hqg?.userMessage) u += `HQG: ${hqg.userMessage}\n\n`;
  (r.tracks || []).forEach((t, i) => {
    u += `${i + 1}. ${t.artistName || "?"} — ${t.trackName || "?"}\n`;
  });
  u += `\n`;
}
writeFileSync(`${dir}/UNDERFILL.md`, u);

console.log(
  JSON.stringify({
    playlists: results.length,
    transcriptChars: md.length,
    underStrict: results.filter(under).length,
    softShort: softUnder.length,
  }),
);
