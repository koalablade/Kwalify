/** Canonical public site URL (no trailing slash), e.g. https://kwalify.net */
export function getPublicBaseUrl(): string | undefined {
  const app = process.env.APP_URL?.trim();
  if (app) return app.replace(/\/$/, "");

  const front = process.env.FRONTEND_URL?.split(",")[0]?.trim();
  if (front) return front.replace(/\/$/, "");

  return undefined;
}

/** Build an absolute URL for share links and redirects. */
export function publicUrl(path: string, fallback?: string): string {
  const base = getPublicBaseUrl();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (base) return `${base}${normalized}`;
  return fallback ?? normalized;
}
