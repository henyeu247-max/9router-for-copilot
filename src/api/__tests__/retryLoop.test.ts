import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { runWithRecovery } from '../retryLoop';
import { type DegradeStep } from '../degrade';

const err400 = (m: string) => Object.assign(new Error(`Chat completion failed: 400 - ${m}`), { status: 400 });

function harness(script: Array<Error | 'ok'>, opts: Partial<{ reported: boolean; cancelled: boolean; overflow: boolean; tools: boolean; reasoning: boolean; outputLimit: boolean }> = {}) {
  const degraded = new Set<DegradeStep>();
  const logs: string[] = [];
  let calls = 0;
  const attempt = async () => {
    const step = script[calls++] ?? 'ok';
    if (step !== 'ok') { throw step; }
  };
  const run = () =>
    runWithRecovery({
      attempt,
      partsReported: () => opts.reported ?? false,
      isCancelled: () => opts.cancelled ?? false,
      learnFromOverflow: () => opts.overflow ?? false,
      learnFromOutputLimit: () => opts.outputLimit ?? false,
      lastRequest: () => ({ hasReasoning: opts.reasoning ?? true, hasTools: opts.tools ?? true }),
      degraded,
      log: (m) => logs.push(m),
    });
  return { run, degraded, logs, calls: () => calls };
}

describe('runWithRecovery', () => {
  test('success on first try: one call, no retries', async () => {
    const h = harness(['ok']);
    await h.run();
    assert.equal(h.calls(), 1);
  });
  test('hinted tools rejection strips tools when the request has no reasoning', async () => {
    const h = harness([err400('tools are not supported'), 'ok'], { reasoning: false });
    await h.run();
    assert.equal(h.calls(), 2);
    assert.deepEqual([...h.degraded], ['tools']);
  });
  test('ambiguous 400 strips reasoning once then surfaces the ORIGINAL error (bounded)', async () => {
    const e = err400('Invalid request parameters');
    const h = harness([e, e, e, e, e]);
    await assert.rejects(h.run(), (x) => x === e);
    assert.equal(h.calls(), 2);
    assert.deepEqual([...h.degraded], ['reasoning']);
  });
  test('worst case is bounded: overflow + reasoning + tools = 4 attempts, then the last error surfaces', async () => {
    const last = new Error('boom');
    const h = harness(
      [
        new Error('context length exceeded'),
        err400('unknown parameter reasoning_effort'),
        err400('this model does not support tools'),
        last,
      ],
      { overflow: true }
    );
    await assert.rejects(h.run(), (x) => x === last);
    assert.equal(h.calls(), 4);
    assert.deepEqual([...h.degraded].sort(), ['reasoning', 'tools']);
  });
  test('never retries once output was streamed', async () => {
    const h = harness([err400('tools are not supported'), 'ok'], { reported: true });
    await assert.rejects(h.run());
    assert.equal(h.calls(), 1);
  });
  test('never retries after cancellation', async () => {
    const h = harness([err400('tools are not supported'), 'ok'], { cancelled: true });
    await assert.rejects(h.run());
    assert.equal(h.calls(), 1);
  });
  test('non-400 errors are rethrown untouched', async () => {
    const e = Object.assign(new Error('Chat completion failed: 500 x'), { status: 500 });
    const h = harness([e, 'ok']);
    await assert.rejects(h.run(), (x) => x === e);
    assert.equal(h.calls(), 1);
  });
  test('overflow is retried exactly once', async () => {
    const o = new Error('overflow');
    const h = harness([o, o, o], { overflow: true });
    await assert.rejects(h.run());
    assert.equal(h.calls(), 2);
  });
});

describe('runWithRecovery: max_tokens too large', () => {
  test('retries once with a smaller max_tokens when a limit was learned, then succeeds', async () => {
    const h = harness([err400('max_tokens is too large: 32000. This model supports at most 4096 completion tokens'), 'ok'], { outputLimit: true });
    await h.run();
    assert.equal(h.calls(), 2);
    assert.deepEqual([...h.degraded], []);
  });
  test('is retried only once even if the error repeats', async () => {
    const e = err400('max_tokens is too large');
    const h = harness([e, e, e], { outputLimit: true, tools: false, reasoning: false });
    await assert.rejects(h.run(), (x) => x === e);
    assert.equal(h.calls(), 2);
  });
  test('does not retry when nothing was learned', async () => {
    const e = err400('max_tokens is too large');
    const h = harness([e, 'ok'], { outputLimit: false, tools: false, reasoning: false });
    await assert.rejects(h.run(), (x) => x === e);
    assert.equal(h.calls(), 1);
  });
});
