/**
 * Retry an HTTP request on 429 / 503 with `Retry-After` (seconds or HTTP date)
 * or exponential backoff. Only used BEFORE the response body is consumed, so
 * it is safe for streaming requests. Pure and unit-testable.
 */
export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  isCancelled?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

const RETRYABLE = new Set([429, 503]);

export function parseRetryAfterMs(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) { return undefined; }
  const secs = Number(value);
  if (Number.isFinite(secs)) { return Math.max(0, secs * 1000); }
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

export async function fetchWithRateLimitRetry(
  doFetch: () => Promise<Response>,
  opts: RetryOptions = {}
): Promise<Response> {
  const { maxAttempts = 4, baseDelayMs = 1000, maxDelayMs = 30_000 } = opts;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let attempt = 0;
  for (;;) {
    const response = await doFetch();
    attempt++;
    if (!RETRYABLE.has(response.status) || attempt >= maxAttempts || opts.isCancelled?.()) {
      return response;
    }
    const wait = Math.min(
      parseRetryAfterMs(response.headers.get('retry-after')) ?? baseDelayMs * 2 ** (attempt - 1),
      maxDelayMs
    );
    opts.log?.(`HTTP ${response.status}; retry ${attempt}/${maxAttempts - 1} in ${wait}ms`);
    try { await response.body?.cancel(); } catch { /* ignore */ }
    await sleep(wait);
    if (opts.isCancelled?.()) { return response; }
  }
}
