import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import type { CancellationToken, LanguageModelChatInformation } from 'vscode';
import { ModelCatalog } from '../modelCatalog';
import { GatewayClient } from '../../api/client';
import { GatewayConfig } from '../../config/gatewayConfig';
import { OpenAIModelsResponse } from '../../api/types';
import { DiscoveredModelInfo, ModelDiscovery } from '../../discovery/types';
import { TOKEN_CONSTANTS } from '../../chat/tokenBudget';

function fakeToken(cancelled = false): CancellationToken {
  return {
    isCancellationRequested: cancelled,
    onCancellationRequested: () => ({ dispose: () => undefined }),
  } as unknown as CancellationToken;
}

function fakeConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    serverUrl: 'http://localhost:8000',
    apiKey: '',
    requestTimeout: 60000,
    defaultMaxTokens: 128000,
    defaultMaxOutputTokens: 4096,
    enableImageInput: true,
    visionProxyEnabled: false,
    modelFilter: '',
    visionProxyModel: '',
    enableToolCalling: true,
    parallelToolCalling: true,
    agentTemperature: 0,
    verboseLogging: false,
    debugMode: 'off',
    customHeaders: {},
    extraModelOptions: {},
    perModelOptions: {},
    modelContextWindows: {},
    enableInlineCompletion: false,
    probeThinkingLevels: true,
    inlineCompletionModel: '',
    inlineCompletionMaxTokens: 256,
    inlineCompletionDebounce: 300,
    inlineCompletionTimeout: 3000,
    inlineCompletionMaxPrefixChars: 4000,
    inlineCompletionMaxSuffixChars: 1000,
    ...overrides,
  };
}

function modelsResponse(...ids: Array<{ id: string; contextLen?: number }>): OpenAIModelsResponse {
  return {
    object: 'list',
    data: ids.map(({ id, contextLen }) => ({
      id,
      object: 'model',
      created: 0,
      owned_by: 'test',
      ...(contextLen !== undefined ? { max_model_len: contextLen } : {}),
    })),
  };
}

interface Harness {
  catalog: ModelCatalog;
  fetchCalls: number;
  statusChanges: number;
}

/** Discovery stub for a backend with no native metadata API. */
function noDiscovery(): ModelDiscovery {
  return {
    reset: () => undefined,
    enrichModel: () => Promise.resolve(undefined),
  };
}

function makeCatalog(options: {
  fetchModels: () => Promise<OpenAIModelsResponse>;
  config?: GatewayConfig;
  discovery?: ModelDiscovery;
}): Harness {
  const harness = { fetchCalls: 0, statusChanges: 0 } as Harness;
  const client = {
    fetchModels: () => {
      harness.fetchCalls++;
      return options.fetchModels();
    },
  } as unknown as GatewayClient;
  harness.catalog = new ModelCatalog({
    client,
    discovery: options.discovery ?? noDiscovery(),
    getConfig: () => options.config ?? fakeConfig(),
    log: () => undefined,
    onStatusChanged: () => {
      harness.statusChanges++;
    },
  });
  return harness;
}

function chatInfo(id: string, maxInputTokens = 0): LanguageModelChatInformation {
  return { id, maxInputTokens } as unknown as LanguageModelChatInformation;
}

