import { Router, type IRouter } from "express";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { requireBenchmarkAuth } from "../middleware/benchmark-auth";
import { sendApiError } from "../lib/api-error-envelope";

const router: IRouter = Router();
const projectRoot = path.resolve(__dirname, "../../..");
const reportsDir = path.join(projectRoot, "reports");
const bridgeScript = path.join(projectRoot, "scripts", "benchmark-api-bridge.ps1");
const lockPath = path.join(os.tmpdir(), "kwalify-benchmark.lock");
const launcherLogPath = path.join(projectRoot, "kwalify-benchmark.log");
const localApiUrl = "http://127.0.0.1:5000";

const BUTTONS = [
  { id: "go", label: "Go now", sub: "50 human - ~2h", suite: "go", primary: true },
  { id: "smoke", label: "Quick check", sub: "1 prompt - ~2 min", suite: "smoke" },
  { id: "small", label: "Small", sub: "25 prompts - ~1h", suite: "small" },
  { id: "medium", label: "Medium", sub: "50 prompts - ~2h", suite: "medium" },
  { id: "long", label: "Long", sub: "100 prompts - ~4h", suite: "long" },
  { id: "mix50", label: "Full mix 50", sub: "genre-lock included", suite: "mix-medium" },
  { id: "easy25", label: "Easy 25", sub: "sanity check", request: "25 easy yes" },
  { id: "repeat", label: "Repeat last", sub: "same preset - fresh prompts", action: "repeat" },
  { id: "package", label: "Package zip", sub: "latest to Desktop", suite: "package" },
  { id: "status", label: "Open live", sub: "progress dashboard", action: "open-status" },
] as const;

type BridgeData = Record<string, unknown>;

let apiUpCache: boolean | null = null;
let apiUpCacheAt = 0;
const API_UP_TTL_MS = 20_000;

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function readTextFile(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  } catch {
    return null;
  }
}

function clearStaleBenchmarkLock(): boolean {
  if (!fs.existsSync(lockPath)) return false;
  try {
    const fd = fs.openSync(lockPath, "r+");
    fs.closeSync(fd);
    fs.unlinkSync(lockPath);
    return true;
  } catch {
    try {
      const ageHours = (Date.now() - fs.statSync(lockPath).mtimeMs) / 3_600_000;
      if (ageHours > 2) {
        fs.unlinkSync(lockPath);
        return true;
      }
      const livePath = path.join(reportsDir, "benchmark-live.json");
      const lockAgeMs = Date.now() - fs.statSync(lockPath).mtimeMs;
      let liveStale = true;
      if (fs.existsSync(livePath)) {
        liveStale = Date.now() - fs.statSync(livePath).mtimeMs > 5 * 60_000;
      }
      if (lockAgeMs > 10 * 60_000 && liveStale) {
        fs.unlinkSync(lockPath);
        return true;
      }
    } catch { /* ignore */ }
    return false;
  }
}

function benchmarkRunning(): boolean {
  clearStaleBenchmarkLock();
  if (!fs.existsSync(lockPath)) return false;
  try {
    const fd = fs.openSync(lockPath, "r+");
    fs.closeSync(fd);
    try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
    return false;
  } catch {
    return true;
  }
}

