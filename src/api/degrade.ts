/**
 * Graceful degradation for HTTP 400 "the backend rejected a request feature".
 *
 * Some gateway backends (free tiers, small local models) reject `tools` or
 * `reasoning_effort` outright. Instead of failing the whole turn we retry ONCE
 * per step with the offending field removed: first `reasoning_effort`, then
 * tools (only when the error message actually points at tools). A retry only
 * happens while nothing has been streamed yet.
 *
 * The strip-then-retry idea comes from the earlier 0.9.x line of this project.
 * Pure (no `vscode` import) so it is unit-testable under `node --test`.
 */

export type DegradeStep = 'reasoning' | 'tools';

const TOOLS_HINT =
  /(tools?|tool_choice|function[_ ]call(?:ing)?|functions\b)\b.*\b(not supported|unsupported|not allowed|unknown|not set|does not support)|\b(does not support|doesn't support|not support)\b.*\b(tools?|function[_ ]call(?:ing)?)/i;
const REASONING_HINT =
  /(reasoning[_ ]effort|thinking|reasoning)\b.*\b(not supported|unsupported|invalid|unknown|unrecognized|extra|not allowed)|\b(unknown|unrecognized|unsupported|invalid)\b.*\b(reasoning|thinking)/i;

/** HTTP status of a chat failure: typed `.status` first, then parse our error text. */
export function httpStatusOf(error: unknown): number | undefined {
  const typed = (error as { status?: unknown } | null)?.status;
  if (typeof typed === 'number') { return typed; }
  const m = /(?:failed|returned|HTTP)[: ]+(\d{3})\b/i.exec(error instanceof Error ? error.message : String(error));
  return m ? Number(m[1]) : undefined;
}

/**
 * Decide which feature to strip after a 400. Returns undefined when the error
 * is not a feature rejection (or nothing is left to strip), so the caller
 * surfaces the original error instead of looping.
 */
export function pickDegradeStep(
  error: unknown,
  state: { hasReasoning: boolean; hasTools: boolean; done: ReadonlySet<DegradeStep> }
): DegradeStep | undefined {
  if (httpStatusOf(error) !== 400) { return undefined; }
  const text = error instanceof Error ? error.message : String(error);
  const canReasoning = state.hasReasoning && !state.done.has('reasoning');
  const canTools = state.hasTools && !state.done.has('tools');

  // Reasoning is cheap to lose, so it may be stripped on an ambiguous 400.
  // Tools are NOT: dropping them silently turns an Agent turn into plain chat,
  // so they are only stripped when the message actually points at them.
  if (canReasoning && REASONING_HINT.test(text)) { return 'reasoning'; }
  if (canTools && TOOLS_HINT.test(text)) { return 'tools'; }
  if (canReasoning) { return 'reasoning'; }
  return undefined;
}

/** Return a copy of the request body with the given feature removed. */
export function degradeRequest<T extends Record<string, unknown>>(request: T, step: DegradeStep): T {
  const out: Record<string, unknown> = { ...request };
  if (step === 'reasoning') {
    delete out.reasoning_effort;
    delete out.thinking;
  } else {
    delete out.tools;
    delete out.tool_choice;
    delete out.parallel_tool_calls;
  }
  return out as T;
}