describe('ModelCatalog.getOrFetchModels', () => {
  test('fetches, exposes models, and records a successful connection', async () => {
    const h = makeCatalog({
      fetchModels: () => Promise.resolve(modelsResponse({ id: 'a' }, { id: 'b' })),
    });
    const { models, error } = await h.catalog.getOrFetchModels(fakeToken());
    assert.equal(error, undefined);
    assert.deepEqual(models.map((m) => m.id), ['a', 'b']);
    assert.deepEqual(h.catalog.getCachedModels().map((m) => m.id), ['a', 'b']);
    assert.notEqual(h.catalog.getLastSuccessfulFetchAt(), undefined);
    assert.equal(h.catalog.getLastConnectionError(), undefined);
    assert.equal(h.statusChanges, 1);
  });

  test('serves the short-lived cache instead of re-fetching', async () => {
    const h = makeCatalog({
      fetchModels: () => Promise.resolve(modelsResponse({ id: 'a' })),
    });
    await h.catalog.getOrFetchModels(fakeToken());
    await h.catalog.getOrFetchModels(fakeToken());
    assert.equal(h.fetchCalls, 1);
  });

  test('re-fetches after invalidateCache', async () => {
    const h = makeCatalog({
      fetchModels: () => Promise.resolve(modelsResponse({ id: 'a' })),
    });
    await h.catalog.getOrFetchModels(fakeToken());
    h.catalog.invalidateCache();
    await h.catalog.getOrFetchModels(fakeToken());
    assert.equal(h.fetchCalls, 2);
  });

  test('concurrent callers share a single in-flight request', async () => {
    let release: (r: OpenAIModelsResponse) => void = () => undefined;
    const h = makeCatalog({
      fetchModels: () => new Promise((resolve) => { release = resolve; }),
    });
    const first = h.catalog.getOrFetchModels(fakeToken());
    const second = h.catalog.getOrFetchModels(fakeToken());
    release(modelsResponse({ id: 'a' }));
    const [r1, r2] = await Promise.all([first, second]);
    assert.equal(h.fetchCalls, 1);
    assert.deepEqual(r1.models.map((m) => m.id), ['a']);
    assert.deepEqual(r2.models.map((m) => m.id), ['a']);
  });

  test('surfaces fetch failures as an error result and records the connection error', async () => {
    const h = makeCatalog({
      fetchModels: () => Promise.reject(new Error('boom')),
    });
    const { models, error } = await h.catalog.getOrFetchModels(fakeToken());
    assert.deepEqual(models, []);
    assert.equal(error, 'boom');
    assert.equal(h.catalog.getLastConnectionError(), 'boom');
    assert.equal(h.statusChanges, 1);
  });

  test('a later success clears the recorded connection error', async () => {
    let fail = true;
    const h = makeCatalog({
      fetchModels: () =>
        fail ? Promise.reject(new Error('boom')) : Promise.resolve(modelsResponse({ id: 'a' })),
    });
    await h.catalog.getOrFetchModels(fakeToken());
    fail = false;
    await h.catalog.getOrFetchModels(fakeToken());
    assert.equal(h.catalog.getLastConnectionError(), undefined);
  });

  test('does not cache results from a cancelled fetch', async () => {
    const h = makeCatalog({
      fetchModels: () => Promise.resolve(modelsResponse({ id: 'a' })),
    });
    const { models } = await h.catalog.getOrFetchModels(fakeToken(true));
    assert.deepEqual(models, []);
    assert.equal(h.catalog.getLastSuccessfulFetchAt(), undefined);
    // Next (uncancelled) call must re-probe rather than see a stale empty list.
    await h.catalog.getOrFetchModels(fakeToken());
    assert.equal(h.fetchCalls, 2);
    assert.equal(h.catalog.getCachedModels().length, 1);
  });
});

describe('ModelCatalog discovery integration', () => {
  function fixedDiscovery(byId: Record<string, DiscoveredModelInfo>): ModelDiscovery {
    return {
      reset: () => undefined,
      enrichModel: (modelId) => Promise.resolve(byId[modelId]),
    };
  }

  test('discovered context wins over defaultMaxTokens and feeds the chat budget', async () => {
    const h = makeCatalog({
      fetchModels: () => Promise.resolve(modelsResponse({ id: 'a' })),
      discovery: fixedDiscovery({
        a: { contextLength: 65536, contextSource: 'Ollama num_ctx (/api/show)', samplerParams: {} },
      }),
    });
    const { models } = await h.catalog.getOrFetchModels(fakeToken());
    assert.equal(models[0].maxInputTokens + models[0].maxOutputTokens, 65536);
    assert.equal(h.catalog.getContextForModel('a'), 65536);
  });

  test('exposes discovered sampler params to the chat path', async () => {
    const h = makeCatalog({
      fetchModels: () => Promise.resolve(modelsResponse({ id: 'a' })),
      discovery: fixedDiscovery({
        a: { samplerParams: { temperature: 0.7, top_p: 0.8 } },
      }),
    });
    await h.catalog.getOrFetchModels(fakeToken());
    assert.deepEqual(h.catalog.getDiscoveredParams('a'), { temperature: 0.7, top_p: 0.8 });
    assert.equal(h.catalog.getDiscoveredParams('unknown'), undefined);
  });

  test('discovered capability verdicts gate tool/vision support', async () => {
    const h = makeCatalog({
      fetchModels: () => Promise.resolve(modelsResponse({ id: 'a' })),
      discovery: fixedDiscovery({
        a: { samplerParams: {}, toolsSupported: false, visionSupported: false },
      }),
    });
    const { models } = await h.catalog.getOrFetchModels(fakeToken());
    assert.equal(models[0].capabilities?.toolCalling, false);
    assert.equal(models[0].capabilities?.imageInput, false);
  });

  test('unknown capability verdicts (undefined) keep the settings-driven defaults', async () => {
    const h = makeCatalog({
      fetchModels: () => Promise.resolve(modelsResponse({ id: 'a' })),
      discovery: fixedDiscovery({ a: { samplerParams: {} } }),
    });
    const { models } = await h.catalog.getOrFetchModels(fakeToken());
    assert.equal(models[0].capabilities?.toolCalling, true);
    assert.equal(models[0].capabilities?.imageInput, true);
  });

  test('a re-fetch drops discovered data for models the server removed', async () => {
    let ids = [{ id: 'a' }, { id: 'b' }];
    const h = makeCatalog({
      fetchModels: () => Promise.resolve(modelsResponse(...ids)),
      discovery: fixedDiscovery({
        a: { samplerParams: { top_p: 0.9 } },
        b: { samplerParams: { top_p: 0.5 } },
      }),
    });
    await h.catalog.getOrFetchModels(fakeToken());
    assert.ok(h.catalog.getDiscoveredParams('b'));
    ids = [{ id: 'a' }];
    h.catalog.invalidateCache();
    await h.catalog.getOrFetchModels(fakeToken());
    assert.equal(h.catalog.getDiscoveredParams('b'), undefined);
  });
});

