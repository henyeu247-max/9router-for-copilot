import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import {
  buildToolNameMap, restoreToolName, rewriteHistoryToolNames, wireToolCallId, wireToolName,
} from '../toolNames';

describe('wireToolName', () => {
  test('keeps valid short names unchanged', () => {
    assert.equal(wireToolName('read_file'), 'read_file');
    assert.equal(wireToolName('mcp.server_tool'), 'mcp.server_tool');
  });
  test('truncates >64 with stable hash suffix, total <=64', () => {
    const long = 'mcp_' + 'x'.repeat(80);
    const w = wireToolName(long);
    assert.ok(w.length <= 64);
    assert.equal(w, wireToolName(long));
    assert.notEqual(w, wireToolName(long + 'y'));
  });
  test('sanitizes charset and multiple dots', () => {
    const w = wireToolName('a b.c.d/e');
    assert.match(w, /^[a-zA-Z0-9_.-]+$/);
    assert.ok((w.match(/\./g) ?? []).length <= 1);
  });
});

describe('tool name map', () => {
  test('round-trips and is collision-free', () => {
    const a = 'p'.repeat(70) + 'A';
    const b = 'p'.repeat(70) + 'B';
    const map = buildToolNameMap([a, b, 'short']);
    const wa = map.originalToWire.get(a)!;
    const wb = map.originalToWire.get(b)!;
    assert.notEqual(wa, wb);
    assert.equal(restoreToolName(map, wa), a);
    assert.equal(restoreToolName(map, wb), b);
    assert.equal(restoreToolName(map, 'short'), 'short');
    assert.equal(restoreToolName(map, 'unknown'), 'unknown');
  });
});

describe('history rewrite', () => {
  test('rewrites tool_calls names/ids and tool result ids', () => {
    const name = 'n'.repeat(90);
    const id = 'call_' + 'z'.repeat(80);
    const map = buildToolNameMap([name]);
    const msgs = [
      { role: 'assistant', tool_calls: [{ id, function: { name } }] },
      { role: 'tool', tool_call_id: id },
    ];
    rewriteHistoryToolNames(msgs, map);
    assert.ok(msgs[0].tool_calls![0].function.name.length <= 64);
    assert.ok(msgs[0].tool_calls![0].id.length <= 64);
    assert.equal(msgs[1].tool_call_id, msgs[0].tool_calls![0].id);
    assert.equal(wireToolCallId('short'), 'short');
  });
});

describe('history rewrite (advisor cases)', () => {
  test('is a no-op on already valid names and ids', () => {
    const map = buildToolNameMap(['read_file']);
    const msgs = [
      { role: 'assistant', tool_calls: [{ id: 'call_1', function: { name: 'read_file' } }] },
      { role: 'tool', tool_call_id: 'call_1' },
    ];
    const before = JSON.stringify(msgs);
    rewriteHistoryToolNames(msgs, map);
    assert.equal(JSON.stringify(msgs), before);
  });
  test('assistant tool_calls and tool results stay correlated after rewrite', () => {
    const name = 'q'.repeat(100);
    const id = 'toolu_' + 'k'.repeat(90);
    const map = buildToolNameMap([name]);
    const msgs = [
      { role: 'assistant', tool_calls: [{ id, function: { name } }] },
      { role: 'tool', tool_call_id: id },
    ];
    rewriteHistoryToolNames(msgs, map);
    assert.equal(msgs[1].tool_call_id, msgs[0].tool_calls![0].id);
    assert.equal(msgs[0].tool_calls![0].function.name, map.originalToWire.get(name));
  });
  test('ignores messages without tool data', () => {
    const msgs = [{ role: 'user', content: 'hi' }];
    assert.doesNotThrow(() => rewriteHistoryToolNames(msgs, buildToolNameMap([])));
  });
});
