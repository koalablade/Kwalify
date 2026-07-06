/**
 * HTTP client for live soak — calls real /api routes with session cookie.
 */

import axios, { type AxiosError } from "axios";
import type { LiveGenerateResponse } from "./benchmark-live-soak-metrics";

export interface SoakClientConfig {
  baseUrl: string;
  sessionCookie: string;
  generateTimeoutMs: number;
}

export interface GenerateRequest {
  vibe: string;
  mode?: "strict" | "balanced" | "chaotic";
  length?: number;
  regenerate?: boolean;
  varietyBoost?: boolean;
}

function cookieHeader(sessionCookie: string): string {
  const trimmed = sessionCookie.trim();
  if (trimmed.includes("=")) return trimmed;
  return `connect.sid=${trimmed}`;
}

export function createSoakClient(config: SoakClientConfig) {
  const client = axios.create({
    baseURL: config.baseUrl.replace(/\/$/, ""),
    timeout: config.generateTimeoutMs,
    validateStatus: () => true,
    headers: {
      Cookie: cookieHeader(config.sessionCookie),
      "Content-Type": "application/json",
    },
  });

  return {
    async healthCheck(): Promise<{ ok: boolean; status: number; latencyMs: number }> {
      const start = Date.now();
      const res = await client.get("/api/healthz", { timeout: 10_000 });
      return { ok: res.status === 200, status: res.status, latencyMs: Date.now() - start };
    },

    async getMe(): Promise<{
      ok: boolean;
      status: number;
      userId: string | null;
      latencyMs: number;
    }> {
      const start = Date.now();
      const res = await client.get("/api/auth/me", { timeout: 15_000 });
      const data = res.data as { id?: string };
      return {
        ok: res.status === 200 && !!data.id,
        status: res.status,
        userId: data.id ?? null,
        latencyMs: Date.now() - start,
      };
    },

    async getSyncStatus(): Promise<{
      ok: boolean;
      synced: boolean;
      totalTracks: number;
      isSyncing: boolean;
    }> {
      const res = await client.get("/api/spotify/cache-status", { timeout: 15_000 });
      const data = res.data as {
        synced?: boolean;
        totalTracks?: number;
        isSyncing?: boolean;
      };
      return {
        ok: res.status === 200,
        synced: !!data.synced,
        totalTracks: data.totalTracks ?? 0,
        isSyncing: !!data.isSyncing,
      };
    },

    async getGenerateStatus(): Promise<{
      ok: boolean;
      active: boolean;
      phase: string;
      latencyMs: number;
    }> {
      const start = Date.now();
      const res = await client.get("/api/generate/status", { timeout: 10_000 });
      const data = res.data as { active?: boolean; phase?: string };
      return {
        ok: res.status === 200,
        active: !!data.active,
        phase: data.phase ?? "unknown",
        latencyMs: Date.now() - start,
      };
    },

    async cancelGenerate(): Promise<{ ok: boolean; cleared: boolean }> {
      const res = await client.post("/api/generate/cancel", {}, { timeout: 10_000 });
      const data = res.data as { cleared?: boolean };
      return { ok: res.status === 200, cleared: !!data.cleared };
    },

    async generate(
      body: GenerateRequest,
      opts?: { timeoutMs?: number }
    ): Promise<LiveGenerateResponse> {
      const start = Date.now();
      try {
        const res = await client.post(
          "/api/generate",
          {
            vibe: body.vibe,
            mode: body.mode ?? "balanced",
            length: body.length ?? 25,
            ...(body.regenerate || body.varietyBoost
              ? { regenerate: true, varietyBoost: true }
              : {}),
          },
          { timeout: opts?.timeoutMs ?? config.generateTimeoutMs }
        );
        const payload = (res.data ?? {}) as Record<string, unknown>;
        const retryHeader = res.headers?.["retry-after"];
        if (retryHeader && payload.retry_after == null) {
          payload.retry_after = Number(retryHeader);
        }
        return {
          ok: res.status >= 200 && res.status < 300 && !payload.error,
          status: res.status,
          latencyMs: Date.now() - start,
          cached: !!payload.cached,
          errorCode: (payload.code as string) ?? null,
          errorMessage: (payload.error as string) ?? null,
          body: payload,
        };
      } catch (err) {
        const ax = err as AxiosError;
        return {
          ok: false,
          status: ax.response?.status ?? 0,
          latencyMs: Date.now() - start,
          errorCode: "NETWORK_ERROR",
          errorMessage: ax.message,
          body: (ax.response?.data as Record<string, unknown>) ?? {},
        };
      }
    },
  };
}

function retryAfterMs(res: LiveGenerateResponse, headers?: Record<string, unknown>): number {
  const bodyRetry = (res.body?.retry_after as number) ?? 0;
  if (bodyRetry > 0) return bodyRetry * 1000;
  const headerRetry = Number(headers?.["retry-after"] ?? headers?.["Retry-After"] ?? 0);
  if (headerRetry > 0) return headerRetry * 1000;
  return 0;
}

export async function waitForIdleGenerate(
  client: ReturnType<typeof createSoakClient>,
  maxWaitMs: number
): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const status = await client.getGenerateStatus();
    if (!status.active) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(3_000, remaining));
  }
  await client.cancelGenerate();
  await sleep(1_000);
}

export async function waitForGenerateSlot(
  client: ReturnType<typeof createSoakClient>,
  prompt: string,
  maxWaitMs: number,
  opts?: { regenerate?: boolean }
): Promise<LiveGenerateResponse> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const res = await client.generate({
      vibe: prompt,
      regenerate: opts?.regenerate,
      varietyBoost: opts?.regenerate,
    });
    if (res.status !== 409 && res.errorCode !== "GENERATION_IN_PROGRESS") {
      if (res.errorCode === "RATE_LIMITED") {
        const waitMs = retryAfterMs(res) || 5_000;
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await sleep(Math.min(waitMs + 250, remaining));
        continue;
      }
      return res;
    }

    const status = await client.getGenerateStatus();
    if (!status.active) {
      continue;
    }

    const waitMs = retryAfterMs(res) || 3_000;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(waitMs, remaining));
  }
  return {
    ok: false,
    status: 409,
    latencyMs: maxWaitMs,
    errorCode: "GENERATION_IN_PROGRESS",
    errorMessage: "Timed out waiting for generate slot",
    body: {},
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomJitter(minMs: number, maxMs: number): number {
  if (maxMs <= minMs) return minMs;
  return minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
}

export function loadSoakClientConfig(): SoakClientConfig {
  const baseUrl = process.env["SOAK_BASE_URL"] ?? "http://localhost:3000";
  const sessionCookie = process.env["SOAK_SESSION_COOKIE"] ?? "";
  const generateTimeoutMs = Number(process.env["SOAK_GENERATE_TIMEOUT_MS"] ?? "180000");

  return { baseUrl, sessionCookie, generateTimeoutMs };
}

export function requireSessionCookie(): string {
  const cookie = process.env["SOAK_SESSION_COOKIE"]?.trim();
  if (!cookie) {
    throw new Error(
      "SOAK_SESSION_COOKIE is required for live soak. Log in via the app, copy connect.sid from browser devtools, and set:\n" +
        "  SOAK_SESSION_COOKIE=s%3A...\n" +
        "  SOAK_BASE_URL=http://localhost:3000  (optional)\n" +
        "Or run with --simulate for offline narrative-only mode."
    );
  }
  return cookie;
}
