import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { REDACTED, redactSecrets, redactSensitiveValue } from '../privacy';

describe('privacy', () => {
  test('redacts bearer tokens and sk- keys in free text', () => {
    assert.equal(redactSecrets('Authorization: Bearer abc.def-123'), `Authorization: Bearer ${REDACTED}`);
    assert.equal(redactSecrets('key sk-abcdefgh12345678 end'), `key ${REDACTED} end`);
    assert.equal(redactSecrets('nothing here'), 'nothing here');
  });
  test('redacts sensitive keys deeply, keeps usage counters, does not mutate', () => {
    const input = {
      headers: { Authorization: 'Bearer zzz', 'x-api-key': 'k1' },
      body: { messages: [{ content: 'hi Bearer tok123' }], my_secret: 's', apiKey: 'abc' },
      usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
      empty: { api_key: '' },
    };
    const out = redactSensitiveValue(input);
    assert.equal(out.headers.Authorization, REDACTED);
    assert.equal(out.headers['x-api-key'], REDACTED);
    assert.equal(out.body.my_secret, REDACTED);
    assert.equal(out.body.apiKey, REDACTED);
    assert.equal(out.body.messages[0].content, `hi Bearer ${REDACTED}`);
    assert.deepEqual(out.usage, { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 });
    assert.equal(out.empty.api_key, '');
    assert.equal(input.headers.Authorization, 'Bearer zzz');
  });
});
