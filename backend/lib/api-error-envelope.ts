import type { Response } from "express";

export type ApiErrorBody = {
  success: false;
  code: string;
  error: string;
  requestId?: string;
  retryAfterSeconds?: number;
};

export function sendApiError(
  res: Response,
  status: number,
  code: string,
  error: string,
  opts: { requestId?: string; retryAfterSeconds?: number } = {},
): void {
  const body: ApiErrorBody = {
    success: false,
    code,
    error,
  };
  if (opts.requestId) body.requestId = opts.requestId;
  if (opts.retryAfterSeconds != null) body.retryAfterSeconds = opts.retryAfterSeconds;
  res.status(status).json(body);
}
