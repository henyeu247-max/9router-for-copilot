/**
 * Build the `LanguageModelChatInformation` object that VS Code's model picker
 * renders. Kept as its own module so the picker-facing shape (especially the
 * first-party-style `detail`/`multiplierNumeric` fields) can be unit-tested
 * without standing up the full provider.
 */

import { l10n, type LanguageModelConfigurationSchema } from 'vscode';
import { OpenAIModel } from '../api/types';
import { describeModel, friendlyModelName, inferModelFamily, parseModelId } from './modelDisplay';
import { serverReportedContext } from '../chat/contextWindow';
import { TOKEN_CONSTANTS } from '../chat/tokenBudget';
import { chooseMaxOutputTokens } from './outputLimit';

/**
 * Grey right-hand label rendered in the VS Code chat model picker. Matches the
 * shape native Copilot Chat BYOK providers use (e.g. `detail: 'Anthropic'`),
 * which is what visually groups all of our models under the provider.
 */
export const PROVIDER_DETAIL_LABEL = '9Router';

/**
 * Cost-tier multiplier surfaced to Copilot Chat. Set to 0 so BYOK / self-hosted
 * models don't appear to consume Copilot premium request quota.
 */
export const PROVIDER_MULTIPLIER_NUMERIC = 0;

/**
 * Reasoning-effort levels offered in the Copilot Chat picker for the
 * different thinking formats. Mirrors what 9Router (and the upstream
 * OpenAI/Anthropic APIs it routes to) accept on `reasoning_effort`. Kept
 * as `readonly` tuples so the property is `as const`-friendly.
 */
// These are only the FALLBACK when the server publishes no level list for a model:
// the real source of truth is `capabilities.thinkingRange` (see resolveEffortLevels).
// Each table follows what 9Router's translator
// (open-sse/translator/concerns/thinkingUnified.js) actually does with the level,
// so no offered level is a no-op:
//  - claude-adaptive: `xhigh` is sent as `high` (a duplicate), so it is not offered.
//  - zai: only low|high|max reach the wire (low/minimal->low, medium/high->high, else max).
//  - kimi: low|medium|high|max are passed through.
//  - gemini-level: thinkingLevel minimal|low|medium|high.
//  - minimax: 9Router only toggles thinking on/off and IGNORES the level -> no picker.
//  - claude-budget: level -> budget_tokens; see budgetFitsOutput().
const OPENAI_EFFORTS = ['low', 'medium', 'high'] as const;
const CLAUDE_ADAPTIVE_EFFORTS = ['low', 'medium', 'high', 'max'] as const;
const CLAUDE_BUDGET_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const DEEPSEEK_EFFORTS = ['low', 'high', 'max'] as const;
const ZAI_EFFORTS = ['low', 'high', 'max'] as const;
const KIMI_EFFORTS = ['low', 'medium', 'high', 'max'] as const;
const QWEN_EFFORTS = ['low', 'medium', 'high'] as const;
const HUNYUAN_EFFORTS = ['low', 'medium', 'high'] as const;
const GEMINI_LEVEL_EFFORTS = ['minimal', 'low', 'medium', 'high'] as const;
const GEMINI_BUDGET_EFFORTS = ['low', 'medium', 'high'] as const;

/**
 * Levels the request path can put on the wire. Anything else is dropped by
 * pickReasoningEffort, so the picker must never offer it.
 */
