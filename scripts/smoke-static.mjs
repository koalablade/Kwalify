import { readFileSync } from "node:fs";

const checks = [
  {
    file: "backend/app.ts",
    includes: "env.NODE_ENV === \"production\" ? false : true",
    message: "Production CORS must fail closed when APP_URL/FRONTEND_URL are missing.",
  },
  {
    file: "backend/routes/health.ts",
    includes: "router.get(\"/readyz\"",
    message: "Readiness endpoint must exist.",
  },
  {
    file: "backend/lib/db-init.ts",
    includes: "IDX_liked_songs_user_track",
    message: "Liked songs must have a unique user/track guard.",
  },
  {
    file: "frontend/public/pages/app.js",
    includes: "AbortController",
    message: "Mood preview requests must be abortable to avoid stale UI.",
  },
  {
    file: "frontend/public/styles/base.css",
    includes: ":focus-visible",
    message: "Keyboard focus must be visible.",
  },
];

const failures = checks.filter((check) => {
  const text = readFileSync(check.file, "utf8");
  return !text.includes(check.includes);
});

if (failures.length) {
  for (const failure of failures) {
    console.error(`[smoke-static] ${failure.file}: ${failure.message}`);
  }
  process.exit(1);
}

console.log(`[smoke-static] ${checks.length} production checks passed`);