describe('ModelCatalog.resolveModelMaxContext', () => {
  test('prefers the server-reported context recorded during the fetch', async () => {
    const h = makeCatalog({
      fetchModels: () => Promise.resolve(modelsResponse({ id: 'a', contextLen: 2048 })),
    });
    await h.catalog.getOrFetchModels(fakeToken());
    assert.equal(h.catalog.getContextForModel('a'), 2048);
    assert.equal(h.catalog.resolveModelMaxContext(chatInfo('a', 999999)), 2048);
  });

  test('falls back to maxInputTokens + maxOutputTokens before any fetch', () => {
    const h = makeCatalog({ fetchModels: () => Promise.resolve(modelsResponse()) });
    assert.equal(h.catalog.resolveModelMaxContext(chatInfo('a', 4096)), 4096);
    const withOutput = { id: 'a', maxInputTokens: 4096, maxOutputTokens: 1024 } as unknown as LanguageModelChatInformation;
    assert.equal(h.catalog.resolveModelMaxContext(withOutput), 5120);
  });

  test('falls back to the default context when nothing is known', () => {
    const h = makeCatalog({ fetchModels: () => Promise.resolve(modelsResponse()) });
    assert.equal(
      h.catalog.resolveModelMaxContext(chatInfo('a')),
      TOKEN_CONSTANTS.DEFAULT_CONTEXT_TOKENS
    );
  });
});

describe('ModelCatalog.learnContextSizeFromError', () => {
  test('learns a smaller context from an overflow error and applies it', () => {
    const h = makeCatalog({ fetchModels: () => Promise.resolve(modelsResponse()) });
    const model = chatInfo('a', 8192);
    const learned = h.catalog.learnContextSizeFromError(
      model,
      new Error("This model's maximum context length is 4096 tokens. However, you requested 5000 tokens.")
    );
    assert.equal(learned, true);
    assert.equal(h.catalog.resolveModelMaxContext(model), 4096);
  });

  test('ignores unrelated errors', () => {
    const h = makeCatalog({ fetchModels: () => Promise.resolve(modelsResponse()) });
    assert.equal(
      h.catalog.learnContextSizeFromError(chatInfo('a', 8192), new Error('connection refused')),
      false
    );
  });

  test('returns false when the reported context is not smaller than the current budget', () => {
    const h = makeCatalog({ fetchModels: () => Promise.resolve(modelsResponse()) });
    const model = chatInfo('a', 4096);
    const learned = h.catalog.learnContextSizeFromError(
      model,
      new Error('maximum context length is 8192 tokens')
    );
    assert.equal(learned, false);
    assert.equal(h.catalog.resolveModelMaxContext(model), 4096);
  });

  test('clearLearnedContexts reverts to the advertised size', () => {
    const h = makeCatalog({ fetchModels: () => Promise.resolve(modelsResponse()) });
    const model = chatInfo('a', 8192);
    h.catalog.learnContextSizeFromError(model, new Error('maximum context length is 4096 tokens'));
    assert.equal(h.catalog.resolveModelMaxContext(model), 4096);
    h.catalog.clearLearnedContexts();
    assert.equal(h.catalog.resolveModelMaxContext(model), 8192);
  });
});

