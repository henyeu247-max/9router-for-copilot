import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { parseOutputLimitError } from '../outputLimitError';

describe('parseOutputLimitError (messages taken from primary sources)', () => {
  test('OpenAI wording', () => {
    assert.equal(
      parseOutputLimitError('Chat completion failed: 400 - {"error":{"message":"max_tokens is too large: 32000. This model supports at most 4096 completion tokens, whereas you provided 32000.","param":"max_tokens"}}'),
      4096
    );
  });
  test('Anthropic wording (line-wrapped as in the report)', () => {
    assert.equal(
      parseOutputLimitError('400 {"message":"max_tokens: 100001 > 64000, which is the maximum allowed number of output tokens for claude-sonnet-4-5-20250929"}'),
      64000
    );
  });
  test('unrelated errors and context overflows are not mistaken for it', () => {
    assert.equal(parseOutputLimitError('This model\'s maximum context length is 8192 tokens'), undefined);
    assert.equal(parseOutputLimitError('invalid api key'), undefined);
    assert.equal(parseOutputLimitError('max_tokens must be positive'), undefined);
  });
});
