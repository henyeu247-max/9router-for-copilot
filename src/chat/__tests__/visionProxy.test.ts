import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  IMAGE_DESCRIPTION_UNAVAILABLE, buildDescribeRequest, describeImagesInMessages,
  extractCompletionText, messagesHaveImages, pickVisionModelId,
} from '../visionProxy';

const img = (url: string) => ({ type: 'image_url', image_url: { url } });
const msgs = () => [
  { role: 'user', content: 'plain' },
  { role: 'user', content: [{ type: 'text', text: 'look' }, img('data:a'), img('data:b')] },
];
const texts = (m: Record<string, unknown>) => (m.content as Array<{ text: string }>).map((p) => p.text);

describe('visionProxy', () => {
  test('detects images', () => {
    assert.equal(messagesHaveImages(msgs()), true);
    assert.equal(messagesHaveImages([{ role: 'user', content: 'x' }]), false);
  });

  test('replaces images by one description per message, keeps text, no mutation', async () => {
    const input = msgs();
    let calls = 0;
    const r = await describeImagesInMessages(input, async (urls) => {
      calls++;
      assert.deepEqual(urls, ['data:a', 'data:b']);
      return ' a cat ';
    });
    assert.equal(calls, 1);
    assert.equal(r.imageCount, 2);
    assert.deepEqual(r.messages[0], input[0]);
    const t = texts(r.messages[1]);
    assert.equal(t.length, 2);
    assert.equal(t[0], 'look');
    assert.match(t[1], /Here is its description: a cat\]$/);
    assert.equal(messagesHaveImages(r.messages), false);
    assert.equal(messagesHaveImages(input), true);
  });

  test('failure or empty description degrades to marker without throwing', async () => {
    const a = await describeImagesInMessages(msgs(), async () => {
      throw new Error('boom');
    });
    assert.equal(texts(a.messages[1])[1], IMAGE_DESCRIPTION_UNAVAILABLE);
    const b = await describeImagesInMessages(msgs(), async () => '   ');
    assert.equal(texts(b.messages[1])[1], IMAGE_DESCRIPTION_UNAVAILABLE);
  });

  test('describe request + response parsing', () => {
    const req = buildDescribeRequest('m', ['u1']) as { messages: Array<{ content: unknown[] }>; stream: boolean };
    assert.equal(req.stream, false);
    assert.equal(req.messages[0].content.length, 2);
    assert.equal(extractCompletionText({ choices: [{ message: { content: 'hi' } }] }), 'hi');
    assert.equal(extractCompletionText({ choices: [{ message: { content: [{ text: 'a' }, { text: 'b' }] } }] }), 'ab');
    assert.equal(extractCompletionText({}), '');
  });

  test('pickVisionModelId honors preferred, else cheap vision, else first vision', () => {
    const ms = [{ id: 'big', vision: true }, { id: 'x-flash', vision: true }, { id: 'txt', vision: false }];
    assert.equal(pickVisionModelId(ms, 'big'), 'big');
    assert.equal(pickVisionModelId(ms, 'gone'), 'x-flash');
    assert.equal(pickVisionModelId([{ id: 'a', vision: true }]), 'a');
    assert.equal(pickVisionModelId([{ id: 'a', vision: false }]), undefined);
  });
});
