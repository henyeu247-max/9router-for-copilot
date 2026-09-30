import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { dedupeToolCallIds } from '../toolCallIds';
import type { OpenAIMessage } from '../../api/types';

const call = (id: string, name: string) => ({ id, type: 'function', function: { name, arguments: '{}' } });
const asst = (...calls: Array<ReturnType<typeof call>>): OpenAIMessage => ({ role: 'assistant', content: null, tool_calls: calls });
const tool = (id: string, content = 'ok'): OpenAIMessage => ({ role: 'tool', tool_call_id: id, content });
const user = (t: string): OpenAIMessage => ({ role: 'user', content: t });

const ids = (msgs: OpenAIMessage[]) => msgs.flatMap((m) => (Array.isArray(m.tool_calls) ? (m.tool_calls as Array<{ id: string }>).map((c) => c.id) : []));
const results = (msgs: OpenAIMessage[]) => msgs.filter((m) => m.role === 'tool').map((m) => m.tool_call_id as string);

describe('dedupeToolCallIds', () => {
  test('a history with unique ids is returned untouched (same array)', () => {
    const msgs = [user('hi'), asst(call('a', 'read_file')), tool('a'), asst(call('b', 'grep')), tool('b')];
    const r = dedupeToolCallIds(msgs);
    assert.equal(r.renamed, 0);
    assert.equal(r.messages, msgs);
  });

  test('the real failure: call_149461 = read_file, later reused by run_in_terminal', () => {
    const msgs = [
      user('go'),
      asst(call('call_149461', 'read_file')), tool('call_149461', 'file text'),
      user('next'),
      asst(call('call_149461', 'run_in_terminal')), tool('call_149461', 'terminal output'),
    ];
    const r = dedupeToolCallIds(msgs);
    assert.equal(r.renamed, 1);
    const callIds = ids(r.messages);
    assert.equal(new Set(callIds).size, callIds.length, 'ids must be unique');
    assert.equal(callIds[0], 'call_149461', 'the first use keeps its id');
    // pairing preserved: each result points at the call that produced it
    assert.deepEqual(results(r.messages), callIds);
    assert.equal((r.messages[2] as { content: string }).content, 'file text');
    assert.equal((r.messages[5] as { content: string }).content, 'terminal output');
  });

  test('does not mutate the input', () => {
    const msgs = [asst(call('x', 'a')), tool('x'), asst(call('x', 'b')), tool('x')];
    const snapshot = JSON.stringify(msgs);
    dedupeToolCallIds(msgs);
    assert.equal(JSON.stringify(msgs), snapshot);
  });

  test('the same id twice inside ONE assistant turn is split, results matched in order', () => {
    const msgs = [asst(call('d', 'one'), call('d', 'two')), tool('d', 'r1'), tool('d', 'r2')];
    const r = dedupeToolCallIds(msgs);
    const callIds = ids(r.messages);
    assert.equal(new Set(callIds).size, 2);
    assert.deepEqual(results(r.messages), callIds);
    assert.equal((r.messages[1] as { content: string }).content, 'r1');
    assert.equal((r.messages[2] as { content: string }).content, 'r2');
  });

  test('three reuses all become distinct', () => {
    const msgs: OpenAIMessage[] = [];
    for (let i = 0; i < 3; i++) { msgs.push(asst(call('same', `t${i}`)), tool('same', `r${i}`)); }
    const r = dedupeToolCallIds(msgs);
    assert.equal(r.renamed, 2);
    assert.equal(new Set(ids(r.messages)).size, 3);
    assert.deepEqual(results(r.messages), ids(r.messages));
  });

  test('a generated id never collides with an id that already exists later', () => {
    const msgs = [asst(call('a', 't1')), tool('a'), asst(call('a', 't2')), tool('a'), asst(call('a_dup2', 't3')), tool('a_dup2')];
    const r = dedupeToolCallIds(msgs);
    const callIds = ids(r.messages);
    assert.equal(new Set(callIds).size, callIds.length, callIds.join(','));
    assert.deepEqual(results(r.messages), callIds);
  });

  test('renamed ids stay within 64 characters', () => {
    const long = 'c'.repeat(64);
    const r = dedupeToolCallIds([asst(call(long, 'a')), tool(long), asst(call(long, 'b')), tool(long)]);
    for (const id of ids(r.messages)) { assert.ok(id.length <= 64, `${id.length}`); }
    assert.equal(new Set(ids(r.messages)).size, 2);
  });

  test('a tool result with an unknown id, and calls without an id, pass through', () => {
    const msgs = [tool('orphan'), { role: 'assistant', content: null, tool_calls: [{ type: 'function', function: { name: 'n', arguments: '{}' } }] } as OpenAIMessage];
    const r = dedupeToolCallIds(msgs);
    assert.equal(r.renamed, 0);
    assert.equal(r.messages, msgs);
  });

  test('other message fields are preserved on renamed messages', () => {
    const a2: OpenAIMessage = { role: 'assistant', content: 'thinking out loud', tool_calls: [call('z', 'b')] };
    const r = dedupeToolCallIds([asst(call('z', 'a')), tool('z'), a2, tool('z')]);
    assert.equal((r.messages[2] as { content: string }).content, 'thinking out loud');
    assert.equal(r.messages[2].role, 'assistant');
  });
});
