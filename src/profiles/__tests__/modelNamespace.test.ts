import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import {
  decodeSlashInModelId,
  encodeSlashInModelId,
  formatExposedModelId,
  parseModelTarget,
} from '../modelNamespace';

describe('formatExposedModelId', () => {
  test('returns raw ID when namespaceEnabled is false (single provider)', () => {
    assert.equal(
      formatExposedModelId('default', 'qwen2.5-coder-32b', false),
      'qwen2.5-coder-32b'
    );
  });

  test('namespaces ID as profileId/rawModelId when namespaceEnabled is true (multiple providers)', () => {
    assert.equal(
      formatExposedModelId('ollama-local', 'deepseek-r1:14b', true),
      'ollama-local/deepseek-r1:14b'
    );
    assert.equal(
      formatExposedModelId('cloud-9router', 'gpt-4o', true),
      'cloud-9router/gpt-4o'
    );
  });
});

describe('parseModelTarget', () => {
  const knownProfiles = ['default', 'ollama-local', 'cloud-9router'];

  test('parses namespaced model ID matching a known profile', () => {
    const result = parseModelTarget('ollama-local/qwen2.5-coder', knownProfiles, 'default');
    assert.deepEqual(result, {
      profileId: 'ollama-local',
      rawModelId: 'qwen2.5-coder',
    });
  });

  test('handles model IDs containing additional slashes', () => {
    const result = parseModelTarget('cloud-9router/meta-llama/Llama-3-70b', knownProfiles, 'default');
    assert.deepEqual(result, {
      profileId: 'cloud-9router',
      rawModelId: 'meta-llama/Llama-3-70b',
    });
  });

  test('falls back to default profile when model ID is not namespaced', () => {
    const result = parseModelTarget('qwen2.5-coder-32b', knownProfiles, 'default');
    assert.deepEqual(result, {
      profileId: 'default',
      rawModelId: 'qwen2.5-coder-32b',
    });
  });

  test('falls back when prefix does not match any known profile', () => {
    const result = parseModelTarget('unknown-provider/model-x', knownProfiles, 'default');
    assert.deepEqual(result, {
      profileId: 'default',
      rawModelId: 'unknown-provider/model-x',
    });
  });

  test('uses first known profile if specified fallback is not in list', () => {
    const result = parseModelTarget('some-model', ['custom-profile'], 'default');
    assert.deepEqual(result, {
      profileId: 'custom-profile',
      rawModelId: 'some-model',
    });
  });
});

describe('slash encoding (opt-in)', () => {
  test('encode/decode round-trip and default is unchanged', () => {
    assert.equal(formatExposedModelId('p', 'xai/grok-4.5', false), 'xai/grok-4.5');
    assert.equal(formatExposedModelId('p', 'xai/grok-4.5', false, true), 'xai::grok-4.5');
    assert.equal(formatExposedModelId('p', 'xai/grok-4.5', true, true), 'p/xai::grok-4.5');
    assert.equal(decodeSlashInModelId(encodeSlashInModelId('a/b/c')), 'a/b/c');
    assert.equal(parseModelTarget('xai::grok-4.5', ['p'], 'p').rawModelId, 'xai/grok-4.5');
    assert.deepEqual(parseModelTarget('p/xai::grok-4.5', ['p', 'q'], 'p'), {
      profileId: 'p',
      rawModelId: 'xai/grok-4.5',
    });
    // legacy slash ids keep working whether or not the setting is on
    assert.equal(parseModelTarget('xai/grok-4.5', ['p'], 'p').rawModelId, 'xai/grok-4.5');
  });
});

describe('two profiles: 9Router default + CLIProxyAPI (raw ids that contain slashes)', () => {
  const known = ['default', 'cliproxy'];
  test('a CLIProxyAPI id with its own provider prefix round-trips', () => {
    for (const raw of ['ag/claude-sonnet-4-6', 'cpa/gemini-3-flash', 'gemini-3-flash', 'claude-opus-5']) {
      const exposed = formatExposedModelId('cliproxy', raw, true);
      assert.deepEqual(parseModelTarget(exposed, known, 'default'), { profileId: 'cliproxy', rawModelId: raw });
    }
  });
  test('a 9Router id that also exists on CLIProxyAPI stays routed to its own profile', () => {
    const a = formatExposedModelId('default', 'gpt-6.1-sol', true);
    const b = formatExposedModelId('cliproxy', 'gpt-6.1-sol', true);
    assert.notEqual(a, b);
    assert.equal(parseModelTarget(a, known, 'default').profileId, 'default');
    assert.equal(parseModelTarget(b, known, 'default').profileId, 'cliproxy');
  });
  test('an id saved before the second profile existed (no prefix) still reaches the default profile', () => {
    assert.deepEqual(parseModelTarget('cx/gpt-6.1-sol', known, 'default'), { profileId: 'default', rawModelId: 'cx/gpt-6.1-sol' });
  });
});
