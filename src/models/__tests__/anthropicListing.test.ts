import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { CLOAK_PREFIX, applyListingLimits, decodeCloakedId, needsListingLimits, parseAnthropicListing } from '../anthropicListing';
import type { OpenAIModel } from '../../api/types';

// Rows copied from a live CLIProxyAPI Anthropic-style answer (anthropic-version header).
const LIVE = {
  data: [
    { id: 'claude-opus-5', display_name: 'Claude Opus 5', max_input_tokens: 1000000, max_tokens: 128000, type: 'model' },
    { id: 'claude-haiku-4-5-20251001', display_name: 'Claude 4.5 Haiku', max_input_tokens: 200000, max_tokens: 64000, type: 'model' },
    { id: 'claude-fable-5-dd-hsalf-3-inimeg', display_name: 'Gemini 3 Flash', max_input_tokens: 1048576, max_tokens: 65536, type: 'model' },
    { id: 'claude-fable-5-dd-los-1.6-tpg', display_name: 'GPT 6.1 Sol', max_input_tokens: 272000, max_tokens: 128000, type: 'model' },
    { id: 'claude-fable-5-dd-muidem-b021-sso-tpg', display_name: 'GPT-OSS 120B (Medium)', max_input_tokens: 114000, max_tokens: 32768, type: 'model' },
  ],
  has_more: false,
};
const bare = (id: string): OpenAIModel => ({ id, object: 'model', created: 0, owned_by: 'x' });

describe('decodeCloakedId (CLIProxyAPI: prefix + id reversed rune by rune)', () => {
  test('decodes the real aliases', () => {
    assert.equal(decodeCloakedId('claude-fable-5-dd-hsalf-3-inimeg'), 'gemini-3-flash');
    assert.equal(decodeCloakedId('claude-fable-5-dd-los-1.6-tpg'), 'gpt-6.1-sol');
    assert.equal(decodeCloakedId('claude-fable-5-dd-eralf-5.2-egami-tpg'), 'gpt-image-2.5-flare');
    assert.equal(decodeCloakedId('claude-fable-5-dd-etil-hsalf-1.3-inimeg'), 'gemini-3.1-flash-lite');
  });
  test('ids that are not cloaked, and a bare prefix, are returned unchanged', () => {
    assert.equal(decodeCloakedId('claude-opus-5'), 'claude-opus-5');
    assert.equal(decodeCloakedId(CLOAK_PREFIX), CLOAK_PREFIX);
    assert.equal(decodeCloakedId(''), '');
  });
  test('round-trips ids with a provider slash and unicode', () => {
    const enc = (id: string) => CLOAK_PREFIX + [...id].reverse().join('');
    for (const id of ['ag/gemini-3.8-flash-high', 'cpa/claude-sonnet-4-6', 'modèle-é', 'a']) { assert.equal(decodeCloakedId(enc(id)), id); }
  });
});

describe('parseAnthropicListing', () => {
  test('reads the live shape and keys rows by their decoded id', () => {
    const m = parseAnthropicListing(LIVE);
    assert.equal(m.size, 5);
    assert.deepEqual(m.get('claude-opus-5'), { contextWindow: 1000000, maxOutput: 128000 });
    assert.deepEqual(m.get('gemini-3-flash'), { contextWindow: 1048576, maxOutput: 65536 });
    assert.deepEqual(m.get('gpt-6.1-sol'), { contextWindow: 272000, maxOutput: 128000 });
    assert.equal(m.has('claude-fable-5-dd-hsalf-3-inimeg'), false);
  });
  test('ignores rows without BOTH positive numbers, and non-listings', () => {
    const m = parseAnthropicListing({ data: [{ id: 'a', max_input_tokens: 10 }, { id: 'b', max_tokens: 10 }, { id: 'c', max_input_tokens: 0, max_tokens: 5 }, { id: 'd', max_input_tokens: '9', max_tokens: 1 }, { max_input_tokens: 9, max_tokens: 1 }, { id: 'ok', max_input_tokens: 9, max_tokens: 1 }, null] });
    assert.deepEqual([...m.keys()], ['ok']);
    for (const bad of [undefined, null, 5, 'x', {}, { data: 'no' }, { data: null }]) { assert.equal(parseAnthropicListing(bad).size, 0); }
  });
});

describe('applyListingLimits / needsListingLimits', () => {
  const limits = parseAnthropicListing(LIVE);

  test('a bare-id gateway needs the listing; a gateway that already reports context does not', () => {
    assert.equal(needsListingLimits([bare('gemini-3-flash')]), true);
    assert.equal(needsListingLimits([{ ...bare('x'), context_length: 1000 }, { ...bare('y'), capabilities: { contextWindow: 5 } }]), false);
    assert.equal(needsListingLimits([]), false);
  });

  test('fills context and output on matching bare rows (real + cloaked ids)', () => {
    const r = applyListingLimits([bare('claude-opus-5'), bare('gemini-3-flash'), bare('gpt-6.1-sol'), bare('unknown-model')], limits);
    assert.equal(r.filled, 3);
    const by = Object.fromEntries(r.models.map((m) => [m.id, m]));
    assert.equal(by['claude-opus-5'].context_length, 1000000);
    assert.equal(by['claude-opus-5'].max_completion_tokens, 128000);
    assert.equal(by['gemini-3-flash'].context_length, 1048576);
    assert.equal(by['gpt-6.1-sol'].max_completion_tokens, 128000);
    assert.equal(by['unknown-model'].context_length, undefined);
  });

  test('never replaces what the server already reported (context, output) - each filled independently', () => {
    const r = applyListingLimits([
      { ...bare('claude-opus-5'), context_length: 500000 },
      { ...bare('gemini-3-flash'), max_completion_tokens: 8192 },
      { ...bare('gpt-6.1-sol'), capabilities: { contextWindow: 400000, maxOutput: 100000 } },
    ], limits);
    const by = Object.fromEntries(r.models.map((m) => [m.id, m]));
    assert.equal(by['claude-opus-5'].context_length, 500000);
    assert.equal(by['claude-opus-5'].max_completion_tokens, 128000);
    assert.equal(by['gemini-3-flash'].context_length, 1048576);
    assert.equal(by['gemini-3-flash'].max_completion_tokens, 8192);
    assert.equal(by['gpt-6.1-sol'].context_length, undefined);
    assert.equal(r.filled, 2);
  });

  test('returns the same array when nothing changes, and does not mutate the input', () => {
    const rows = [bare('unknown-model'), { ...bare('claude-opus-5'), context_length: 1, max_completion_tokens: 1 }];
    const snap = JSON.stringify(rows);
    const r = applyListingLimits(rows, limits);
    assert.equal(r.models, rows);
    assert.equal(r.filled, 0);
    assert.equal(JSON.stringify(rows), snap);
  });
});