describe('ModelCatalog: catalog shaping (integration)', () => {
  const resp = (): OpenAIModelsResponse =>
    ({
      object: 'list',
      data: [
        { id: 'cc/claude', object: 'model', created: 0, owned_by: 'cc', capabilities: { vision: true } },
        { id: 'oc/text-only', object: 'model', created: 0, owned_by: 'oc', capabilities: { vision: false } },
        { id: 'img/gen', object: 'model', created: 0, owned_by: 'img', type: 'image' },
        { id: 'emb/x', object: 'model', created: 0, owned_by: 'emb', kind: 'embedding' },
        { id: 'cx/resp', object: 'model', created: 0, owned_by: 'cx', supported_endpoints: ['responses'] },
      ],
    }) as unknown as OpenAIModelsResponse;

  test('drops non-chat rows but keeps responses-only models', async () => {
    const h = makeCatalog({ fetchModels: () => Promise.resolve(resp()) });
    const { models } = await h.catalog.getOrFetchModels(fakeToken());
    assert.deepEqual(models.map((m) => m.id), ['cc/claude', 'oc/text-only', 'cx/resp']);
  });

  test('modelFilter limits the list; a filter matching nothing is ignored and logged', async () => {
    const h = makeCatalog({ fetchModels: () => Promise.resolve(resp()), config: fakeConfig({ modelFilter: '^cc/' }) });
    assert.deepEqual((await h.catalog.getOrFetchModels(fakeToken())).models.map((m) => m.id), ['cc/claude']);

    const logs: string[] = [];
    const client = { fetchModels: () => Promise.resolve(resp()) } as unknown as GatewayClient;
    const cat = new ModelCatalog({
      client, discovery: noDiscovery(), getConfig: () => fakeConfig({ modelFilter: 'zzz' }),
      log: (m) => logs.push(m), onStatusChanged: () => undefined,
    });
    assert.equal((await cat.getOrFetchModels(fakeToken())).models.length, 3);
    assert.ok(logs.some((l) => l.includes("matches no model")));
  });

  test('exposes the explicit vision flag; unknown stays undefined', async () => {
    const h = makeCatalog({ fetchModels: () => Promise.resolve(resp()) });
    await h.catalog.getOrFetchModels(fakeToken());
    assert.equal(h.catalog.modelVision('cc/claude'), true);
    assert.equal(h.catalog.modelVision('oc/text-only'), false);
    assert.equal(h.catalog.modelVision('cx/resp'), undefined);
  });

  test('vision proxy keeps imageInput on for text-only models; off => follows the server flag', async () => {
    const on = makeCatalog({ fetchModels: () => Promise.resolve(resp()), config: fakeConfig({ visionProxyEnabled: true }) });
    const a = (await on.catalog.getOrFetchModels(fakeToken())).models.find((m) => m.id === 'oc/text-only');
    assert.equal(a?.capabilities?.imageInput, true);
    const off = makeCatalog({ fetchModels: () => Promise.resolve(resp()) });
    const b = (await off.catalog.getOrFetchModels(fakeToken())).models.find((m) => m.id === 'oc/text-only');
    assert.equal(b?.capabilities?.imageInput, false);
  });
});

describe('ModelCatalog.learnOutputLimitFromError', () => {
  const info = (out: number) => ({ id: 'a', maxInputTokens: 1000, maxOutputTokens: out }) as unknown as LanguageModelChatInformation;
  test('learns a lower output ceiling from an OpenAI-style error and exposes it', () => {
    const h = makeCatalog({ fetchModels: () => Promise.resolve(modelsResponse()) });
    const err = new Error('Chat completion failed: 400 - max_tokens is too large: 32000. This model supports at most 4096 completion tokens, whereas you provided 32000.');
    assert.equal(h.catalog.learnOutputLimitFromError(info(32000), err), true);
    assert.equal(h.catalog.getLearnedOutputLimit('a'), 4096);
    // same limit again is not "new": no pointless second retry
    assert.equal(h.catalog.learnOutputLimitFromError(info(32000), err), false);
  });
  test('ignores a limit that is not lower than what we already ask for, and unrelated errors', () => {
    const h = makeCatalog({ fetchModels: () => Promise.resolve(modelsResponse()) });
    assert.equal(h.catalog.learnOutputLimitFromError(info(2048), new Error('max_tokens is too large. This model supports at most 4096 completion tokens')), false);
    assert.equal(h.catalog.learnOutputLimitFromError(info(8000), new Error('boom')), false);
    assert.equal(h.catalog.getLearnedOutputLimit('a'), undefined);
  });
  test('learned limits are cleared with the other learned data on config reload', () => {
    const h = makeCatalog({ fetchModels: () => Promise.resolve(modelsResponse()) });
    h.catalog.learnOutputLimitFromError(info(8000), new Error('max_tokens is too large. This model supports at most 4096 completion tokens'));
    h.catalog.clearLearnedContexts();
    assert.equal(h.catalog.getLearnedOutputLimit('a'), undefined);
  });
});

