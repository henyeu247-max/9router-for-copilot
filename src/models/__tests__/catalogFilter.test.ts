import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { applyModelFilter, compileModelFilter, isChatCapable, selectChatModels } from '../catalogFilter';

describe('isChatCapable', () => {
  test('drops specialty kinds/types', () => {
    assert.equal(isChatCapable({ id: 'a', type: 'image' }), false);
    assert.equal(isChatCapable({ id: 'a', kind: 'webSearch' }), false);
    assert.equal(isChatCapable({ id: 'a', type: 'Embedding' }), false);
    assert.equal(isChatCapable({ id: 'a', supported_endpoints: ['images'] }), false);
  });
  test('keeps chat, responses-only, imageToText and untyped', () => {
    assert.equal(isChatCapable({ id: 'a' }), true);
    assert.equal(isChatCapable({ id: 'a', type: 'chat' }), true);
    assert.equal(isChatCapable({ id: 'a', kind: 'imageToText' }), true);
    assert.equal(isChatCapable({ id: 'a', supported_endpoints: ['responses'] }), true);
    assert.equal(isChatCapable({ id: 'a', supported_endpoints: [] }), true);
  });
  test('selectChatModels preserves order', () => {
    const r = selectChatModels([{ id: '1' }, { id: '2', type: 'audio' }, { id: '3' }]);
    assert.deepEqual(r.map((m) => m.id), ['1', '3']);
  });
});

describe('model filter', () => {
  const ms = [{ id: 'cc/claude-x' }, { id: 'gh/gpt-5' }, { id: 'oc/free.v1' }];
  test('regex, substring fallback, empty', () => {
    assert.deepEqual(applyModelFilter(ms, '^cc/').map((m) => m.id), ['cc/claude-x']);
    assert.deepEqual(applyModelFilter(ms, 'free.v1').map((m) => m.id), ['oc/free.v1']);
    assert.equal(applyModelFilter(ms, '').length, 3);
    assert.equal(compileModelFilter('(') instanceof RegExp, true);
  });
  test('a filter matching nothing is ignored (never blanks the picker)', () => {
    assert.equal(applyModelFilter(ms, 'zzz').length, 3);
  });
});

describe('id-based non-chat detection for rows without any metadata (CLIProxyAPI style)', () => {
  test('hides OpenAI image/audio/embedding families when the row has no metadata', () => {
    for (const id of ['gpt-image-2', 'gpt-image-2.5-sunburst', 'dall-e-3', 'imagen-4', 'sora-2', 'whisper-1', 'tts-1', 'text-embedding-3-small', 'omni-moderation-latest', 'ag/gpt-image-1.5']) {
      assert.equal(isChatCapable({ id }), false, id);
    }
  });
  test('keeps chat models, including gemini image models that DO answer chat (measured)', () => {
    for (const id of ['gemini-3.1-flash-image', 'gpt-5.5', 'claude-opus-5', 'codex-auto-review', 'gpt-oss-120b-medium', 'cpa/gemini-3-flash']) {
      assert.equal(isChatCapable({ id }), true, id);
    }
  });
  test('a row that carries metadata is judged by that metadata, never by its id', () => {
    assert.equal(isChatCapable({ id: 'gpt-image-2', capabilities: { tools: true } }), true);
    assert.equal(isChatCapable({ id: 'gpt-image-2', kind: 'llm' }), true);
    assert.equal(isChatCapable({ id: 'gpt-image-2', type: 'image' }), false);
  });
});
