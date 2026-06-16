type SmokeResult = {
  name: string;
  pass: boolean;
  status?: number;
  details?: Record<string, unknown>;
};

function baseUrl(): string {
  const raw = process.env.SMOKE_BASE_URL ?? process.env.APP_URL;
  if (!raw) {
    throw new Error("Set SMOKE_BASE_URL or APP_URL before running smoke:deploy");
  }
  return raw.replace(/\/+$/, "");
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function checkHealth(origin: string): Promise<SmokeResult> {
  const response = await fetch(`${origin}/api/healthz`);
  const data = await readJson(response);
  return {
    name: "healthz",
    pass: response.ok && data["status"] === "ok",
    status: response.status,
    details: data,
  };
}

async function checkGenerate(origin: string): Promise<SmokeResult> {
  const cookie = process.env.SMOKE_AUTH_COOKIE;
  if (!cookie) {
    return {
      name: "generate",
      pass: true,
      details: { skipped: true, reason: "SMOKE_AUTH_COOKIE not set" },
    };
  }
  const response = await fetch(`${origin}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      vibe: process.env.SMOKE_GENERATE_PROMPT ?? "american country cowboy red dirt",
      mode: "balanced",
      length: 12,
    }),
  });
  const data = await readJson(response);
  const tracks = Array.isArray(data["tracks"]) ? data["tracks"] as Array<Record<string, unknown>> : [];
  const genreCoverage = tracks.length > 0
    ? tracks.filter((track) => !!track["genrePrimary"] || !!track["genreFamily"] || Array.isArray(track["genres"])).length / tracks.length
    : 0;
  return {
    name: "generate",
    pass: response.ok && tracks.length > 0 && genreCoverage >= 0.85,
    status: response.status,
    details: {
      trackCount: tracks.length,
      genreCoverage: Math.round(genreCoverage * 1000) / 1000,
      code: data["code"],
      skipped: false,
    },
  };
}

async function main(): Promise<void> {
  const origin = baseUrl();
  const results = [
    await checkHealth(origin),
    await checkGenerate(origin),
  ];
  const pass = results.every((result) => result.pass);
  process.stdout.write(`${JSON.stringify({ pass, origin, results }, null, 2)}\n`);
  if (!pass) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