describe('ModelCatalog.learnTemperatureFromError', () => {
  const info = (id = 'a') => ({ id, maxInputTokens: 1000, maxOutputTokens: 1000 }) as unknown as LanguageModelChatInformation;
  test('learns fixed temperature requirement from Kimi K3 error', () => {
    const h = makeCatalog({ fetchModels: () => Promise.resolve(modelsResponse()) });
    const err = new Error('Chat completion failed: 400 - {"error":{"message":"field Temperature invalid, only 1 is allowed for this model","param":"temperature"}}');
    assert.equal(h.catalog.learnTemperatureFromError(info('k3'), err), true);
    assert.deepEqual(h.catalog.getLearnedTemperature('k3'), { kind: 'fixed', value: 1 });
    // Same adjustment again is not "new"
    assert.equal(h.catalog.learnTemperatureFromError(info('k3'), err), false);
  });

  test('learns omit temperature requirement from unsupported parameter error', () => {
    const h = makeCatalog({ fetchModels: () => Promise.resolve(modelsResponse()) });
    const err = new Error("Chat completion failed: 400 - Unsupported parameter: 'temperature' is not supported with this model.");
    assert.equal(h.catalog.learnTemperatureFromError(info('o1'), err), true);
    assert.deepEqual(h.catalog.getLearnedTemperature('o1'), { kind: 'omit' });
  });

  test('ignores unrelated errors', () => {
    const h = makeCatalog({ fetchModels: () => Promise.resolve(modelsResponse()) });
    assert.equal(h.catalog.learnTemperatureFromError(info('a'), new Error('boom')), false);
    assert.equal(h.catalog.getLearnedTemperature('a'), undefined);
  });

  test('learned temperature settings are cleared on config reload', () => {
    const h = makeCatalog({ fetchModels: () => Promise.resolve(modelsResponse()) });
    h.catalog.learnTemperatureFromError(info('k3'), new Error('field Temperature invalid, only 1 is allowed for this model'));
    assert.deepEqual(h.catalog.getLearnedTemperature('k3'), { kind: 'fixed', value: 1 });
    h.catalog.clearLearnedContexts();
    assert.equal(h.catalog.getLearnedTemperature('k3'), undefined);
  });
});

describe('ModelCatalog thinking-effort picker follows the user settings', () => {
  const reasoningModels = (): OpenAIModelsResponse => ({
    object: 'list',
    data: [
      {
        id: 'x/kimi-k3',
        object: 'model',
        created: 0,
        owned_by: 'test',
        capabilities: { reasoning: true, thinkingFormat: 'kimi', thinkingRange: ['low', 'high', 'max'] },
      },
    ],
  });
  const schemaOf = async (config: GatewayConfig) => {
    const h = makeCatalog({ fetchModels: () => Promise.resolve(reasoningModels()), config });
    const { models } = await h.catalog.getOrFetchModels(fakeToken());
    return (models[0] as { configurationSchema?: { properties: Record<string, { enum: string[]; default?: string }> } })
      .configurationSchema?.properties.reasoningEffort;
  };

  test('offers the server list and forces no default when nothing is configured', async () => {
    const p = await schemaOf(fakeConfig());
    assert.deepEqual(p?.enum, ['low', 'high', 'max']);
    assert.equal(p?.default, undefined);
  });

  test('perModelOptions (wildcard) becomes the default when the model offers that level', async () => {
    const p = await schemaOf(fakeConfig({ perModelOptions: { 'x/*': { reasoningEffort: 'high' } } }));
    assert.equal(p?.default, 'high');
  });

  test('extraModelOptions applies too; a level the model does not offer is not made the default', async () => {
    assert.equal((await schemaOf(fakeConfig({ extraModelOptions: { reasoning_effort: 'max' } })))?.default, 'max');
    assert.equal((await schemaOf(fakeConfig({ extraModelOptions: { reasoningEffort: 'medium' } })))?.default, undefined);
  });
});

