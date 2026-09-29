import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { buildDump, dumpFileName, normalizeDebugMode, pickDumpsToPrune, summarizeRequest, writeDump, type DumpFs } from '../requestDump';

const req = {
  model: 'cc/claude',
  temperature: 0,
  api_key: 'leak',
  messages: [
    { role: 'system', content: 'be nice' },
    { role: 'user', content: [{ type: 'text', text: 'hello' }, { type: 'image_url', image_url: { url: 'data:x' } }] },
    { role: 'assistant', content: null, tool_calls: [{ id: '1' }] },
  ],
  tools: [{ function: { name: 'read_file' } }],
};

describe('requestDump', () => {
  test('normalizeDebugMode defaults to off', () => {
    assert.equal(normalizeDebugMode('verbose'), 'verbose');
    assert.equal(normalizeDebugMode('metadata'), 'metadata');
    assert.equal(normalizeDebugMode('x'), 'off');
    assert.equal(normalizeDebugMode(undefined), 'off');
  });
  test('summary has no message content but keeps shape', () => {
    const s = summarizeRequest(req) as { messageCount: number; toolNames: string[]; messages: Array<{ chars: number; hasImage: boolean; toolCalls: number }>; params: Record<string, unknown> };
    assert.equal(s.messageCount, 3);
    assert.deepEqual(s.toolNames, ['read_file']);
    assert.equal(s.messages[0].chars, 7);
    assert.equal(s.messages[1].hasImage, true);
    assert.equal(s.messages[2].toolCalls, 1);
    assert.equal(s.params.api_key, '***REDACTED***');
    assert.equal(JSON.stringify(s).includes('be nice'), false);
  });
  test('off -> nothing; metadata -> no request body; verbose -> body with secrets redacted', () => {
    const base = { profileName: 'p', modelId: 'm', request: req };
    assert.equal(buildDump({ ...base, mode: 'off' }), undefined);
    assert.equal('request' in (buildDump({ ...base, mode: 'metadata' }) as object), false);
    const v = buildDump({ ...base, mode: 'verbose' }) as { request: { api_key: string } };
    assert.equal(v.request.api_key, '***REDACTED***');
    assert.equal(req.api_key, 'leak');
  });
  test('file names are safe and sortable', () => {
    const n = dumpFileName(new Date('2026-09-30T05:57:12.345Z'), 'xai/grok 4.5:beta');
    assert.equal(n, '2026-09-30T05-57-12-345Z_xai_grok_4.5_beta.json');
  });
  test('prune keeps the newest N', () => {
    const names = ['a.json', 'b.json', 'c.json', 'note.txt'];
    assert.deepEqual(pickDumpsToPrune(names, 2), ['a.json']);
    assert.deepEqual(pickDumpsToPrune(names, 5), []);
  });
  test('writeDump writes, prunes, and never throws', async () => {
    const files = new Map<string, string>();
    const fs: DumpFs = {
      mkdir: async () => undefined,
      writeFile: async (p, d) => { files.set(p, d); },
      readdir: async () => [...files.keys()].map((k) => k.split('/').pop() as string),
      unlink: async (p) => { files.delete(p); },
    };
    const path = await writeDump(fs, '/d', { mode: 'verbose', profileName: 'p', modelId: 'm', request: req, now: new Date('2026-01-01T00:00:00Z') });
    assert.ok(path && files.has(path));
    assert.equal(await writeDump(fs, '/d', { mode: 'off', profileName: 'p', modelId: 'm', request: req }), undefined);
    const broken: DumpFs = { ...fs, writeFile: async () => { throw new Error('disk'); } };
    assert.equal(await writeDump(broken, '/d', { mode: 'verbose', profileName: 'p', modelId: 'm', request: req }), undefined);
  });
});
