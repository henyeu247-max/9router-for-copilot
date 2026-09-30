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
