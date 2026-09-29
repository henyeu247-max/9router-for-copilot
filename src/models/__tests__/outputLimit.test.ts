import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { MAX_OUTPUT_WINDOW_SHARE, chooseMaxOutputTokens } from '../outputLimit';

const base = { defaultMaxOutputTokens: 4096, minOutputTokens: 64, adjustBuffer: 256 };

describe('chooseMaxOutputTokens', () => {
  test('uses the server-declared output (top-level first, then capabilities)', () => {
    const a = chooseMaxOutputTokens({ ...base, totalContext: 1_000_000, maxCompletionTokens: 128000, capabilitiesMaxOutput: 4096 });
    assert.deepEqual(a, { maxOutputTokens: 128000, source: 'server', clamped: false });
    const b = chooseMaxOutputTokens({ ...base, totalContext: 1_000_000, capabilitiesMaxOutput: 65536 });
    assert.equal(b.maxOutputTokens, 65536);
    assert.equal(b.source, 'server');
  });
  test('ignores non-positive / non-numeric declarations and falls back to the setting', () => {
    const r = chooseMaxOutputTokens({ ...base, totalContext: 200_000, maxCompletionTokens: 0, capabilitiesMaxOutput: NaN });
    assert.deepEqual(r, { maxOutputTokens: 4096, source: 'default', clamped: false });
  });
  test('caps at 50% of the window when the server declares the whole window (500K/500K)', () => {
    const r = chooseMaxOutputTokens({ ...base, totalContext: 500_000, maxCompletionTokens: 500_000 });
    assert.equal(r.maxOutputTokens, 500_000 * MAX_OUTPUT_WINDOW_SHARE);
    assert.equal(r.clamped, true);
  });
  test('tiny windows keep at least the minimum and never exceed window - buffer', () => {
    const r = chooseMaxOutputTokens({ ...base, totalContext: 300, maxCompletionTokens: 9999 });
    assert.ok(r.maxOutputTokens >= 64 && r.maxOutputTokens <= 300 - 0);
    const s = chooseMaxOutputTokens({ ...base, totalContext: 100, defaultMaxOutputTokens: 4096 });
    assert.ok(s.maxOutputTokens >= 64);
  });
  test('the fallback setting is also capped by the window share', () => {
    const r = chooseMaxOutputTokens({ ...base, totalContext: 4000 });
    assert.equal(r.maxOutputTokens, 2000);
  });
});
