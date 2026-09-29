import { test, describe } from 'node:test';
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
