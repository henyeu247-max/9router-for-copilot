import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ThinkingBuffer } from '../thinkingBuffer';

function make() {
  const events: string[] = [];
  const buf = new ThinkingBuffer(
    { emitThinking: (t, id) => events.push(`T:${id}:${t}`), emitDone: (id) => events.push(`D:${id}`) },
    'id1'
  );
  return { buf, events };
}

describe('ThinkingBuffer', () => {
  test('emits all deltas as ONE part with a stable id, then done', () => {
    const { buf, events } = make();
    buf.push('Ch'); buf.push('à'); buf.push('o');
    buf.done();
    assert.deepEqual(events, ['T:id1:Chào', 'D:id1']);
  });
  test('ignores deltas after close (interleaved reasoning)', () => {
    const { buf, events } = make();
    buf.push('a'); buf.done(); buf.push('b'); buf.done();
    assert.deepEqual(events, ['T:id1:a', 'D:id1']);
  });
  test('finish() is a no-op when nothing was buffered', () => {
    const { buf, events } = make();
    buf.finish();
    assert.deepEqual(events, []);
  });
  test('finish() flushes and closes pending thinking', () => {
    const { buf, events } = make();
    buf.push('x'); buf.finish();
    assert.deepEqual(events, ['T:id1:x', 'D:id1']);
  });
});
