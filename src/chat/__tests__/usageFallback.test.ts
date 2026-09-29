import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { estimatePromptTokens, estimateUsage, isEmptyUsage } from '../usageFallback';

describe('usageFallback', () => {
  test('estimatePromptTokens counts messages and tool schemas (~4 chars/token)', () => {
    assert.equal(estimatePromptTokens('a'.repeat(400), 0), 100);
    assert.equal(estimatePromptTokens('a'.repeat(400), 200), 150);
  });
  test('estimateUsage sums prompt and completion and never goes negative', () => {
    const u = estimateUsage(1000, 41);
    assert.equal(u.prompt_tokens, 1000);
    assert.equal(u.completion_tokens, 11);
    assert.equal(u.total_tokens, 1011);
    assert.deepEqual(u.prompt_tokens_details, { cached_tokens: 0 });
    const z = estimateUsage(-5, -9);
    assert.equal(z.prompt_tokens, 0);
    assert.equal(z.completion_tokens, 0);
  });
  test('isEmptyUsage: missing or all-zero is empty, any real count is not', () => {
    assert.equal(isEmptyUsage(undefined), true);
    assert.equal(isEmptyUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }), true);
    assert.equal(isEmptyUsage({ prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 }), false);
    assert.equal(isEmptyUsage({ prompt_tokens: 0, completion_tokens: 3, total_tokens: 3 }), false);
  });
});
