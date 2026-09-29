/**
 * Usage fallback for gateways that ignore `stream_options.include_usage`.
 *
 * VS Code's Context Window widget and its auto-compaction read token usage from
 * the response stream (a `LanguageModelDataPart` with mime type `usage`,
 * microsoft/vscode#315394). Without any usage the widget stays at 0% and
 * compaction only sees VS Code's own local estimate. When the server reports no
 * usage we synthesize one from the request and the streamed answer so the
 * widget still moves. A server-reported value always wins; an estimate is
 * clearly marked in the log.
 *
 * Pure (no `vscode` import) so it is unit-testable.
 */
import { estimateTextTokens, toConservativeTokens } from './tokenBudget';

export interface UsageLike {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: { cached_tokens: number };
}

/** Token estimate for everything sent in the request (messages + tool schemas). */
export function estimatePromptTokens(inputText: string, toolsSerializedLength: number): number {
  // Conservative (same scale VS Code counts with) because VS Code compacts on this number.
  return toConservativeTokens(estimateTextTokens(inputText) + Math.ceil(toolsSerializedLength / 4));
}

/**
 * Build a usage object from estimates. `completionChars` is the total length of
 * streamed text + reasoning + serialized tool-call arguments.
 */
export function estimateUsage(promptTokens: number, completionChars: number): UsageLike {
  const prompt = Math.max(0, Math.round(promptTokens));
  const completion = Math.max(0, Math.ceil(completionChars / 4));
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
    prompt_tokens_details: { cached_tokens: 0 },
  };
}

/** True when a reported usage is unusable (all zero / missing) and an estimate should replace it. */
export function isEmptyUsage(usage: UsageLike | undefined): boolean {
  return !usage || (usage.prompt_tokens <= 0 && usage.completion_tokens <= 0);
}
