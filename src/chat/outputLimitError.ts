/**
 * Parse the real output-token limit out of a "max_tokens too large" 400.
 *
 * Only message shapes verified from primary sources are recognised (no guessing):
 *  - OpenAI:    "max_tokens is too large: 32000. This model supports at most 4096
 *                completion tokens, whereas you provided 32000."
 *                (community.openai.com/t/max-tokens-chat-completion-gpt4o/758066)
 *  - Anthropic: "max_tokens: 100001 > 64000, which is the maximum allowed number of
 *                output tokens for claude-sonnet-4-5-20250929"
 *                (anthropics/claude-code#19216)
 * Anything else returns undefined and the normal error path runs. Pure/unit-testable.
 */
const PATTERNS: readonly RegExp[] = [
  /supports at most (\d+) completion tokens/i, // OpenAI
  /max_tokens:\s*\d+\s*>\s*(\d+),?\s*which is the maximum allowed number of output tokens/i, // Anthropic
];

export function parseOutputLimitError(message: string): number | undefined {
  if (!/max_(completion_)?tokens/i.test(message)) { return undefined; }
  for (const re of PATTERNS) {
    const m = re.exec(message);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0) { return n; }
    }
  }
  return undefined;
}
