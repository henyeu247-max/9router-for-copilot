import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { degradeRequest, httpStatusOf, pickDegradeStep, type DegradeStep } from '../degrade';

const e = (m: string) => new Error(m);
const st = (o: Partial<{ hasReasoning: boolean; hasTools: boolean; done: DegradeStep[] }> = {}) => ({
  hasReasoning: true, hasTools: true, ...o, done: new Set<DegradeStep>(o.done ?? []),
});

describe('httpStatusOf', () => {
  test('parses our error formats', () => {
    assert.equal(httpStatusOf(e('Chat completion failed: 400 Bad Request - x')), 400);
    assert.equal(httpStatusOf(e('Chat completion request failed: HTTP 429')), 429);
    assert.equal(httpStatusOf(e('boom')), undefined);
  });
});

describe('pickDegradeStep', () => {
  test('ignores non-400', () => {
    assert.equal(pickDegradeStep(e('Chat completion failed: 500 x'), st()), undefined);
    assert.equal(pickDegradeStep(e('Chat completion failed: 401 x'), st()), undefined);
  });
  test('follows the hint in the message', () => {
    assert.equal(pickDegradeStep(e('Chat completion failed: 400 - tools are not supported by this model'), st()), 'tools');
    assert.equal(pickDegradeStep(e('Chat completion failed: 400 - unknown parameter reasoning_effort'), st()), 'reasoning');
  });
  test('ambiguous 400 strips reasoning once, and never tools without a hint', () => {
    const err = e('Chat completion failed: 400 - Invalid request parameters');
    assert.equal(pickDegradeStep(err, st()), 'reasoning');
    assert.equal(pickDegradeStep(err, st({ done: ['reasoning'] })), undefined);
  });
  test('tools are stripped only when the message points at tools', () => {
    const err = e('Chat completion failed: 400 - this model does not support tools');
    assert.equal(pickDegradeStep(err, st({ done: ['reasoning'] })), 'tools');
    assert.equal(pickDegradeStep(err, st({ done: ['reasoning', 'tools'] })), undefined);
  });
  test('history-format errors mentioning function.arguments do not strip tools', () => {
    const err = e('Chat completion failed: 400 - tool_calls[0].function.arguments invalid JSON');
    assert.equal(pickDegradeStep(err, st({ done: ['reasoning'] })), undefined);
  });
  test('typed status is preferred over message text', () => {
    const err = Object.assign(new Error('weird text'), { status: 400 });
    assert.equal(httpStatusOf(err), 400);
    assert.equal(pickDegradeStep(err, st()), 'reasoning');
  });
  test('never proposes a step that has nothing to strip', () => {
    const err = e('Chat completion failed: 400 - tools are not supported');
    assert.equal(pickDegradeStep(err, st({ hasReasoning: false })), 'tools');
    assert.equal(pickDegradeStep(err, st({ hasReasoning: false, hasTools: false })), undefined);
  });
});

describe('degradeRequest', () => {
  const req = { model: 'm', messages: [], tools: [{}], tool_choice: 'auto', parallel_tool_calls: true, reasoning_effort: 'high' };
  test('strips reasoning without touching tools', () => {
    const r = degradeRequest(req, 'reasoning');
    assert.equal('reasoning_effort' in r, false);
    assert.equal('tools' in r, true);
  });
  test('strips tool fields without touching reasoning; input unchanged', () => {
    const r = degradeRequest(req, 'tools');
    assert.equal('tools' in r || 'tool_choice' in r || 'parallel_tool_calls' in r, false);
    assert.equal(r.reasoning_effort, 'high');
    assert.equal('tools' in req, true);
  });
});
