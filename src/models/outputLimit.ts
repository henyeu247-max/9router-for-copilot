/**
 * Output / input split for the model picker (pure, unit-testable).
 *
 * What is verified (microsoft/vscode source, see CHANGELOG 3.0.1):
 *  - VS Code's Context Window widget total = maxInputTokens + maxOutputTokens
 *    (`getModelContextWindowTotal`), and compaction starts at ~80-90 % of
 *    maxInputTokens (`agentIntent.ts`). So input + output MUST equal the real window.
 *  - The stable API cannot express "maxima need not add up" (`maxContextWindowTokens`
 *    is a proposed API), so a split has to be chosen.
 *
 * What is a HEURISTIC (not derived from VS Code): the 50 % ceiling on output. A model
 * that declares an output limit equal to its whole window (e.g. 500K/500K) would leave
 * no input room; half/half is the least-wrong stable-API split.
 */

/** Never let the advertised output exceed this share of the window. */
export const MAX_OUTPUT_WINDOW_SHARE = 0.5;

function usable(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

export interface OutputInputs {
  /** Real total window (input + output). */
  totalContext: number;
  /** Top-level OpenAI/OpenRouter style `max_completion_tokens`. */
  maxCompletionTokens?: number;
  /** 9Router `capabilities.maxOutput`. */
  capabilitiesMaxOutput?: number;
  /** User setting; only used when the server declares nothing. */
  defaultMaxOutputTokens: number;
  minOutputTokens: number;
  adjustBuffer: number;
}

export interface OutputChoice {
  maxOutputTokens: number;
  /** Where the number came from (for logs/tests). */
  source: 'server' | 'default';
  /** True when the server's number was reduced to fit the window share. */
  clamped: boolean;
}

/**
 * Advertised `maxOutputTokens`: the server's declared limit (top-level first, then
 * capabilities), clamped to 50 % of the window and to window - buffer. The
 * `defaultMaxOutputTokens` setting is a fallback ONLY when the server declares nothing.
 */
export function chooseMaxOutputTokens(i: OutputInputs): OutputChoice {
  const declared = [i.maxCompletionTokens, i.capabilitiesMaxOutput].find(usable);
  const ceiling = Math.max(
    i.minOutputTokens,
    Math.min(Math.floor(i.totalContext * MAX_OUTPUT_WINDOW_SHARE), i.totalContext - i.adjustBuffer)
  );
  if (declared !== undefined) {
    const value = Math.max(i.minOutputTokens, Math.min(declared, ceiling));
    return { maxOutputTokens: value, source: 'server', clamped: value < declared };
  }
  const fallback = Math.max(i.minOutputTokens, Math.min(i.defaultMaxOutputTokens, ceiling));
  return { maxOutputTokens: fallback, source: 'default', clamped: false };
}