describe('ModelCatalog fills missing limits from the Anthropic-style listing (CLIProxyAPI)', () => {
  const ANTHROPIC = {
    data: [
      { id: 'claude-opus-5', max_input_tokens: 1000000, max_tokens: 128000 },
      { id: 'claude-fable-5-dd-hsalf-3-inimeg', max_input_tokens: 1048576, max_tokens: 65536 },
    ],
  };
  const makeWithListing = (rows: OpenAIModelsResponse, listing: () => Promise<unknown>, config?: GatewayConfig) => {
    let listingCalls = 0;
    const client = {
      fetchModels: () => Promise.resolve(rows),
      fetchAnthropicListing: () => { listingCalls++; return listing(); },
    } as unknown as GatewayClient;
    const catalog = new ModelCatalog({
      client, discovery: noDiscovery(), getConfig: () => config ?? fakeConfig(), log: () => undefined, onStatusChanged: () => undefined,
    });
    return { catalog, calls: () => listingCalls };
  };
  const bareRows = (): OpenAIModelsResponse => modelsResponse({ id: 'claude-opus-5' }, { id: 'gemini-3-flash' }, { id: 'mystery' });

  test('the picker gets the real window and output instead of 262144 / 4096', async () => {
    const { catalog } = makeWithListing(bareRows(), () => Promise.resolve(ANTHROPIC));
    const { models } = await catalog.getOrFetchModels(fakeToken());
    const by = Object.fromEntries(models.map((m) => [m.id, m]));
    assert.equal(by['claude-opus-5'].maxInputTokens + by['claude-opus-5'].maxOutputTokens, 1000000);
    assert.equal(by['claude-opus-5'].maxOutputTokens, 128000);
    assert.equal(by['gemini-3-flash'].maxInputTokens + by['gemini-3-flash'].maxOutputTokens, 1048576);
    assert.equal(by['gemini-3-flash'].maxOutputTokens, 65536);
    // not in the listing -> still the configured fallbacks
    assert.equal(by['mystery'].maxInputTokens + by['mystery'].maxOutputTokens, 128000);
    assert.equal(by['mystery'].maxOutputTokens, 4096);
  });

  test('a gateway that already reports context is never asked (zero extra requests)', async () => {
    const rows = modelsResponse({ id: 'a', contextLen: 32768 }, { id: 'b', contextLen: 65536 });
    const { catalog, calls } = makeWithListing(rows, () => Promise.resolve(ANTHROPIC));
    await catalog.getOrFetchModels(fakeToken());
    assert.equal(calls(), 0);
  });

  test('a failing or garbage listing is ignored silently and the list still loads', async () => {
    for (const listing of [() => Promise.reject(new Error('boom')), () => Promise.resolve(undefined), () => Promise.resolve('<html>')]) {
      const { catalog } = makeWithListing(bareRows(), listing);
      const { models, error } = await catalog.getOrFetchModels(fakeToken());
      assert.equal(error, undefined);
      assert.equal(models.length, 3);
      assert.equal(models[0].maxOutputTokens, 4096);
    }
  });

  test('the listing is cached for a few minutes and re-asked after Refresh Models', async () => {
    const { catalog, calls } = makeWithListing(bareRows(), () => Promise.resolve(ANTHROPIC));
    await catalog.getOrFetchModels(fakeToken());
    catalog.invalidateCache();
    await catalog.getOrFetchModels(fakeToken());
    assert.equal(calls(), 2);
    // fetchLast cache (1s) short-circuits before doFetchModels: no extra call
    await catalog.getOrFetchModels(fakeToken());
    assert.equal(calls(), 2);
  });

  test('the user modelContextWindows override still wins over the listing', async () => {
    const config = fakeConfig({ modelContextWindows: { 'claude-opus-5': 200000 } });
    const { catalog } = makeWithListing(bareRows(), () => Promise.resolve(ANTHROPIC), config);
    const { models } = await catalog.getOrFetchModels(fakeToken());
    const opus = models.find((m) => m.id === 'claude-opus-5')!;
    assert.equal(opus.maxInputTokens + opus.maxOutputTokens, 200000);
  });
});

