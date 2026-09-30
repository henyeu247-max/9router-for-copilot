/**
 * Make tool-call ids unique across a conversation before it is sent.
 *
 * Why: some gateways mint short random ids (`call_149461`) and occasionally reuse one for a
 * later, different tool call. VS Code stores the history verbatim, so from then on EVERY
 * request repeats the same id twice (`read_file` and later `run_in_terminal`). Strict upstreams
 * (Gemini: `INVALID_ARGUMENT`) reject the whole request, and the chat can never recover.
 * Measured on a real session log: 12/12 failing requests contained such a pair, 268/268 requests
 * without one succeeded.
 *
 * Rule: walk the wire messages in order. The first assistant `tool_call` using an id keeps it;
 * a later call reusing that id gets a fresh unique one, and the `tool` result(s) that answer
 * it (they follow the assistant message) are re-pointed to the new id. Call/result pairing is
 * preserved, nothing else in the conversation changes, and unique histories pass through
 * untouched (same object returned).
 */
import type { OpenAIMessage } from '../api/types';

/** Ids are kept at or below this length (some hosts reject longer ones). */
const MAX_ID_LENGTH = 64;

export interface DedupeResult {
  readonly messages: OpenAIMessage[];
  /** How many tool-call ids had to be renamed. */
  readonly renamed: number;
}

function freshId(original: string, used: ReadonlySet<string>): string {
  for (let n = 2; ; n++) {
    const suffix = `_dup${n}`;
    const candidate = original.slice(0, MAX_ID_LENGTH - suffix.length) + suffix;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
}

export function dedupeToolCallIds(messages: readonly OpenAIMessage[]): DedupeResult {
  const used = new Set<string>();
  // original id -> wire ids still waiting for their tool result, for the CURRENT assistant turn
  let pending = new Map<string, string[]>();
  let renamed = 0;
  const out: OpenAIMessage[] = [];

  for (const message of messages) {
    if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      pending = new Map();
      const calls = (message.tool_calls as Array<Record<string, unknown>>).map((call) => {
        const original = typeof call.id === 'string' ? call.id : '';
        if (original === '') {
          return call;
        }
        let wire = original;
        if (used.has(wire)) {
          wire = freshId(original, used);
          renamed++;
        }
        used.add(wire);
        const queue = pending.get(original) ?? [];
        queue.push(wire);
        pending.set(original, queue);
        return wire === original ? call : { ...call, id: wire };
      });
      out.push({ ...message, tool_calls: calls });
      continue;
    }

    if (message.role === 'tool' && typeof message.tool_call_id === 'string') {
      const queue = pending.get(message.tool_call_id);
      const wire = queue && queue.length > 0 ? queue.shift() : undefined;
      out.push(wire !== undefined && wire !== message.tool_call_id ? { ...message, tool_call_id: wire } : message);
      continue;
    }

    pending = new Map();
    out.push(message);
  }

  // Nothing renamed: hand back the original array so callers can rely on identity.
  return renamed === 0 ? { messages: messages as OpenAIMessage[], renamed } : { messages: out, renamed };
}
