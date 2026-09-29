import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { fetchWithRateLimitRetry, parseRetryAfterMs } from '../rateLimitRetry';

const res = (status: number, headers: Record<string, string> = {}) => new Response(null, { status, headers });

describe('parseRetryAfterMs', () => {
  test('seconds and http-date', () => {
    assert.equal(parseRetryAfterMs('2'), 2000);
    assert.equal(parseRetryAfterMs(new Date(10_000).toUTCString(), 4_000), 6000);
    assert.equal(parseRetryAfterMs('garbage'), undefined);
    assert.equal(parseRetryAfterMs(null), undefined);
  });
});

describe('fetchWithRateLimitRetry', () => {
  test('retries 429 honoring Retry-After then succeeds', async () => {
    const waits: number[] = [];
    let n = 0;
    const r = await fetchWithRateLimitRetry(async () => (++n < 3 ? res(429, { 'retry-after': '1' }) : res(200)), {
      sleep: async (ms) => { waits.push(ms); },
    });
    assert.equal(r.status, 200);
    assert.deepEqual(waits, [1000, 1000]);
  });
  test('exponential backoff without header and gives up after maxAttempts', async () => {
    const waits: number[] = [];
    let n = 0;
    const r = await fetchWithRateLimitRetry(async () => { n++; return res(429); }, {
      maxAttempts: 3, baseDelayMs: 100, sleep: async (ms) => { waits.push(ms); },
    });
    assert.equal(r.status, 429);
    assert.equal(n, 3);
    assert.deepEqual(waits, [100, 200]);
  });
  test('does not retry non-retryable statuses (400/500)', async () => {
    let n = 0;
    const r = await fetchWithRateLimitRetry(async () => { n++; return res(400); }, { sleep: async () => {} });
    assert.equal(r.status, 400);
    assert.equal(n, 1);
  });
  test('stops when cancelled', async () => {
    let n = 0;
    await fetchWithRateLimitRetry(async () => { n++; return res(429); }, { isCancelled: () => true, sleep: async () => {} });
    assert.equal(n, 1);
  });
});
