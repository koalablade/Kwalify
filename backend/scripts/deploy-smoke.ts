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

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 30_000)): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function checkHealth(origin: string): Promise<SmokeResult> {
  const response = await fetchWithTimeout(`${origin}/api/healthz`);
  const data = await readJson(response);
  return {
    name: "healthz",
    pass: response.ok && data["status"] === "ok",
    status: response.status,
    details: data,
  };
}

async function checkReadiness(origin: string): Promise<SmokeResult> {
  const response = await fetchWithTimeout(`${origin}/api/readyz`);
  const data = await readJson(response);
  return {
    name: "readyz",
    pass: response.ok && data["status"] === "ready" && data["readiness"] === "ready",
    status: response.status,
    details: data,
  };
}

async function checkDeploymentCommit(origin: string): Promise<SmokeResult> {
  const expected = process.env.SMOKE_EXPECTED_COMMIT ?? process.env.EXPECTED_DEPLOYMENT_VERSION ?? null;
  const response = await fetchWithTimeout(`${origin}/api/readyz`);
  const data = await readJson(response);
  const commit = typeof data["commit"] === "string" ? data["commit"] : "unknown";
  return {
    name: "deploymentCommit",
    pass: response.ok && (!expected || commit === "unknown" || commit.startsWith(expected) || expected.startsWith(commit)),
    status: response.status,
    details: {
      commit,
      expected,
      deployed: data["status"] === "ready",
    },
  };
}

async function checkEvalToken(origin: string): Promise<SmokeResult> {
  const token = process.env.PLAYLIST_EVAL_TOKEN ?? process.env.SMOKE_EVAL_TOKEN ?? null;
  if (!token) {
    return {
      name: "evalToken",
      pass: true,
      details: { skipped: true, reason: "PLAYLIST_EVAL_TOKEN not set" },
    };
  }
  const response = await fetchWithTimeout(`${origin}/api/eval/ping`, {
    method: "POST",
    headers: { "x-eval-token": token },
  });
  const data = await readJson(response);
  return {
    name: "evalToken",
    pass: response.ok && data["tokenAccepted"] === true,
    status: response.status,
    details: data,
  };
}

async function checkGenerate(origin: string): Promise<SmokeResult> {
  const cookie = process.env.SMOKE_AUTH_COOKIE;
  const requestedLength = Number(process.env.SMOKE_GENERATE_LENGTH ?? 12);
  if (!cookie) {
    return {
      name: "generate",
      pass: true,
      details: { skipped: true, reason: "SMOKE_AUTH_COOKIE not set" },
    };
  }
  const response = await fetchWithTimeout(`${origin}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      vibe: process.env.SMOKE_GENERATE_PROMPT ?? "american country cowboy red dirt",
      mode: "balanced",
      length: requestedLength,
    }),
  });
  const data = await readJson(response);
  const tracks = Array.isArray(data["tracks"]) ? data["tracks"] as Array<Record<string, unknown>> : [];
  const genreCoverage = tracks.length > 0
    ? tracks.filter((track) => !!track["genrePrimary"] || !!track["genreFamily"] || Array.isArray(track["genres"])).length / tracks.length
    : 0;
  return {
    name: "generate",
    pass: response.ok && tracks.length === requestedLength && genreCoverage >= 0.85,
    status: response.status,
    details: {
      trackCount: tracks.length,
      requestedLength,
      genreCoverage: Math.round(genreCoverage * 1000) / 1000,
      code: data["code"],
      skipped: false,
    },
  };
}

async function checkLaunchPages(origin: string): Promise<SmokeResult[]> {
  const paths = ["/privacy", "/terms", "/favicon.svg", "/og-image.svg"];
  const results: SmokeResult[] = [];
  for (const path of paths) {
    const response = await fetchWithTimeout(`${origin}${path}`);
    results.push({
      name: `page${path.replace(/\//g, "_")}`,
      pass: response.ok,
      status: response.status,
      details: { path },
    });
  }
  const bogus = await fetchWithTimeout(`${origin}/this-page-should-404-smoke-test`);
  const bogusBody = await bogus.text();
  results.push({
    name: "branded404",
    pass: bogus.status === 404 && bogusBody.includes("Page not found"),
    status: bogus.status,
    details: { hasBrandedCopy: bogusBody.includes("Page not found") },
  });
  return results;
}

async function main(): Promise<void> {
  const origin = baseUrl();
  const results = [
    await checkHealth(origin),
    await checkReadiness(origin),
    await checkDeploymentCommit(origin),
    await checkEvalToken(origin),
    await checkGenerate(origin),
    ...(await checkLaunchPages(origin)),
  ];
  const pass = results.every((result) => result.pass);
  process.stdout.write(`${JSON.stringify({ pass, origin, results }, null, 2)}\n`);
  if (!pass) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