export const WIRE_EFFORT_LEVELS: ReadonlySet<string> = new Set([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

/**
 * budget_tokens 9Router derives from a level (LEVEL_TO_BUDGET in
 * open-sse/translator/concerns/thinking.js). Anthropic requires
 * max_tokens > budget_tokens, so a level whose budget is not below the model's
 * output limit can only produce a 400.
 */
const LEVEL_BUDGET_TOKENS: Readonly<Record<string, number>> = {
  minimal: 512,
  low: 1024,
  medium: 8192,
  high: 24576,
  xhigh: 32768,
  max: 128000,
};

export interface ModelCapabilities {
  readonly imageInput?: boolean;
  readonly toolCalling?: boolean | number;
}

export interface BuildModelInfoInput {
  readonly model: OpenAIModel;
  readonly defaultMaxTokens: number;
  readonly defaultMaxOutputTokens: number;
  readonly capabilities: ModelCapabilities;
  /**
   * User-configured context window for this model (from the
   * `modelContextWindows` setting). Wins over everything else.
   */
  readonly contextOverride?: number;
  /**
   * The reasoning-effort level the user configured for this model in settings
   * (perModelOptions / extraModelOptions). Becomes the picker's default when the
   * model offers it.
   */
  readonly preferredEffort?: string;
  /**
   * Context discovered from the backend (Ollama `/api/show`: runtime
   * `num_ctx`, else the model's trained context length). Sits below the user
   * override but above the OpenAI `/v1/models` value, which Ollama omits.
   */
  readonly discoveredContext?: number;
}

/**
 * Picker-facing fields plus the resolved total context size. `totalContext` is
 * returned separately because the chat-response path budgets against the REAL
 * window; `maxInputTokens + maxOutputTokens` always equals it (see below).
 */
export interface BuildModelInfoResult {
  readonly info: {
    readonly id: string;
    readonly name: string;
    readonly family: string;
    readonly version: string;
    readonly maxInputTokens: number;
    readonly maxOutputTokens: number;
    readonly capabilities: ModelCapabilities;
    readonly detail: string;
    readonly tooltip: string;
    readonly description?: string;
    readonly isUserSelectable: true;
    readonly multiplierNumeric: number;
    /**
     * Sub-picker schema for the Copilot Chat model picker. Populated when
     * the model advertises (or we heuristically infer) supported reasoning
     * effort levels — drives the "Thinking Effort" dropdown that landed in
     * microsoft/vscode#315181. The chosen value flows into
     * `options.modelConfiguration.reasoningEffort` on the chat request.
     */
    readonly configurationSchema?: LanguageModelConfigurationSchema;
  };
  readonly totalContext: number;
  readonly hasServerReportedContext: boolean;
}

/**
 * Translate a raw `/v1/models` entry into the picker-facing model info plus
 * the resolved total context.
 *
 * Contract with VS Code (verified against microsoft/vscode `getModelContextWindowTotal`
 * and the Context Window widget): the window VS Code shows and the point where it
 * compacts are derived from `maxInputTokens + maxOutputTokens`, and compaction
 * triggers at ~80-90% of `maxInputTokens` (agentIntent.ts). So
 *
 *   maxInputTokens  = totalContext - maxOutputTokens
 *
 * Reporting the full window as `maxInputTokens` (the old behaviour) inflated the
 * denominator by `maxOutputTokens` and let a prompt at the compaction trigger plus
 * the reserved output overrun the real window.
 */
export function buildModelInfo({
  model,
  defaultMaxTokens,
  defaultMaxOutputTokens,
  capabilities,
  contextOverride,
  discoveredContext,
  preferredEffort,
}: BuildModelInfoInput): BuildModelInfoResult {
  const serverContext = serverReportedContext(model);
  const totalContext =
    contextOverride ?? discoveredContext ?? serverContext ?? defaultMaxTokens;
  // The server's declared output limit is authoritative (issue #199); the
  // `defaultMaxOutputTokens` setting only applies when the server declares none.
  // See models/outputLimit.ts for the exact rule and what is verified vs heuristic.
  const { maxOutputTokens } = chooseMaxOutputTokens({
    totalContext,
    maxCompletionTokens: model.max_completion_tokens,
    capabilitiesMaxOutput: model.capabilities?.maxOutput,
    defaultMaxOutputTokens,
    minOutputTokens: TOKEN_CONSTANTS.MIN_OUTPUT_TOKENS,
    adjustBuffer: TOKEN_CONSTANTS.ADJUST_TOKEN_BUFFER,
  });

  const description = describeModel(model);
  const { provider } = parseModelId(model.id);
  const friendlyName = friendlyModelName(model.id);

  const tooltipParts: string[] = [];
  if (provider) {
    tooltipParts.push(`**Provider:** ${provider}`);
  }
  tooltipParts.push(`**Model ID:** \`${model.id}\``);
  tooltipParts.push(`**Name:** ${friendlyName}`);
  const tooltip = tooltipParts.join('  \n');

  // Build the "Thinking Effort" sub-picker for reasoning-capable models.
  // The schema follows microsoft/vscode#315181: the picker renders a
  // dropdown of `enum` values with the `default` pre-selected, and the
  // chosen value arrives on the request as
  // `options.modelConfiguration.reasoningEffort`.
  const configurationSchema = resolveReasoningEffortSchema(model, {
    maxOutputTokens,
    preferredEffort,
  });

  const info: BuildModelInfoResult['info'] = {
    id: model.id,
    name: friendlyName,
    family: inferModelFamily(model.id),
    version: friendlyName,
    maxInputTokens: Math.max(1, totalContext - maxOutputTokens),
    maxOutputTokens,
    capabilities,
    detail: PROVIDER_DETAIL_LABEL,
    tooltip,
    isUserSelectable: true,
    multiplierNumeric: PROVIDER_MULTIPLIER_NUMERIC,
    ...(description ? { description } : {}),
    ...(configurationSchema ? { configurationSchema } : {}),
  };

  return {
    info,
    totalContext,
    hasServerReportedContext: serverContext !== undefined,
  };
}

/**
 * Build the `configurationSchema` for a model when it advertises reasoning
 * support. Mirrors the Copilot Chat BYOK behaviour in
 * microsoft/vscode#315181: a `reasoningEffort` string enum with a sensible
 * default. Returns `undefined` when the model doesn't support thinking,
 * so the picker doesn't render an empty dropdown.
 */
export function resolveReasoningEffortSchema(
  model: OpenAIModel,
  options: { maxOutputTokens?: number; preferredEffort?: string } = {}
): LanguageModelConfigurationSchema | undefined {
  const { maxOutputTokens, preferredEffort } = options;
  if (!model.capabilities?.reasoning) {
    return undefined;
  }
  // Some providers bake the reasoning tier into the model id itself
  // (e.g. `cu/claude-4.5-opus-high-thinking`). For those the picker is
  // noise — the tier is already fixed by the model entry, and the
  // upstream ignores any `reasoning_effort` we'd forward. Skip the
  // schema entirely before any format-based enum logic runs.
  if (hasReasoningTierInName(model.id)) {
    return undefined;
  }
  // Server-advertised list wins verbatim. Filters out empty strings and
  // non-string entries defensively — some servers embed the list inside
  // a wrapper object by mistake.
  const efforts = resolveEffortLevels(model, maxOutputTokens);
  if (!efforts || efforts.length === 0) {
    return undefined;
  }
  // VS Code injects a schema `default` into EVERY request (languageModels.ts
  // _resolveModelConfigurationWithDefaults), so a hard-coded default would force
  // reasoning_effort (and its cost) on models the user never touched, and make the
  // `reasoningEffort` setting dead. The default is therefore only the level the
  // user configured for this model (perModelOptions / extraModelOptions), and only
  // when the model offers it. Otherwise nothing is sent and the server's own
  // default applies.
  const defaultEffort =
    preferredEffort !== undefined && efforts.includes(preferredEffort) ? preferredEffort : undefined;
  return {
    group: 'navigation',
    properties: {
      reasoningEffort: {
        type: 'string',
        title: l10n.t('Thinking effort'),
        enum: efforts,
        ...(defaultEffort !== undefined ? { default: defaultEffort } : {}),
        description: 'Reasoning effort forwarded to the model as `reasoning_effort`.',
        group: 'navigation',
      },
    },
  };
}

/**
 * The level list for the picker, most authoritative first:
 *  1. `capabilities.reasoningEffort` - an explicit list (GitHub Copilot style).
 *  2. `capabilities.thinkingRange` when it is an array of levels - 9Router's own
 *     per-model list. Kept in the server's order, limited to levels the request
 *     path can send. If the server lists levels but none are sendable, the model
 *     gets no picker (a fallback would contradict the server).
 *  3. The per-format fallback table.
 */
export function resolveEffortLevels(
  model: OpenAIModel,
  maxOutputTokens?: number
): readonly string[] | undefined {
  const caps = model.capabilities;
  const sendable = (list: unknown[]): string[] => [
    ...new Set(
      list
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.toLowerCase())
        .filter((v) => WIRE_EFFORT_LEVELS.has(v))
    ),
  ];
  if (Array.isArray(caps?.reasoningEffort) && caps.reasoningEffort.length > 0) {
    return sendable(caps.reasoningEffort);
  }
  if (Array.isArray(caps?.thinkingRange) && caps.thinkingRange.length > 0) {
    return sendable(caps.thinkingRange);
  }
  const fallback = pickEffortsForFormat(model);
  if (!fallback) {
    return undefined;
  }
  return caps?.thinkingFormat === 'claude-budget'
    ? fallback.filter((level) => budgetFitsOutput(level, maxOutputTokens))
    : fallback;
}

function budgetFitsOutput(level: string, maxOutputTokens: number | undefined): boolean {
  const budget = LEVEL_BUDGET_TOKENS[level];
  return budget === undefined || maxOutputTokens === undefined || budget < maxOutputTokens;
}

function pickEffortsForFormat(
  model: OpenAIModel
): readonly string[] | undefined {
  const format = model.capabilities?.thinkingFormat;
  const effortSupported = model.capabilities?.thinkingEffortSupported === true;
  switch (format) {
    case 'openai':
      return OPENAI_EFFORTS;
    case 'claude-adaptive':
      return CLAUDE_ADAPTIVE_EFFORTS;
    case 'claude-budget':
      return CLAUDE_BUDGET_EFFORTS;
    case 'deepseek':
      return DEEPSEEK_EFFORTS;
    case 'zai':
      // Only GLM-5.2+ reads `reasoning_effort` (9Router capabilities.js
      // gate it on `thinkingEffortSupported`); older zai-format models
      // ignore the field.
      return effortSupported ? ZAI_EFFORTS : undefined;
    case 'kimi':
      return KIMI_EFFORTS;
    case 'minimax':
      // 9Router only switches thinking on/off for minimax and ignores the level.
      return undefined;
    case 'qwen':
      return QWEN_EFFORTS;
    case 'hunyuan':
      return HUNYUAN_EFFORTS;
    case 'gemini-level':
      return GEMINI_LEVEL_EFFORTS;
    case 'gemini-budget':
      return GEMINI_BUDGET_EFFORTS;
    case undefined:
      // No explicit format — fall back to a model-id hint for the
      // openai family (gpt-5, o-series, codex) which is the most common
      // reason-capable model without a tagged format.
      if (/^(o1|o3|o4|gpt-5|codex)/i.test(stripProviderPrefix(model.id))) {
        return OPENAI_EFFORTS;
      }
      return undefined;
    default:
      return undefined;
  }
}

function stripProviderPrefix(modelId: string): string {
  const slash = modelId.lastIndexOf('/');
  return slash >= 0 && slash < modelId.length - 1 ? modelId.slice(slash + 1) : modelId;
}


/**
 * Reasoning-tier tokens that may appear as a `-` or `_`-separated
 * segment in a model id. Case-insensitive. Exported as an array so
 * it's trivially extensible from tests or future providers — just push
 * more entries. The {@link hasReasoningTierInName} fast-path uses an
 * internal `Set` mirror to avoid the O(n) `Array.includes` scan on
 * each call.
 */
export const REASONING_TIER_KEYWORDS: readonly string[] = [
  'low',
  'medium',
  'high',
  'extra',
  'max',
  'xhigh',
  'thinking',
  'agentic',
  // Variants that bake "no / minimal thinking" into the id (cu/gpt-5.6-sol-none,
  // cu/gemini-3.6-flash-minimal, ds/deepseek-v4-pro-none).
  'none',
  'minimal',
];

/** Set mirror of {@link REASONING_TIER_KEYWORDS} for O(1) lookup. */
const REASONING_TIER_KEYWORD_SET: ReadonlySet<string> = new Set(REASONING_TIER_KEYWORDS);

/**
 * Number of trailing segments to inspect for a tier keyword. Providers
 * expose tier-baked models with the tier at the tail — usually a single
 * suffix, sometimes stacked (`high-thinking`, `extra-low`,
 * `thinking-agentic`). Three covers the longest stacked pattern we've
 * seen in practice without re-introducing false positives on
 * mid-name coincidences like `claude-high-preview-4` (where `high`
 * would otherwise be flagged even though it's a version tag).
 */
export const REASONING_TIER_TRAILING_SEGMENTS = 3;

/**
 * Regex used by {@link splitModelSegments} to cut both `-` and `_`
 * boundaries in a single pass. Bracket-class character splitting is
 * faster than running two `split` calls and stitching.
 */
const MODEL_SEGMENT_SPLITTER = /[-_]/;

/**
 * True when any of the last {@link REASONING_TIER_TRAILING_SEGMENTS}
 * segments of the model id (after stripping the provider prefix) matches
 * a reasoning-tier keyword.
 *
 * Matching is whole-segment, case-insensitive. Substring matches are
 * deliberately rejected so tokens like `highlight`, `mediumwave`, or
 * `maximus` do not trip the heuristic.
 *
 * Only the trailing window is inspected so a tier keyword appearing as a
 * middle token — e.g. `claude-high-opus-4-6` where `high` is part of the
 * model name, not a tier — does not false-positive.
 *
 * Tiers may stack — `claude-4.5-opus-high-thinking`,
 * `something-thinking-agentic`, `something-medium-thinking`, and
 * `gemini-3.5-flash-extra-low` all return true.
 *
 * `@example`
 *   hasReasoningTierInName('cu/claude-4.5-opus-high-thinking') // true
 *   hasReasoningTierInName('ag/gemini-3.5-flash-extra-low')    // true
 *   hasReasoningTierInName('gpt-4-highlight-preview')          // false
 *   hasReasoningTierInName('openai/o3')                         // false
 */
export function hasReasoningTierInName(modelId: string): boolean {
  const slash = modelId.indexOf('/');
  const modelPart = slash >= 0 ? modelId.slice(slash + 1) : modelId;
  if (modelPart.length === 0) {
    return false;
  }
  // Iterate the trailing 3 segments via single-pass split. Regex
  // character class + `slice` avoids two-array materialisations.
  const parts = modelPart.split(MODEL_SEGMENT_SPLITTER);
  const start = parts.length > REASONING_TIER_TRAILING_SEGMENTS
    ? parts.length - REASONING_TIER_TRAILING_SEGMENTS
    : 0;
  // "Max" is the product tier of the Qwen family (qwen3.7-max), not an effort level.
  const qwenFamily = /^qwen/i.test(modelPart);
  for (let i = start; i < parts.length; i++) {
    const part = parts[i].toLowerCase();
    if (part === 'max' && qwenFamily) {
      continue;
    }
    if (REASONING_TIER_KEYWORD_SET.has(part)) {
      return true;
    }
  }
  return false;
}

/**
 * Split the model portion (post provider prefix) into lowercased
 * segments on `-` and `_`. Exported so tests can inspect the parsed
 * segments.
 */
export function splitModelSegments(modelId: string): readonly string[] {
  const slash = modelId.indexOf('/');
  const modelPart = slash >= 0 ? modelId.slice(slash + 1) : modelId;
  if (modelPart.length === 0) {
    return [];
  }
  return modelPart
    .split(MODEL_SEGMENT_SPLITTER)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.toLowerCase());
}