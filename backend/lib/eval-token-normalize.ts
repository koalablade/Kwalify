/** Normalize PLAYLIST_EVAL_TOKEN from env vars or headers (trim quotes/newlines). */
export function normalizeEvalToken(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/^["']+|["']+$/g, "").replace(/\r?\n/g, "");
}
