import { AsyncLocalStorage } from "node:async_hooks";

export type SpotifyEndpointAudit = {
  endpoint: string;
  requests: number;
  retries: number;
  rateLimitResponses: number;
  failures: number;
  totalDurationMs: number;
};

export type SpotifyApiAuditSnapshot = {
  totalRequests: number;
  retries: number;
  rateLimitResponses: number;
  failures: number;
  totalDurationMs: number;
  byEndpoint: SpotifyEndpointAudit[];
};

type SpotifyApiAuditContext = {
  totalRequests: number;
  retries: number;
  rateLimitResponses: number;
  failures: number;
  totalDurationMs: number;
  byEndpoint: Map<string, SpotifyEndpointAudit>;
};

const spotifyAuditStorage = new AsyncLocalStorage<SpotifyApiAuditContext>();

export function beginSpotifyApiAudit(): SpotifyApiAuditContext {
  const context: SpotifyApiAuditContext = {
    totalRequests: 0,
    retries: 0,
    rateLimitResponses: 0,
    failures: 0,
    totalDurationMs: 0,
    byEndpoint: new Map<string, SpotifyEndpointAudit>(),
  };
  spotifyAuditStorage.enterWith(context);
  return context;
}

function normalizePath(pathname: string): string {
  return pathname
    .replace(/\/artists\/[^/]+/g, "/artists/{id}")
    .replace(/\/albums\/[^/]+/g, "/albums/{id}")
    .replace(/\/tracks\/[^/]+/g, "/tracks/{id}")
    .replace(/\/playlists\/[^/]+/g, "/playlists/{id}")
    .replace(/\/users\/[^/]+/g, "/users/{id}");
}

export function spotifyEndpointLabel(method: string | undefined, url: string | undefined): string {
  if (!url) return `${method ?? "GET"} unknown`;
  try {
    const parsed = new URL(url);
    return `${(method ?? "GET").toUpperCase()} ${normalizePath(parsed.pathname)}`;
  } catch {
    return `${(method ?? "GET").toUpperCase()} ${url}`;
  }
}

export function recordSpotifyApiRequest(input: {
  endpoint: string;
  durationMs: number;
  attempt: number;
  status?: number | null;
  failed: boolean;
}): void {
  const context = spotifyAuditStorage.getStore();
  if (!context) return;
  const row = context.byEndpoint.get(input.endpoint) ?? {
    endpoint: input.endpoint,
    requests: 0,
    retries: 0,
    rateLimitResponses: 0,
    failures: 0,
    totalDurationMs: 0,
  };
  context.totalRequests += 1;
  row.requests += 1;
  if (input.attempt > 0) {
    context.retries += 1;
    row.retries += 1;
  }
  if (input.status === 429) {
    context.rateLimitResponses += 1;
    row.rateLimitResponses += 1;
  }
  if (input.failed) {
    context.failures += 1;
    row.failures += 1;
  }
  context.totalDurationMs += input.durationMs;
  row.totalDurationMs += input.durationMs;
  context.byEndpoint.set(input.endpoint, row);
}

export function getSpotifyApiAuditSnapshot(): SpotifyApiAuditSnapshot {
  const context = spotifyAuditStorage.getStore();
  if (!context) {
    return {
      totalRequests: 0,
      retries: 0,
      rateLimitResponses: 0,
      failures: 0,
      totalDurationMs: 0,
      byEndpoint: [],
    };
  }
  return {
    totalRequests: context.totalRequests,
    retries: context.retries,
    rateLimitResponses: context.rateLimitResponses,
    failures: context.failures,
    totalDurationMs: Math.round(context.totalDurationMs),
    byEndpoint: [...context.byEndpoint.values()]
      .map((row) => ({ ...row, totalDurationMs: Math.round(row.totalDurationMs) }))
      .sort((a, b) => b.requests - a.requests || a.endpoint.localeCompare(b.endpoint)),
  };
}

