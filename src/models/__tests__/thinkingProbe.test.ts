import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { PROBE_LEVEL, applyProbedLevels, classifyProbe, parseValidLevels } from '../thinkingProbe';
import { hasCloakedIds } from '../anthropicListing';
import type { OpenAIModel } from '../../api/types';

// Bodies copied from a live CLIProxyAPI (answers to reasoning_effort "__probe__").
const body = (msg: string) => JSON.stringify({ error: { message: msg, type: 'invalid_request_error' } });
const LIVE = {
  opus46: body('level "__probe__" not supported, valid levels: low, medium, high, max'),
  opus47: body('level "__probe__" not supported, valid levels: low, medium, high, xhigh, max'),
  gpt55: body('level "__probe__" not supported, valid levels: low, medium, high, xhigh'),
  geminiFlash: body('level "__probe__" not supported, valid levels: minimal, low, medium, high'),
  geminiImage: body('level "__probe__" not supported, valid levels: minimal, high'),
  unknown: body('unknown level: __probe__'),
};
const bare = (id: string): OpenAIModel => ({ id, object: 'model', created: 0, owned_by: 'x' });

describe('parseValidLevels', () => {
  test('reads the exact per-model lists the gateway returned', () => {
    assert.deepEqual(parseValidLevels(LIVE.opus46), ['low', 'medium', 'high', 'max']);
    assert.deepEqual(parseValidLevels(LIVE.opus47), ['low', 'medium', 'high', 'xhigh', 'max']);
    assert.deepEqual(parseValidLevels(LIVE.gpt55), ['low', 'medium', 'high', 'xhigh']);
    assert.deepEqual(parseValidLevels(LIVE.geminiFlash), ['minimal', 'low', 'medium', 'high']);
    assert.deepEqual(parseValidLevels(LIVE.geminiImage), ['minimal', 'high']);
  });
  test('keeps only levels the request path can send, lowercased, deduplicated', () => {
    assert.deepEqual(parseValidLevels('valid levels: none, Low, low, auto, HIGH, thinking'), ['low', 'high']);
  });
  test('no list -> empty', () => {
    for (const t of [LIVE.unknown, '', 'invalid api key', 'valid levels:']) { assert.deepEqual(parseValidLevels(t), []); }
  });
});

describe('classifyProbe', () => {
  test('400 with a list -> levels', () => {
    assert.deepEqual(classifyProbe(400, LIVE.opus46), { kind: 'levels', levels: ['low', 'medium', 'high', 'max'] });
  });
  test('400 "unknown level" and 200 (the model accepted the bogus value) -> none', () => {
    assert.deepEqual(classifyProbe(400, LIVE.unknown), { kind: 'none' });
    assert.deepEqual(classifyProbe(400, body('thinking not supported for this model')), { kind: 'none' });
    assert.deepEqual(classifyProbe(200, '{"choices":[]}'), { kind: 'none' });
  });
  test('an answer without a readable list (unknown wording, retired model, refused max_tokens) is "none", not an error', () => {
    for (const [s, b] of [[400, 'some other 400'], [400, 'max_tokens must be greater than thinking.budget_tokens'], [404, 'no model'], [422, 'bad']] as const) {
      assert.deepEqual(classifyProbe(s, b), { kind: 'none' }, `${s} ${b}`);
    }
  });
  test('only transient trouble is an error (auth, rate limit, server error, network)', () => {
    for (const [s, b] of [[401, 'bad key'], [403, 'no'], [429, 'slow'], [500, 'boom'], [503, 'x'], [undefined, '']] as const) {
      assert.deepEqual(classifyProbe(s, b), { kind: 'error' }, `${s}`);
    }
  });
  test('the probe level is not something a gateway could take as real', () => {
    assert.ok(!['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'none', 'auto'].includes(PROBE_LEVEL));
  });
});

describe('applyProbedLevels', () => {
  const levels = new Map<string, readonly string[]>([['claude-opus-4-6', ['low', 'medium', 'high', 'max']], ['gemini-3-flash', ['minimal', 'low']]]);
  test('gives bare rows an explicit reasoningEffort list and marks them as reasoning', () => {
    const r = applyProbedLevels([bare('claude-opus-4-6'), bare('unknown')], levels);
    assert.deepEqual(r[0].capabilities, { reasoning: true, reasoningEffort: ['low', 'medium', 'high', 'max'] });
    assert.equal(r[1].capabilities, undefined);
  });
  test('never touches a row that already has capabilities, and does not mutate its input', () => {
    const own = { ...bare('claude-opus-4-6'), capabilities: { tools: true } };
    const rows = [own];
    const snap = JSON.stringify(rows);
    const r = applyProbedLevels(rows, levels);
    assert.equal(r[0], own);
    assert.equal(JSON.stringify(rows), snap);
  });
});

describe('hasCloakedIds (CLIProxyAPI signature)', () => {
  test('true only when a cloaked id is present', () => {
    assert.equal(hasCloakedIds({ data: [{ id: 'claude-opus-5' }, { id: 'claude-fable-5-dd-hsalf-3-inimeg' }] }), true);
    assert.equal(hasCloakedIds({ data: [{ id: 'claude-opus-5' }, { id: 'gpt-5' }] }), false);
    assert.equal(hasCloakedIds({ data: [{ id: 'claude-fable-5-dd-' }] }), false);
    for (const bad of [undefined, null, 'x', {}, { data: 'no' }, { data: [null, 5, {}] }]) { assert.equal(hasCloakedIds(bad), false); }
  });
});
