/**
 * Verify PLAYLIST_EVAL_TOKEN against a deployed environment (no secrets in argv).
 *
 * Usage:
 *   PLAYLIST_EVAL_TOKEN='your-token' SMOKE_BASE_URL=https://kwalify.net npm run verify:eval-token
 */

const token = process.env.PLAYLIST_EVAL_TOKEN?.trim();
const base = (process.env.SMOKE_BASE_URL ?? process.env.APP_URL ?? "https://kwalify.net").replace(/\/+$/, "");
const spotifyUserId = process.env.SMOKE_SPOTIFY_USER_ID?.trim() ?? "koalablade";

if (!token) {
  console.error("Set PLAYLIST_EVAL_TOKEN in the environment.");
  process.exit(2);
}

async function ping(header) {
  const res = await fetch(`${base}/api/eval/ping`, {
    method: "POST",
    headers: { [header]: token },
  });
  const data = await res.json();
  return { endpoint: "POST /api/eval/ping", header, status: res.status, ...data };
}

async function generate(header) {
  const res = await fetch(`${base}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [header]: token,
    },
    body: JSON.stringify({
      vibe: "uk grime classics workout",
      mode: "balanced",
      length: 5,
      spotifyUserId,
      auditMode: true,
    }),
  });
  const data = await res.json();
  return {
    endpoint: "POST /api/generate",
    header,
    status: res.status,
    code: data.code ?? null,
    trackCount: Array.isArray(data.tracks) ? data.tracks.length : 0,
    message: data.message ?? data.error ?? data.reason ?? null,
  };
}

const readyz = await (await fetch(`${base}/api/readyz`)).json();
const pings = await Promise.all([
  ping("x-eval-token"),
  ping("x-kwalify-evaluation-token"),
]);
const gens = await Promise.all([
  generate("x-kwalify-evaluation-token"),
  generate("x-eval-token"),
]);

const pingOk = pings.some((row) => row.tokenAccepted === true);
const generateOk = gens.some((row) => row.status === 200 && row.trackCount > 0);
const summary = {
  base,
  tokenLength: token.length,
  readyz: { status: readyz.status, commit: readyz.commit },
  pingOk,
  generateOk,
  pings,
  gens,
};

console.log(JSON.stringify(summary, null, 2));
process.exit(pingOk && generateOk ? 0 : 1);
