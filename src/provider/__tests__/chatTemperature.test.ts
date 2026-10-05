import { describe, test, vi } from 'vitest';
import assert from 'node:assert/strict';

vi.mock('vscode', async () => {
  const base = await import('../../../test/vscode.mock');
  class LanguageModelThinkingPart {
    constructor(public value: string, public id?: string, public metadata?: unknown) {}
  }
  return {
    ...base,
    LanguageModelThinkingPart,
    window: { showErrorMessage: () => Promise.resolve(undefined) },
    workspace: { getConfiguration: () => ({ update: () => Promise.resolve() }) },
    commands: { executeCommand: () => Promise.resolve() },
    ConfigurationTarget: { Global: 1 },
  };
});

import * as vscode from 'vscode';
import { ChatRequestHandler } from '../chatRequestHandler';
import type { GatewayConfig } from '../../config/gatewayConfig';
import type { OpenAIChatCompletionRequest } from '../../api/types';

const KIMI_ERROR =
  'Chat completion failed: 400 Bad Request - {"error":{"message":"[400]: {\\"error\\":{\\"message\\":\\"field Temperature invalid, only 1 is allowed for this model\\",\\"type\\":\\"invalid_request_error\\",\\"param\\":\\"temperature\\",\\"code\\":\\"3\\"}}","type":"invalid_request_error","code":"bad_request"}}';

const config = (): GatewayConfig =>
  ({
    serverUrl: 'http://localhost:20128/v1', apiKey: '', requestTimeout: 1000, defaultMaxTokens: 262144,
    defaultMaxOutputTokens: 4096, enableImageInput: false, visionProxyEnabled: false, visionProxyModel: '',
    modelFilter: '', enableToolCalling: true, parallelToolCalling: true, agentTemperature: 0,
    verboseLogging: false, debugMode: 'off', customHeaders: {}, extraModelOptions: {}, perModelOptions: {},
    modelContextWindows: {}, probeThinkingLevels: false,
  }) as unknown as GatewayConfig;

/** Harness: records every request body; `respond` decides per call to fail or stream "ok". */
function harness(respond: (req: OpenAIChatCompletionRequest, n: number) => Error | undefined, learned?: { kind: 'fixed'; value: number }) {
  const sent: OpenAIChatCompletionRequest[] = [];
  let learnedTemp: { kind: 'fixed'; value: number } | { kind: 'omit' } | undefined = learned;
  const client = {
    streamChatCompletion: (req: OpenAIChatCompletionRequest) => {
      sent.push(JSON.parse(JSON.stringify(req)));
      const err = respond(req, sent.length);
      return (async function* () {
        if (err) { throw err; }
        yield { choices: [{ delta: { content: 'ok' } }] };
      })();
    },
  };
  const catalog = {
    resolveModelMaxContext: () => 1048576,
    getLearnedOutputLimit: () => undefined,
    getDiscoveredParams: () => undefined,
    getLearnedTemperature: () => learnedTemp,
    learnContextSizeFromError: () => false,
    learnOutputLimitFromError: () => false,
    learnTemperatureFromError: (_m: unknown, e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      if (/temperature/i.test(msg) && learnedTemp === undefined) { learnedTemp = { kind: 'fixed', value: 1 }; return true; }
      return false;
    },
    modelVision: () => undefined,
    listModelVision: () => [],
  };
  const logs: string[] = [];
  const handler = new ChatRequestHandler({
    getDumpDir: () => '',
    profileName: () => 'Default',
    client: client as never,
    catalog: catalog as never,
    getConfig: config,
    log: (m) => logs.push(m),
    onRequestState: () => undefined,
    onCompleted: () => undefined,
    showOutput: () => undefined,
  });
  return { handler, sent, logs };
}

const model = (id: string) =>
  ({ id, name: id, family: 'x', version: '1', maxInputTokens: 917504, maxOutputTokens: 131072, capabilities: {} }) as unknown as vscode.LanguageModelChatInformation;
const userMsg = [{ role: vscode.LanguageModelChatMessageRole.User, content: [new vscode.LanguageModelTextPart('chao')], name: undefined }] as unknown as vscode.LanguageModelChatMessage[];
const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => undefined }) } as unknown as vscode.CancellationToken;
const tools = [{ name: 'view', description: 'v', inputSchema: { type: 'object', properties: {} } }];
const progress = { report: () => undefined };

describe('ChatRequestHandler temperature on the wire (sn/kimi-k3 reproduction)', () => {
  test('Copilot agent request (modelOptions.temperature=0, tools, reasoning high) sends temperature=1 to kimi', async () => {
    const h = harness(() => undefined);
    await h.handler.handle(
      model('sn/kimi-k3'),
      userMsg,
      { tools, toolMode: vscode.LanguageModelChatToolMode.Auto, modelOptions: { temperature: 0, reasoningEffort: 'high' } } as never,
      progress,
      token
    );
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0].temperature, 1);
  });

  test('unknown model that the gateway rejects with the kimi error is retried with temperature=1 and succeeds', async () => {
    const h = harness((req) => (req.temperature === 1 ? undefined : Object.assign(new Error(KIMI_ERROR), { status: 400 })));
    await h.handler.handle(
      model('vendor/some-new-model'),
      userMsg,
      { tools, toolMode: vscode.LanguageModelChatToolMode.Auto, modelOptions: { temperature: 0 } } as never,
      progress,
      token
    );
    assert.deepEqual(h.sent.map((r) => r.temperature), [0, 1]);
    assert.ok(h.logs.some((l) => l.includes('corrected temperature')));
  });
});