describe('ModelCatalog asks CLIProxyAPI which thinking levels each model accepts', () => {
  const CLOAKED = { data: [{ id: 'claude-opus-5', max_input_tokens: 1000000, max_tokens: 128000 }, { id: 'claude-fable-5-dd-hsalf-3-inimeg', max_input_tokens: 1048576, max_tokens: 65536 }] };
  const PLAIN = { data: [{ id: 'claude-opus-5', max_input_tokens: 1000000, max_tokens: 128000 }] }; // Anthropic-style, but no cloaked ids
  const rows = () => modelsResponse({ id: 'claude-opus-5' }, { id: 'gemini-3-flash' }, { id: 'gemini-3.8-flash-high' }, { id: 'no-support' });
  const answers: Record<string, unknown> = {
    'claude-opus-5': { kind: 'levels', levels: ['low', 'medium', 'high', 'xhigh', 'max'] },
    'gemini-3-flash': { kind: 'levels', levels: ['minimal', 'low', 'medium', 'high'] },
    'gemini-3.8-flash-high': { kind: 'levels', levels: ['low', 'medium', 'high'] },
    'no-support': { kind: 'none' },
  };
  function make(opts: { listing: unknown; config?: GatewayConfig; rows?: OpenAIModelsResponse; probe?: (id: string) => Promise<unknown> }) {
    const probed: string[] = [];
    let refreshes = 0;
    const client = {
      fetchModels: () => Promise.resolve(opts.rows ?? rows()),
      fetchAnthropicListing: () => Promise.resolve(opts.listing),
      probeReasoningLevels: (id: string) => { probed.push(id); return opts.probe ? opts.probe(id) : Promise.resolve(answers[id] ?? { kind: 'error' }); },
    } as unknown as GatewayClient;
    const catalog = new ModelCatalog({
      client, discovery: noDiscovery(), getConfig: () => opts.config ?? fakeConfig(), log: () => undefined, onStatusChanged: () => undefined, requestRefresh: () => { refreshes++; },
    });
    return { catalog, probed, refreshes: () => refreshes };
  }
  const settle = () => new Promise((r) => setTimeout(r, 30));
  const enumOf = (m: LanguageModelChatInformation) =>
    (m as unknown as { configurationSchema?: { properties: Record<string, { enum: string[] }> } }).configurationSchema?.properties.reasoningEffort?.enum;

  test('probes in the background, then a refresh returns pickers with EXACTLY the gateway lists (tier-in-id models included)', async () => {
    const h = make({ listing: CLOAKED });
    const first = await h.catalog.getOrFetchModels(fakeToken());
    assert.ok(first.models.every((m) => enumOf(m) === undefined), 'first list is not delayed by probing');
    await settle();
    assert.equal(h.refreshes(), 1);
    const second = await h.catalog.getOrFetchModels(fakeToken());
    const by = Object.fromEntries(second.models.map((m) => [m.id, enumOf(m)]));
    assert.deepEqual(by['claude-opus-5'], ['low', 'medium', 'high', 'xhigh', 'max']);
    assert.deepEqual(by['gemini-3-flash'], ['minimal', 'low', 'medium', 'high']);
    assert.deepEqual(by['gemini-3.8-flash-high'], ['low', 'medium', 'high'], 'the gateway list beats the "-high in the id" heuristic');
    assert.equal(by['no-support'], undefined);
  });

  test('each model is asked once; a later fetch neither re-probes nor refreshes again', async () => {
    const h = make({ listing: CLOAKED });
    await h.catalog.getOrFetchModels(fakeToken());
    await settle();
    h.catalog.invalidateCache();
    await h.catalog.getOrFetchModels(fakeToken());
    await settle();
    assert.equal(h.probed.length, 4);
    assert.equal(h.refreshes(), 1);
  });

  test('NEVER probes a gateway that is not CLIProxyAPI (no cloaked ids), e.g. Ollama / vLLM / OpenRouter', async () => {
    for (const listing of [PLAIN, undefined, 'garbage']) {
      const h = make({ listing });
      await h.catalog.getOrFetchModels(fakeToken());
      await settle();
      assert.equal(h.probed.length, 0);
      assert.equal(h.refreshes(), 0);
    }
  });

  test('the setting turns it off completely', async () => {
    const h = make({ listing: CLOAKED, config: fakeConfig({ probeThinkingLevels: false }) });
    await h.catalog.getOrFetchModels(fakeToken());
    await settle();
    assert.equal(h.probed.length, 0);
  });

  test('rows that already carry capabilities are never probed', async () => {
    const r = modelsResponse({ id: 'a' }, { id: 'b' });
    r.data[0].capabilities = { reasoning: true, thinkingFormat: 'openai' };
    const h = make({ listing: CLOAKED, rows: r });
    await h.catalog.getOrFetchModels(fakeToken());
    await settle();
    assert.deepEqual(h.probed, ['b']);
  });

  test('failed probes teach nothing, do not refresh, and do not break the list', async () => {
    const h = make({ listing: CLOAKED, probe: () => Promise.resolve({ kind: 'error' }) });
    const { models, error } = await h.catalog.getOrFetchModels(fakeToken());
    await settle();
    assert.equal(error, undefined);
    assert.equal(models.length, 4);
    assert.equal(h.refreshes(), 0);
    h.catalog.invalidateCache();
    const again = await h.catalog.getOrFetchModels(fakeToken());
    assert.ok(again.models.every((m) => enumOf(m) === undefined));
    assert.equal(h.probed.length, 4, 'an error is remembered for a while instead of hammering the gateway');
  });

  test('a probe that throws is contained', async () => {
    const h = make({ listing: CLOAKED, probe: () => Promise.reject(new Error('boom')) });
    await h.catalog.getOrFetchModels(fakeToken());
    await settle();
    const { models } = await h.catalog.getOrFetchModels(fakeToken());
    assert.equal(models.length, 4);
  });
});