function readLogTail(maxLines = 15): string[] {
  try {
    if (!fs.existsSync(launcherLogPath)) return [];
    const stat = fs.statSync(launcherLogPath);
    const sizeMb = stat.size / (1024 * 1024);
    if (sizeMb > 5) {
      return [`(log is ${Math.round(sizeMb)}MB - tail skipped for speed)`];
    }
    if (stat.size === 0) return [];
    const chunkSize = Math.min(stat.size, 96 * 1024);
    const fd = fs.openSync(launcherLogPath, "r");
    try {
      const buf = Buffer.alloc(chunkSize);
      fs.readSync(fd, buf, 0, chunkSize, stat.size - chunkSize);
      const lines = buf.toString("utf8").split(/\r?\n/).filter(Boolean);
      return lines.slice(-maxLines);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return [];
  }
}

async function getCachedApiUp(): Promise<boolean> {
  const age = Date.now() - apiUpCacheAt;
  if (apiUpCache !== null && age < API_UP_TTL_MS) return apiUpCache;
  let up = false;
  try {
    const r = await fetch(`${localApiUrl}/api/healthz`, { signal: AbortSignal.timeout(3000) });
    up = r.ok;
  } catch { /* ignore */ }
  apiUpCache = up;
  apiUpCacheAt = Date.now();
  return up;
}

function getBenchmarkStateSync() {
  const history = readJsonFile<unknown[]>(path.join(reportsDir, "benchmark-history.json")) ?? [];
  return {
    apiUrl: localApiUrl,
    benchmarkRunning: benchmarkRunning(),
    live: readJsonFile<Record<string, unknown>>(path.join(reportsDir, "benchmark-live.json")),
    lastChoice: readJsonFile<Record<string, unknown>>(path.join(reportsDir, "benchmark-last-choice.json")),
    savedPresets: readJsonFile<Record<string, unknown>>(path.join(reportsDir, "benchmark-saved-presets.json")) ?? {},
    history: Array.isArray(history) ? history.slice(0, 5) : [],
    logTail: readLogTail(15),
    lastSpawn: readJsonFile<Record<string, unknown>>(path.join(reportsDir, "benchmark-last-spawn.json")),
    stuckWarning: readTextFile(path.join(reportsDir, "benchmark-stuck-warning.txt")),
    launcherVersion: "2",
    updatedAt: new Date().toISOString(),
  };
}

function parseBridgeJson(stdout: string): BridgeData {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("Empty response from benchmark bridge.");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Invalid JSON from benchmark bridge.");
  return JSON.parse(trimmed.slice(start, end + 1)) as BridgeData;
}

function invokeBenchmarkBridge(
  action: string,
  opts: {
    suite?: string;
    request?: string;
    message?: string;
    forceRun?: boolean;
    dryRun?: boolean;
  } = {},
): Promise<{ ok: true; data: BridgeData } | { ok: false; error: string; status?: number }> {
  if (process.platform !== "win32") {
    return Promise.resolve({ ok: false, error: "Benchmark API requires Windows (PowerShell).", status: 501 });
  }
  if (!fs.existsSync(bridgeScript)) {
    return Promise.resolve({ ok: false, error: `Missing benchmark bridge: ${bridgeScript}`, status: 500 });
  }

  const args = [
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", bridgeScript,
    "-Action", action, "-Root", projectRoot,
  ];
  if (opts.suite) args.push("-Suite", opts.suite);
  if (opts.request) args.push("-Request", opts.request);
  if (opts.message) args.push("-Message", opts.message);
  if (opts.forceRun) args.push("-ForceRun");
  if (opts.dryRun) args.push("-DryRun");

  return new Promise((resolve) => {
    const child = spawn("powershell.exe", args, {
      cwd: projectRoot,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
      if (stdout.length > 12 * 1024 * 1024) child.kill();
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    const timeout = setTimeout(() => {
      child.kill();
      resolve({ ok: false, error: "Benchmark bridge timed out.", status: 500 });
    }, 90_000);

    child.on("error", (err) => {
      clearTimeout(timeout);
      resolve({ ok: false, error: err.message, status: 500 });
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        const err = (stderr || stdout || "Benchmark bridge failed").trim();
        resolve({ ok: false, error: err, status: 500 });
        return;
      }
      try {
        resolve({ ok: true, data: parseBridgeJson(stdout) });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Invalid JSON from benchmark bridge.";
        resolve({ ok: false, error: message, status: 500 });
      }
    });
  });
}

router.get("/benchmark/data/live", (req, res) => {
  const live = readJsonFile<Record<string, unknown>>(path.join(reportsDir, "benchmark-live.json"));
  if (!live) {
    sendApiError(res, 404, "BENCHMARK_NO_DATA", "No live benchmark data yet.", { requestId: String(req.id) });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.json(live);
});

router.get("/benchmark/data/history", (_req, res) => {
  const history = readJsonFile<unknown[]>(path.join(reportsDir, "benchmark-history.json")) ?? [];
  res.setHeader("Cache-Control", "no-store");
  res.json(Array.isArray(history) ? history : []);
});

router.get("/benchmark/ping", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, launcherVersion: "2", url: "/benchmark" });
});

router.get("/benchmark/buttons", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.json({ buttons: BUTTONS });
});

router.get("/benchmark/state", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ...getBenchmarkStateSync(),
    apiUp: await getCachedApiUp(),
  });
});

router.post("/benchmark/clear-lock", requireBenchmarkAuth, async (req, res) => {
  const bridged = await invokeBenchmarkBridge("clear-lock");
  if (!bridged.ok) {
    sendApiError(res, bridged.status ?? 500, "BENCHMARK_BRIDGE_ERROR", bridged.error ?? "Benchmark bridge failed", { requestId: String(req.id) });
    return;
  }
  apiUpCache = null;
  res.json(bridged.data);
});

router.post("/benchmark/run", requireBenchmarkAuth, async (req, res) => {
  const body = req.body as { suite?: string; request?: string; dryRun?: boolean };
  const bridged = await invokeBenchmarkBridge("run", {
    suite: body.suite ? String(body.suite) : undefined,
    request: body.request ? String(body.request) : undefined,
    dryRun: Boolean(body.dryRun),
  });
  if (!bridged.ok) {
    sendApiError(res, bridged.status ?? 500, "BENCHMARK_BRIDGE_ERROR", bridged.error ?? "Benchmark bridge failed", { requestId: String(req.id) });
    return;
  }

  const data = bridged.data;
  if (data.ok === false) {
    res.status(data.error && String(data.error).includes("already running") ? 409 : 400).json(data);
    return;
  }
  apiUpCache = null;
  res.json(data);
});

router.post("/benchmark/chat", requireBenchmarkAuth, async (req, res) => {
  const body = req.body as { message?: string; forceRun?: boolean };
  const message = String(body.message ?? "").trim();
  if (!message) {
    sendApiError(res, 400, "BENCHMARK_BAD_REQUEST", "Type a request, e.g. '40 human' or 'smoke'", { requestId: String(req.id) });
    return;
  }

  const bridged = await invokeBenchmarkBridge("chat", {
    message,
    forceRun: body.forceRun !== false,
  });
  if (!bridged.ok) {
    sendApiError(res, bridged.status ?? 500, "BENCHMARK_BRIDGE_ERROR", bridged.error ?? "Benchmark bridge failed", { requestId: String(req.id) });
    return;
  }

  const data = bridged.data;
  if (data.ok === false) {
    const run = data.run as { error?: string } | undefined;
    const errText = String(data.error ?? run?.error ?? data.reply ?? "Request failed");
    res.status(errText.includes("already running") ? 409 : 400).json(data);
    return;
  }
  apiUpCache = null;
  res.json(data);
});

router.get("/benchmark/open-reports", requireBenchmarkAuth, (_req, res) => {
  if (process.platform === "win32" && fs.existsSync(reportsDir)) {
    try {
      spawn("explorer.exe", [reportsDir], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    } catch { /* ignore */ }
  }
  res.json({
    ok: true,
    path: reportsDir,
    message: "Reports folder opened on this PC (only works when you are self-hosting on the machine running Kwalify).",
  });
});

export default router;
