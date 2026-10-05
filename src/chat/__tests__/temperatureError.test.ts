import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { parseTemperatureError, isTemperatureError } from '../temperatureError';

describe('parseTemperatureError', () => {
  it('detects Kimi K3 error ("field Temperature invalid, only 1 is allowed for this model")', () => {
    const raw =
      'Chat completion failed: 400 Bad Request - {"error":{"message":"[400]: {\\"error\\":{\\"message\\":\\"field Temperature invalid, only 1 is allowed for this model\\",\\"type\\":\\"invalid_request_error\\",\\"param\\":\\"temperature\\",\\"code\\":\\"3\\"}}","type":"invalid_request_error","code":"bad_request"}}';
    assert.equal(isTemperatureError(raw), true);
    assert.deepEqual(parseTemperatureError(raw), { kind: 'fixed', value: 1 });
  });

  it('detects Anthropic Claude thinking error ("temperature: 1.0 is required when thinking is enabled")', () => {
    const err = 'temperature: 1.0 is required when thinking is enabled';
    assert.equal(isTemperatureError(err), true);
    assert.deepEqual(parseTemperatureError(err), { kind: 'fixed', value: 1.0 });
  });

  it('detects "temperature must be 1.0"', () => {
    const err = 'temperature must be 1.0 for reasoning models';
    assert.equal(isTemperatureError(err), true);
    assert.deepEqual(parseTemperatureError(err), { kind: 'fixed', value: 1.0 });
  });

  it('detects OpenAI o1 unsupported parameter ("Unsupported parameter: \'temperature\' is not supported with this model")', () => {
    const err = "Unsupported parameter: 'temperature' is not supported with this model.";
    assert.equal(isTemperatureError(err), true);
    assert.deepEqual(parseTemperatureError(err), { kind: 'omit' });
  });

  it('detects "temperature is not supported for this model"', () => {
    const err = 'temperature is not supported for this model';
    assert.equal(isTemperatureError(err), true);
    assert.deepEqual(parseTemperatureError(err), { kind: 'omit' });
  });

  it('detects generic invalid temperature ("invalid value for temperature")', () => {
    const err = '{"error":{"message":"invalid value for temperature","param":"temperature"}}';
    assert.equal(isTemperatureError(err), true);
    assert.deepEqual(parseTemperatureError(err), { kind: 'fixed', value: 1 });
  });

  it('returns undefined for unrelated errors', () => {
    assert.equal(isTemperatureError('Chat completion failed: 500 Internal Server Error'), false);
    assert.equal(parseTemperatureError('Chat completion failed: 500 Internal Server Error'), undefined);
    assert.equal(isTemperatureError('max_tokens is too large: 32000'), false);
    assert.equal(parseTemperatureError('max_tokens is too large: 32000'), undefined);
    assert.equal(isTemperatureError('maximum context length is 4096 tokens'), false);
    assert.equal(parseTemperatureError('maximum context length is 4096 tokens'), undefined);
  });
});
