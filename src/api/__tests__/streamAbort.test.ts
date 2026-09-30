import { assert, describe, test } from 'vitest';
import { GatewayClient } from '../client';
import { describeStreamAbort, NO_RESPONSE_MESSAGE, SILENT_STREAM_MESSAGE } from '../streamAbort';
import type { GatewayConfig } from '../../config/gatewayConfig';

const config = (timeout: number): GatewayConfig => ({
  serverUrl: 'http://localhost:20128', apiKey: '', requestTimeout: timeout, defaultMaxTokens: 4096, defaultMaxOutputTokens: 4096,
  enableImageInput: false, visionProxyEnabled: false, modelFilter: '', visionProxyModel: '', enableToolCalling: true,
  parallelToolCalling: false, agentTemperature: 0, verboseLogging: false, debugMode: 'off', customHeaders: {},
  extraModelOptions: {}, perModelOptions: {}, modelContextWindows: {}, enableInlineCompletion: false, probeThinkingLevels: true,
  inlineCompletionModel: '', inlineCompletionMaxTokens: 128, inlineCompletionDebounce: 300, inlineCompletionTimeout: 5000,
  inlineCompletionMaxPrefixChars: 4000, inlineCompletionMaxSuffixChars: 2000,
} as unknown as GatewayConfig);

function tokenWithCancel() {
  let fire: () => void = () => undefined;
  const token = {
    isCancellationRequested: false,
    onCancellationRequested: (cb: () => void) => { fire = cb; return { dispose: () => undefined }; },
  } as unknown as import('vscode').CancellationToken;
  return { token, cancel: () => { (token as { isCancellationRequested: boolean }).isCancellationRequested = true; fire(); } };
}

/** A fetch that honours the abort signal like the real one: it rejects with "This operation was aborted". */
function hangingFetch(): typeof fetch {
  return ((_url: unknown, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')));
    })) as unknown as typeof fetch;
}

/** Headers arrive, then the body never sends another byte. */
function stallingBodyFetch(): typeof fetch {
  return ((_url: unknown, init?: { signal?: AbortSignal }) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        init?.signal?.addEventListener('abort', () => controller.error(new DOMException('This operation was aborted', 'AbortError')));
      },
    });
    return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
  }) as unknown as typeof fetch;
}

async function failureOf(fetchImpl: typeof fetch, timeout: number, cancelAfterMs?: number): Promise<string> {
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  const { token, cancel } = tokenWithCancel();
  if (cancelAfterMs !== undefined) { setTimeout(cancel, cancelAfterMs); }
  try {
    const client = new GatewayClient(config(timeout));
    for await (const chunk of client.streamChatCompletion({ model: 'm', messages: [] }, token)) { void chunk; }
    return 'NO ERROR';
  } catch (e) {
    return (e as Error).message;
  } finally {
    globalThis.fetch = original;
  }
}

describe('a stream that ends early says why (not just "This operation was aborted")', () => {
  test('no first byte within requestTimeout', async () => {
    const msg = await failureOf(hangingFetch(), 60);
    assert.include(msg, NO_RESPONSE_MESSAGE);
    assert.include(msg, 'requestTimeout');
    assert.notInclude(msg, 'This operation was aborted');
  });
  test('silence after the headers', async () => {
    const msg = await failureOf(stallingBodyFetch(), 60);
    assert.include(msg, SILENT_STREAM_MESSAGE);
    assert.notInclude(msg, NO_RESPONSE_MESSAGE);
  });
  test('the user pressing stop is named as such, even before the timeout', async () => {
    const msg = await failureOf(hangingFetch(), 5000, 20);
    assert.include(msg, 'cancelled');
    assert.notInclude(msg, NO_RESPONSE_MESSAGE);
  });
  test('the wording carries the configured number of seconds', () => {
    assert.include(describeStreamAbort('no-response', 300000), '300s');
    assert.include(describeStreamAbort('silent', 90000), '90s');
  });
});