describe('thinking-level answers survive a restart (persistent per-gateway store)', () => {
  const LISTING = { data: [{ id: 'claude-opus-5', max_input_tokens: 1000000, max_tokens: 128000 }, { id: 'claude-fable-5-dd-hsalf-3-inimeg', max_input_tokens: 1048576, max_tokens: 65536 }] };
  const ANSWERS: Record<string, unknown> = { 'claude-opus-5': { kind: 'levels', levels: ['low', 'high', 'max'] }, 'gemini-3-flash': { kind: 'none' } };
  const enumOf = (m: LanguageModelChatInformation) =>
    (m as unknown as { configurationSchema?: { properties: Record<string, { enum: string[] }> } }).configurationSchema?.properties.reasoningEffort?.enum;
  const settle = () => new Promise((r) => setTimeout(r, 30));
  function session(store: { value: unknown }, probe: (id: string) => Promise<unknown>) {
    const probed: string[] = [];
    const client = {
      fetchModels: () => Promise.resolve(modelsResponse({ id: 'claude-opus-5' }, { id: 'gemini-3-flash' })),
      fetchAnthropicListing: () => Promise.resolve(LISTING),
      probeReasoningLevels: (id: string) => { probed.push(id); return probe(id); },
    } as unknown as GatewayClient;
    const catalog = new ModelCatalog({
      client, discovery: noDiscovery(), getConfig: () => fakeConfig(), log: () => undefined, onStatusChanged: () => undefined,
      probeStore: { get: () => store.value, set: (v) => { store.value = JSON.parse(JSON.stringify(v)); } },
    });
    return { catalog, probed };
  }

  test('a second session shows the pickers on its FIRST list and sends no probe at all', async () => {
    const store = { value: undefined as unknown };
    const a = session(store, (id) => Promise.resolve(ANSWERS[id]));
    await a.catalog.getOrFetchModels(fakeToken());
    await settle();
    assert.equal(a.probed.length, 2);
    const b = session(store, () => Promise.reject(new Error('must not be asked')));
    const { models } = await b.catalog.getOrFetchModels(fakeToken());
    await settle();
    assert.equal(b.probed.length, 0);
    assert.deepEqual(enumOf(models.find((m) => m.id === 'claude-opus-5')!), ['low', 'high', 'max']);
    assert.equal(enumOf(models.find((m) => m.id === 'gemini-3-flash')!), undefined);
  });

  test('errors are never persisted (they are retried next session)', async () => {
    const store = { value: undefined as unknown };
    const a = session(store, () => Promise.resolve({ kind: 'error' }));
    await a.catalog.getOrFetchModels(fakeToken());
    await settle();
    assert.deepEqual((store.value as { entries: object }).entries, {});
    const b = session(store, (id) => Promise.resolve(ANSWERS[id]));
    await b.catalog.getOrFetchModels(fakeToken());
    await settle();
    assert.equal(b.probed.length, 2);
  });

  test('a damaged or foreign store is ignored, and answers older than 24 h are asked again', async () => {
    for (const junk of ['x', 5, null, { v: 2, entries: {} }, { v: 1, entries: 'no' }, { v: 1, entries: { 'claude-opus-5': { at: 'x', outcome: { kind: 'levels', levels: ['low'] } } } }, { v: 1, entries: { 'claude-opus-5': { at: Date.now(), outcome: { kind: 'levels', levels: [1, 2] } } } }, { v: 1, entries: { 'claude-opus-5': { at: Date.now() - 25 * 3600_000, outcome: { kind: 'levels', levels: ['low'] } } } }]) {
      const s = session({ value: junk }, (id) => Promise.resolve(ANSWERS[id]));
      await s.catalog.getOrFetchModels(fakeToken());
      await settle();
      assert.ok(s.probed.includes('claude-opus-5'), JSON.stringify(junk));
    }
  });
});
